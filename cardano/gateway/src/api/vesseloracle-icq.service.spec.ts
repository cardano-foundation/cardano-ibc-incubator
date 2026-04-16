import { VesseloracleIcqService } from './vesseloracle-icq.service';
import { PacketService } from '~@/tx/packet.service';
import { QueryService } from '~@/query/services/query.service';
import { GrpcNotFoundException } from '~@/exception/grpc_exceptions';
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
  let queryServiceMock: {
    latestHeight: jest.Mock;
    queryEvents: jest.Mock;
    queryBlockResults: jest.Mock;
    queryTransactionByHash: jest.Mock;
  };
  let historyServiceMock: {
    findTransactionEvidenceByHash: jest.Mock;
  };

  beforeEach(() => {
    packetServiceMock = {
      sendAsyncIcqPacket: jest.fn().mockResolvedValue({
        packet_sequence: '7',
        tx: {
          result: 1,
          unsigned_tx: {
            type_url: '/ibc.core.channel.v1.MsgTransfer',
            value: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
          },
        },
      }),
    };
    queryServiceMock = {
      latestHeight: jest.fn().mockResolvedValue({ height: 120n }),
      queryEvents: jest.fn().mockResolvedValue({ current_height: 120n, scanned_to_height: 120n, events: [] }),
      queryBlockResults: jest.fn().mockResolvedValue({ block_results: { txs_results: [] } }),
      queryTransactionByHash: jest.fn().mockResolvedValue({ hash: 'deadbeef', height: 100n }),
    };
    historyServiceMock = {
      findTransactionEvidenceByHash: jest.fn().mockResolvedValue(null),
    };

    service = new VesseloracleIcqService(
      packetServiceMock as unknown as PacketService,
      queryServiceMock as unknown as QueryService,
      historyServiceMock as any,
      {} as any,
    );
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
    expect(response.packet_sequence).toBe('7');
  });

  it('builds a vesseloracle latest-consolidated-data-report async-icq packet on the icqhost port', async () => {
    const response = await service.buildLatestConsolidatedDataReportQuery({
      source_channel: 'channel-8',
      signer: 'addr_test1qpz...',
      imo: '9525338',
    } as any);

    expect(packetServiceMock.sendAsyncIcqPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePort: 'icqhost',
        sourceChannel: 'channel-8',
        signer: 'addr_test1qpz...',
      }),
    );

    const sentPacketHex = packetServiceMock.sendAsyncIcqPacket.mock.calls[0][0].packetData as string;
    const packet = decodeInterchainQueryPacketDataJson(Buffer.from(sentPacketHex, 'hex'));
    const cosmosQuery = decodeCosmosQuery(packet.data);
    expect(cosmosQuery.requests).toHaveLength(1);
    expect(cosmosQuery.requests[0].path).toBe('/vesseloracle.vesseloracle.Query/LatestConsolidatedDataReport');
    expect(
      decodeVesseloracleProtoMessage(
        'vesseloracle.vesseloracle.QueryLatestConsolidatedDataReportRequest',
        cosmosQuery.requests[0].data,
      ),
    ).toEqual({ imo: '9525338' });

    expect(response.query_path).toBe('/vesseloracle.vesseloracle.Query/LatestConsolidatedDataReport');
    expect(response.source_port).toBe('icqhost');
    expect(response.source_channel).toBe('channel-8');
    expect(response.packet_sequence).toBe('7');
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

  it('decodes a successful vesseloracle latest-consolidated-data-report acknowledgement', () => {
    const responseValue = encodeVesseloracleProtoMessage(
      'vesseloracle.vesseloracle.QueryLatestConsolidatedDataReportResponse',
      {
        consolidatedDataReport: {
          imo: '9525338',
          ts: 1713110401,
          total_samples: 13,
          eta_outliers: 0,
          eta_mean_cleaned: 1713114100,
          eta_mean_all: 1713114200,
          eta_std_cleaned: 60,
          eta_std_all: 180,
          depport_score: 96,
          depport: 'ARBUE',
          creator: 'cosmos1creator',
        },
      },
    );

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
            height: BigInt(43),
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

    expect(service.decodeLatestConsolidatedDataReportAcknowledgement(ackHex)).toEqual(
      expect.objectContaining({
        status: 'success',
        query_path: '/vesseloracle.vesseloracle.Query/LatestConsolidatedDataReport',
        source_port: 'icqhost',
        response: expect.objectContaining({
          consolidatedDataReport: expect.objectContaining({
            imo: '9525338',
            ts: '1713110401',
            total_samples: 13,
          }),
        }),
        response_query: {
          code: 0,
          log: '',
          info: '',
          index: '0',
          height: '43',
          codespace: '',
          raw_value_base64: Buffer.from(responseValue).toString('base64'),
        },
      }),
    );
  });

  it('keeps returning a pending result when tx indexing still lags on later polls', async () => {
    queryServiceMock.queryTransactionByHash.mockRejectedValue(new GrpcNotFoundException('not found'));

    await expect(
      service.findResult({
        tx_hash: 'deadbeef',
        since_height: '120',
        query_path: '/vesseloracle.vesseloracle.Query/LatestConsolidatedDataReport',
        packet_data_hex: 'c0ffee',
      } as any),
    ).resolves.toEqual({
      status: 'pending',
      reason: 'source_tx_not_indexed',
      tx_hash: 'deadbeef',
      query_path: '/vesseloracle.vesseloracle.Query/LatestConsolidatedDataReport',
      packet_data_hex: 'c0ffee',
      current_height: '120',
      next_search_from_height: '120',
    });
  });
});
