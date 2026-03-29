import { Logger } from '@nestjs/common';
import {
  QueryClientStateRequest,
  QueryClientStateResponse,
} from '@plus/proto-types/build/ibc/core/client/v1/query';
import { Any } from '@plus/proto-types/build/google/protobuf/any';
import {
  TendermintRequestQuery,
  decodeCosmosResponse,
  decodeInterchainQueryPacketAckJson,
  encodeCosmosQuery,
  encodeInterchainQueryPacketDataJson,
} from '@shared/types/apps/async-icq/async-icq';
import { convertHex2String } from '@shared/helpers/hex';
import { AsyncIcqHostService } from '../async-icq-host.service';

describe('AsyncIcqHostService', () => {
  const loggerMock = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const queryServiceMock = {
    latestHeight: jest.fn(),
    queryClientState: jest.fn(),
  };

  const connectionServiceMock = {
    queryConnection: jest.fn(),
  };

  const channelServiceMock = {
    queryChannel: jest.fn(),
  };

  const packetServiceMock = {
    queryPacketCommitment: jest.fn(),
    queryPacketReceipt: jest.fn(),
    queryNextSequenceReceive: jest.fn(),
  };

  const service = new AsyncIcqHostService(
    loggerMock as unknown as Logger,
    queryServiceMock as any,
    connectionServiceMock as any,
    channelServiceMock as any,
    packetServiceMock as any,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    queryServiceMock.latestHeight.mockResolvedValue({ height: '42' });
  });

  function encodePacket(requests: TendermintRequestQuery[]): Uint8Array {
    return encodeInterchainQueryPacketDataJson({
      data: encodeCosmosQuery({ requests }),
    });
  }

  it('returns a successful async-icq acknowledgement for allowed queries', async () => {
    const clientStateAny: Any = {
      type_url: '/ibc.lightclients.tendermint.v1.ClientState',
      value: Buffer.from('client-state'),
    };

    queryServiceMock.queryClientState.mockResolvedValue({
      client_state: clientStateAny,
      proof: Buffer.from('proof'),
      proof_height: {
        revision_number: BigInt(0),
        revision_height: BigInt(41),
      },
    } satisfies QueryClientStateResponse);

    const packet = encodePacket([
      {
        path: '/ibc.core.client.v1.Query/ClientState',
        data: QueryClientStateRequest.encode({ client_id: '07-tendermint-0' }).finish(),
        height: BigInt(0),
        prove: false,
      },
    ]);

    const { acknowledgementResponse } = await service.executePacket(packet);

    expect('AcknowledgementResult' in acknowledgementResponse).toBe(true);
    if (!('AcknowledgementResult' in acknowledgementResponse)) {
      throw new Error('expected result acknowledgement');
    }

    const ackBytes = Buffer.from(convertHex2String(acknowledgementResponse.AcknowledgementResult.result), 'base64');
    const ackPayload = decodeInterchainQueryPacketAckJson(ackBytes);
    const cosmosResponse = decodeCosmosResponse(ackPayload.data);

    expect(cosmosResponse.responses).toHaveLength(1);
    expect(cosmosResponse.responses[0].height).toBe(BigInt(42));

    const response = QueryClientStateResponse.decode(cosmosResponse.responses[0].value);
    expect(response.client_state?.type_url).toBe('/ibc.lightclients.tendermint.v1.ClientState');
    expect(queryServiceMock.queryClientState).toHaveBeenCalledWith({ client_id: '07-tendermint-0' });
  });

  it('returns an error acknowledgement when prove=true is requested', async () => {
    const packet = encodePacket([
      {
        path: '/ibc.core.client.v1.Query/ClientState',
        data: QueryClientStateRequest.encode({ client_id: '07-tendermint-0' }).finish(),
        height: BigInt(0),
        prove: true,
      },
    ]);

    const { acknowledgementResponse } = await service.executePacket(packet);

    expect(acknowledgementResponse).toEqual({
      AcknowledgementError: {
        err: Buffer.from('async-icq query proof not allowed', 'utf8').toString('hex'),
      },
    });
  });
});
