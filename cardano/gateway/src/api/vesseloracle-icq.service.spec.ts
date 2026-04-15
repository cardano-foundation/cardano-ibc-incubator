import { VesseloracleIcqService } from './vesseloracle-icq.service';
import { PacketService } from '~@/tx/packet.service';
import {
  decodeVesseloracleProtoMessage,
  encodeVesseloracleProtoMessage,
} from '@shared/types/apps/async-icq/vesseloracle-icq';
import {
  decodeCosmosQuery,
  decodeInterchainQueryPacketDataJson,
  encodeCosmosResponse,
  encodeInterchainQueryPacketAckJson,
} from '@shared/types/apps/async-icq/async-icq';

describe('VesseloracleIcqService', () => {
  let service: VesseloracleIcqService;
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

    service = new VesseloracleIcqService(packetServiceMock as unknown as PacketService);
  });

  it('builds a vesseloracle consolidated-data-report async-icq packet on the icqhost port', async () => {
    const response = await service.buildConsolidatedDataReportQuery({
      source_channel: 'channel-7',
      signer: 'addr_test1qpz...',
      imo: '9525338',
      ts: '1713110400',
    } as any);

    expect(packetServiceMock.sendAsyncIcqPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePort: 'icqhost',
        sourceChannel: 'channel-7',
        signer: 'addr_test1qpz...',
      }),
    );

    const sentPacketHex = packetServiceMock.sendAsyncIcqPacket.mock.calls[0][0].packetData as string;
    const packet = decodeInterchainQueryPacketDataJson(Buffer.from(sentPacketHex, 'hex'));
    const cosmosQuery = decodeCosmosQuery(packet.data);
    expect(cosmosQuery.requests).toHaveLength(1);
    expect(cosmosQuery.requests[0].path).toBe('/vesseloracle.vesseloracle.Query/ConsolidatedDataReport');
    expect(
      decodeVesseloracleProtoMessage(
        'vesseloracle.vesseloracle.QueryGetConsolidatedDataReportRequest',
        cosmosQuery.requests[0].data,
      ),
    ).toEqual({ imo: '9525338', ts: '1713110400' });

    expect(response.query_path).toBe('/vesseloracle.vesseloracle.Query/ConsolidatedDataReport');
    expect(response.source_port).toBe('icqhost');
    expect(response.source_channel).toBe('channel-7');
  });

  it('decodes a successful vesseloracle consolidated-data-report acknowledgement', () => {
    const responseValue = encodeVesseloracleProtoMessage('vesseloracle.vesseloracle.QueryGetConsolidatedDataReportResponse', {
      consolidatedDataReport: {
        imo: '9525338',
        ts: 1713110400,
        total_samples: 12,
        eta_outliers: 1,
        eta_mean_cleaned: 1713114000,
        eta_mean_all: 1713115000,
        eta_std_cleaned: 120,
        eta_std_all: 240,
        depport_score: 95,
        depport: 'ARBUE',
        creator: 'cosmos1creator',
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

    expect(service.decodeConsolidatedDataReportAcknowledgement(ackHex)).toEqual(
      expect.objectContaining({
        status: 'success',
        query_path: '/vesseloracle.vesseloracle.Query/ConsolidatedDataReport',
        source_port: 'icqhost',
        response: expect.objectContaining({
          consolidatedDataReport: expect.objectContaining({
            imo: '9525338',
            ts: '1713110400',
            total_samples: 12,
            eta_outliers: 1,
            eta_mean_cleaned: '1713114000',
            eta_mean_all: '1713115000',
            eta_std_cleaned: '120',
            eta_std_all: '240',
            depport_score: 95,
            depport: 'ARBUE',
            creator: 'cosmos1creator',
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
});
