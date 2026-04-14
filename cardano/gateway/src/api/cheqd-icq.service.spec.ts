import { CheqdIcqService } from './cheqd-icq.service';
import { PacketService } from '~@/tx/packet.service';
import { QueryService } from '~@/query/services/query.service';
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
import { EVENT_TYPE_PACKET, ATTRIBUTE_KEY_PACKET } from '~@/constant/packet';
import { GrpcNotFoundException } from '~@/exception/grpc_exceptions';
import { decodeSpendChannelRedeemer } from '@shared/types/channel/channel-redeemer';

jest.mock('@shared/types/channel/channel-redeemer', () => ({
  decodeSpendChannelRedeemer: jest.fn(),
}));

describe('CheqdIcqService', () => {
  let service: CheqdIcqService;
  let packetServiceMock: {
    sendAsyncIcqPacket: jest.Mock;
  };
  let queryServiceMock: {
    latestHeight: jest.Mock;
    queryEvents: jest.Mock;
    queryTransactionByHash: jest.Mock;
  };
  let historyServiceMock: {
    findTransactionEvidenceByHash: jest.Mock;
  };
  let lucidServiceMock: {
    LucidImporter: Record<string, never>;
  };
  const decodeSpendChannelRedeemerMock = jest.mocked(decodeSpendChannelRedeemer);

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
    queryServiceMock = {
      latestHeight: jest.fn().mockResolvedValue({ height: 120n }),
      queryEvents: jest.fn().mockResolvedValue({ current_height: 120n, scanned_to_height: 120n, events: [] }),
      queryTransactionByHash: jest.fn().mockResolvedValue({ hash: 'deadbeef', height: 100n }),
    };
    historyServiceMock = {
      findTransactionEvidenceByHash: jest.fn().mockResolvedValue({
        txHash: 'deadbeef',
        blockNo: 100,
        txIndex: 0,
        txCborHex: '',
        txBodyCborHex: '',
        redeemers: [
          {
            type: 'spend',
            data: '1234567890ab',
            index: 0,
          },
        ],
      }),
    };
    lucidServiceMock = {
      LucidImporter: {},
    };
    decodeSpendChannelRedeemerMock.mockReturnValue({
      SendPacket: {
        packet: {
          sequence: 7n,
          source_channel: Buffer.from('channel-3', 'utf8').toString('hex'),
          data: 'c0ffee',
        },
      },
    } as any);

    service = new CheqdIcqService(
      packetServiceMock as unknown as PacketService,
      queryServiceMock as unknown as QueryService,
      historyServiceMock as any,
      lucidServiceMock as any,
    );
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

  it('returns a pending result when the source tx is not indexed yet', async () => {
    historyServiceMock.findTransactionEvidenceByHash.mockResolvedValue(null);
    queryServiceMock.queryTransactionByHash.mockRejectedValue(new GrpcNotFoundException('not found'));

    await expect(
      service.findResult({
        tx_hash: 'deadbeef',
        query_path: '/cheqd.did.v2.Query/DidDoc',
        packet_data_hex: 'c0ffee',
      } as any),
    ).resolves.toEqual({
      status: 'pending',
      reason: 'source_tx_not_indexed',
      tx_hash: 'deadbeef',
      query_path: '/cheqd.did.v2.Query/DidDoc',
      packet_data_hex: 'c0ffee',
      current_height: '120',
      next_search_from_height: '120',
    });
  });

  it('returns a pending result when the source tx exists but tx evidence is not indexed yet', async () => {
    historyServiceMock.findTransactionEvidenceByHash.mockResolvedValue(null);

    await expect(
      service.findResult({
        tx_hash: 'deadbeef',
        query_path: '/cheqd.did.v2.Query/DidDoc',
        packet_data_hex: 'c0ffee',
      } as any),
    ).resolves.toEqual({
      status: 'pending',
      reason: 'source_tx_not_indexed',
      tx_hash: 'deadbeef',
      query_path: '/cheqd.did.v2.Query/DidDoc',
      packet_data_hex: 'c0ffee',
      current_height: '120',
      next_search_from_height: '120',
    });
  });

  it('advances the polling cursor only to the scanned query-events window when no acknowledgement is found', async () => {
    queryServiceMock.queryEvents.mockResolvedValue({
      current_height: 500n,
      scanned_to_height: 200n,
      events: [],
    });

    await expect(
      service.findResult({
        tx_hash: 'deadbeef',
        query_path: '/cheqd.did.v2.Query/DidDoc',
        packet_data_hex: 'c0ffee',
      } as any),
    ).resolves.toEqual({
      status: 'pending',
      reason: 'pending_acknowledgement',
      tx_hash: 'deadbeef',
      query_path: '/cheqd.did.v2.Query/DidDoc',
      packet_data_hex: 'c0ffee',
      current_height: '500',
      next_search_from_height: '200',
    });
  });

  it('matches acknowledge_packet events by source channel and packet sequence', async () => {
    const responseValue = encodeCheqdProtoMessage('cheqd.did.v2.QueryDidDocResponse', {
      value: {
        did_doc: {
          id: 'did:cheqd:testnet:abc123',
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
    const acknowledgementHex = Buffer.from(
      JSON.stringify({
        result: Buffer.from(ackBytes).toString('base64'),
      }),
      'utf8',
    ).toString('hex');

    queryServiceMock.queryEvents.mockResolvedValue({
      current_height: 125n,
      scanned_to_height: 125n,
      events: [
        {
          height: 117n,
          events: [
            {
              code: 0,
              events: [
                {
                  type: EVENT_TYPE_PACKET.ACKNOWLEDGE_PACKET,
                  event_attribute: [
                    {
                      key: ATTRIBUTE_KEY_PACKET.PACKET_DATA_HEX,
                      value: 'c0ffee',
                    },
                    {
                      key: ATTRIBUTE_KEY_PACKET.PACKET_ACK_HEX,
                      value: 'wrong-ack',
                    },
                    {
                      key: ATTRIBUTE_KEY_PACKET.PACKET_SEQUENCE,
                      value: '8',
                    },
                    {
                      key: ATTRIBUTE_KEY_PACKET.PACKET_SRC_CHANNEL,
                      value: 'channel-3',
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          height: 118n,
          events: [
            {
              code: 0,
              events: [
                {
                  type: EVENT_TYPE_PACKET.ACKNOWLEDGE_PACKET,
                  event_attribute: [
                    {
                      key: ATTRIBUTE_KEY_PACKET.PACKET_DATA_HEX,
                      value: 'c0ffee',
                    },
                    {
                      key: ATTRIBUTE_KEY_PACKET.PACKET_ACK_HEX,
                      value: acknowledgementHex,
                    },
                    {
                      key: ATTRIBUTE_KEY_PACKET.PACKET_SEQUENCE,
                      value: '7',
                    },
                    {
                      key: ATTRIBUTE_KEY_PACKET.PACKET_SRC_CHANNEL,
                      value: 'channel-3',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    await expect(
      service.findResult({
        tx_hash: 'deadbeef',
        query_path: '/cheqd.did.v2.Query/DidDoc',
        packet_data_hex: 'c0ffee',
        source_channel: 'channel-3',
      } as any),
    ).resolves.toEqual({
      status: 'completed',
      tx_hash: 'deadbeef',
      query_path: '/cheqd.did.v2.Query/DidDoc',
      packet_data_hex: 'c0ffee',
      current_height: '125',
      next_search_from_height: '118',
      completed_height: '118',
      packet_sequence: '7',
      acknowledgement_hex: acknowledgementHex,
      acknowledgement: expect.objectContaining({
        status: 'success',
        query_path: '/cheqd.did.v2.Query/DidDoc',
        response: expect.objectContaining({
          value: expect.objectContaining({
            did_doc: expect.objectContaining({
              id: 'did:cheqd:testnet:abc123',
            }),
          }),
        }),
      }),
    });
  });
});
