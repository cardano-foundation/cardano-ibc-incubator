import { CheqdIcqService } from './cheqd-icq.service';
import { PacketService } from '~@/tx/packet.service';
import {
  decodeCheqdProtoMessage,
  encodeCheqdProtoMessage,
} from '@shared/types/apps/async-icq/cheqd-icq';
import {
  decodeCosmosQuery,
  decodeInterchainQueryPacketDataJson,
  encodeCosmosResponse,
  encodeInterchainQueryPacketAckJson,
} from '@shared/types/apps/async-icq/async-icq';

describe('CheqdIcqService', () => {
  let service: CheqdIcqService;
  let packetServiceMock: {
    sendAsyncIcqPacket: jest.Mock;
  };

  beforeEach(() => {
    packetServiceMock = {
      sendAsyncIcqPacket: jest.fn().mockResolvedValue({
        result: 1,
        unsigned_tx: {
          type_url: '/ibc.core.channel.v1.MsgTransfer',
          value: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
        },
      }),
    };

    service = new CheqdIcqService(packetServiceMock as unknown as PacketService);
  });

  it('builds a cheqd DidDoc async-icq packet on the icqhost port', async () => {
    const response = await service.buildDidDocQuery({
      source_channel: 'channel-3',
      signer: 'addr_test1qpz...',
      id: 'did:cheqd:testnet:abc123',
    } as any);

    expect(packetServiceMock.sendAsyncIcqPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePort: 'icqhost',
        sourceChannel: 'channel-3',
        signer: 'addr_test1qpz...',
      }),
    );

    const sentPacketHex = packetServiceMock.sendAsyncIcqPacket.mock.calls[0][0].packetData as string;
    const packet = decodeInterchainQueryPacketDataJson(Buffer.from(sentPacketHex, 'hex'));
    const cosmosQuery = decodeCosmosQuery(packet.data);
    expect(cosmosQuery.requests).toHaveLength(1);
    expect(cosmosQuery.requests[0].path).toBe('/cheqd.did.v2.Query/DidDoc');
    expect(
      decodeCheqdProtoMessage('cheqd.did.v2.QueryDidDocRequest', cosmosQuery.requests[0].data),
    ).toEqual({ id: 'did:cheqd:testnet:abc123' });

    expect(response.query_path).toBe('/cheqd.did.v2.Query/DidDoc');
    expect(response.source_port).toBe('icqhost');
    expect(response.source_channel).toBe('channel-3');
  });

  it('decodes a successful cheqd DidDoc acknowledgement', () => {
    const responseValue = encodeCheqdProtoMessage('cheqd.did.v2.QueryDidDocResponse', {
      value: {
        did_doc: {
          context: ['https://www.w3.org/ns/did/v1'],
          id: 'did:cheqd:testnet:abc123',
        },
        metadata: {
          deactivated: false,
          version_id: 'v1',
        },
      },
    });

    const ackBytes = encodeInterchainQueryPacketAckJson({
      data: encodeCosmosResponse({
        responses: [
          {
            code: 0,
            log: '',
            info: '',
            index: BigInt(0),
            key: new Uint8Array(),
            value: responseValue,
            height: BigInt(42),
            codespace: '',
          },
        ],
      }),
    });
    const ackHex = Buffer.from(
      JSON.stringify({
        result: Buffer.from(ackBytes).toString('base64'),
      }),
      'utf8',
    ).toString('hex');

    expect(service.decodeDidDocAcknowledgement(ackHex)).toEqual(
      expect.objectContaining({
        status: 'success',
        query_path: '/cheqd.did.v2.Query/DidDoc',
        source_port: 'icqhost',
        response: expect.objectContaining({
          value: expect.objectContaining({
            did_doc: expect.objectContaining({
              context: ['https://www.w3.org/ns/did/v1'],
              id: 'did:cheqd:testnet:abc123',
            }),
            metadata: expect.objectContaining({
              deactivated: false,
              version_id: 'v1',
            }),
          }),
        }),
        response_query: {
          code: 0,
          log: '',
          info: '',
          index: '0',
          height: '42',
          codespace: '',
          raw_value_base64: Buffer.from(responseValue).toString('base64'),
        },
      }),
    );
  });

  it('surfaces async-icq acknowledgement errors directly', () => {
    const ackHex = Buffer.from(JSON.stringify({ error: 'query path not allowed' }), 'utf8').toString('hex');

    expect(service.decodeDidDocAcknowledgement(ackHex)).toEqual({
      status: 'error',
      query_path: '/cheqd.did.v2.Query/DidDoc',
      source_port: 'icqhost',
      error: 'query path not allowed',
    });
  });
});
