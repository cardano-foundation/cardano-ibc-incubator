import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GrpcInvalidArgumentException, GrpcNotFoundException } from '~@/exception/grpc_exceptions';
import { ATTRIBUTE_KEY_PACKET, CHANNEL_TOKEN_PREFIX, EVENT_TYPE_PACKET } from '../../constant';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { MiniProtocalsService } from '../../shared/modules/mini-protocals/mini-protocals.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { DenomTraceService } from '../services/denom-trace.service';
import { HistoryService } from '../services/history.service';
import { QueryService } from '../services/query.service';

describe('QueryService packet event queries', () => {
  const hostStateNFT = { policyId: 'host-policy', name: 'host-name' };
  const mintChannelScriptHash = 'mint-channel-policy';

  let service: QueryService;
  let configServiceMock: { get: jest.Mock };
  let historyServiceMock: {
    findTxByHash: jest.Mock;
    findUtxosByBlockNo: jest.Mock;
    findUtxosByPolicyIdAndPrefixTokenName: jest.Mock;
  };
  let lucidServiceMock: { generateTokenName: jest.Mock };

  const packetEvent = (type = EVENT_TYPE_PACKET.SEND_PACKET, overrides: Record<string, string> = {}) => ({
    type,
    event_attribute: Object.entries({
      [ATTRIBUTE_KEY_PACKET.PACKET_SEQUENCE]: '7',
      [ATTRIBUTE_KEY_PACKET.PACKET_SRC_PORT]: 'transfer',
      [ATTRIBUTE_KEY_PACKET.PACKET_SRC_CHANNEL]: 'channel-1',
      [ATTRIBUTE_KEY_PACKET.PACKET_DST_PORT]: 'transfer',
      [ATTRIBUTE_KEY_PACKET.PACKET_DST_CHANNEL]: 'channel-2',
      [ATTRIBUTE_KEY_PACKET.PACKET_DATA_HEX]: 'a1b2',
      ...overrides,
    }).map(([key, value]) => ({ key, value })),
  });

  const makeUtxo = (overrides: Record<string, unknown> = {}) =>
    ({
      txHash: 'abc123',
      txId: 1,
      outputIndex: 0,
      assetsPolicy: mintChannelScriptHash,
      assetsName: 'channel-token',
      datum: 'datum',
      blockNo: 42,
      ...overrides,
    }) as any;

  beforeEach(() => {
    const loggerMock = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;

    configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key !== 'deployment') return undefined;
        return {
          hostStateNFT,
          validators: {
            mintChannelStt: {
              scriptHash: mintChannelScriptHash,
            },
          },
        };
      }),
    };

    historyServiceMock = {
      findTxByHash: jest.fn(),
      findUtxosByBlockNo: jest.fn(),
      findUtxosByPolicyIdAndPrefixTokenName: jest.fn(),
    };

    lucidServiceMock = {
      generateTokenName: jest.fn((_baseToken, _prefix, channelNumber: bigint) => `channel-token-${channelNumber}`),
    };

    service = new QueryService(
      loggerMock,
      configServiceMock as unknown as ConfigService,
      lucidServiceMock as unknown as LucidService,
      {} as KupoService,
      historyServiceMock as unknown as HistoryService,
      {} as MiniProtocalsService,
      {} as MithrilService,
      {} as DenomTraceService,
    );
  });

  it('returns normalized packet events for a Cardano transaction hash', async () => {
    historyServiceMock.findTxByHash.mockResolvedValue({ hash: 'ABC123', height: 42 });
    historyServiceMock.findUtxosByBlockNo.mockResolvedValue([
      makeUtxo({ txHash: 'ABC123', outputIndex: 0 }),
      makeUtxo({ txHash: 'ABC123', outputIndex: 1, assetsPolicy: 'other-policy' }),
      makeUtxo({ txHash: 'other-tx', outputIndex: 2 }),
    ]);
    const parseSpy = jest.spyOn(service as any, '_parseEventChannel').mockResolvedValue({
      events: [
        packetEvent(EVENT_TYPE_PACKET.SEND_PACKET),
        packetEvent(EVENT_TYPE_PACKET.WRITE_ACKNOWLEDGEMENT, {
          [ATTRIBUTE_KEY_PACKET.PACKET_ACK_HEX]: 'beef',
        }),
        { type: 'create_client', event_attribute: [] },
      ],
    });

    const response = await service.queryPacketEventsByTxHash('ABC123');

    expect(historyServiceMock.findTxByHash).toHaveBeenCalledWith('abc123');
    expect(historyServiceMock.findUtxosByBlockNo).toHaveBeenCalledWith(42);
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(response).toEqual({
      tx_hash: 'ABC123',
      height: '42',
      indexed: true,
      events: [
        {
          tx_hash: 'ABC123',
          height: '42',
          type: EVENT_TYPE_PACKET.SEND_PACKET,
          attributes: {
            packet_sequence: '7',
            packet_src_port: 'transfer',
            packet_src_channel: 'channel-1',
            packet_dst_port: 'transfer',
            packet_dst_channel: 'channel-2',
            packet_data_hex: 'a1b2',
          },
          packet: {
            sequence: '7',
            source_port: 'transfer',
            source_channel: 'channel-1',
            destination_port: 'transfer',
            destination_channel: 'channel-2',
            data_hex: 'a1b2',
          },
        },
        {
          tx_hash: 'ABC123',
          height: '42',
          type: EVENT_TYPE_PACKET.WRITE_ACKNOWLEDGEMENT,
          attributes: {
            packet_sequence: '7',
            packet_src_port: 'transfer',
            packet_src_channel: 'channel-1',
            packet_dst_port: 'transfer',
            packet_dst_channel: 'channel-2',
            packet_data_hex: 'a1b2',
            packet_ack_hex: 'beef',
          },
          packet: {
            sequence: '7',
            source_port: 'transfer',
            source_channel: 'channel-1',
            destination_port: 'transfer',
            destination_channel: 'channel-2',
            data_hex: 'a1b2',
            acknowledgement_hex: 'beef',
          },
        },
      ],
    });
  });

  it('preserves malformed packet events without a normalized packet summary', async () => {
    historyServiceMock.findTxByHash.mockResolvedValue({ hash: 'abc123', height: 42 });
    historyServiceMock.findUtxosByBlockNo.mockResolvedValue([makeUtxo()]);
    jest.spyOn(service as any, '_parseEventChannel').mockResolvedValue({
      events: [
        {
          type: EVENT_TYPE_PACKET.TIMEOUT_PACKET,
          event_attribute: [{ key: ATTRIBUTE_KEY_PACKET.PACKET_SEQUENCE, value: '7' }],
        },
      ],
    });

    const response = await service.queryPacketEventsByTxHash('abc123');

    expect(response.events).toEqual([
      {
        tx_hash: 'abc123',
        height: '42',
        type: EVENT_TYPE_PACKET.TIMEOUT_PACKET,
        attributes: {
          packet_sequence: '7',
        },
        packet: null,
      },
    ]);
  });

  it('rejects missing and unknown transaction hashes', async () => {
    await expect(service.queryPacketEventsByTxHash('')).rejects.toThrow(GrpcInvalidArgumentException);

    historyServiceMock.findTxByHash.mockResolvedValue(null);

    await expect(service.queryPacketEventsByTxHash('missing')).rejects.toThrow(GrpcNotFoundException);
  });

  it('searches both packet channel endpoints and returns matching events sorted by height', async () => {
    const firstUtxo = makeUtxo({ txHash: 'older', outputIndex: 0, blockNo: 10 });
    const duplicateUtxo = makeUtxo({ txHash: 'newer', outputIndex: 1, blockNo: 12 });
    const unmatchedUtxo = makeUtxo({ txHash: 'newer', outputIndex: 2, blockNo: 12 });
    historyServiceMock.findUtxosByPolicyIdAndPrefixTokenName
      .mockResolvedValueOnce([duplicateUtxo, unmatchedUtxo])
      .mockResolvedValueOnce([firstUtxo, duplicateUtxo]);
    jest.spyOn(service as any, '_parseEventChannel').mockImplementation(async (utxo: any) => {
      if (utxo.txHash === 'older') {
        return {
          events: [
            packetEvent(EVENT_TYPE_PACKET.ACKNOWLEDGE_PACKET, {
              [ATTRIBUTE_KEY_PACKET.PACKET_ACK_HEX]: 'cafe',
            }),
          ],
        };
      }
      if (utxo.outputIndex === 1) {
        return {
          events: [
            packetEvent(EVENT_TYPE_PACKET.ACKNOWLEDGE_PACKET, {
              [ATTRIBUTE_KEY_PACKET.PACKET_ACK_HEX]: 'feed',
            }),
          ],
        };
      }
      return {
        events: [
          packetEvent(EVENT_TYPE_PACKET.ACKNOWLEDGE_PACKET, {
            [ATTRIBUTE_KEY_PACKET.PACKET_SEQUENCE]: '8',
          }),
        ],
      };
    });

    const response = await service.queryPacketEventsByPacket({
      sourceChannel: 'channel-1',
      destinationChannel: 'channel-2',
      sequence: '7',
      eventType: EVENT_TYPE_PACKET.ACKNOWLEDGE_PACKET,
    });

    expect(lucidServiceMock.generateTokenName).toHaveBeenNthCalledWith(1, hostStateNFT, CHANNEL_TOKEN_PREFIX, 1n);
    expect(lucidServiceMock.generateTokenName).toHaveBeenNthCalledWith(2, hostStateNFT, CHANNEL_TOKEN_PREFIX, 2n);
    expect(historyServiceMock.findUtxosByPolicyIdAndPrefixTokenName).toHaveBeenNthCalledWith(
      1,
      mintChannelScriptHash,
      'channel-token-1',
    );
    expect(historyServiceMock.findUtxosByPolicyIdAndPrefixTokenName).toHaveBeenNthCalledWith(
      2,
      mintChannelScriptHash,
      'channel-token-2',
    );
    expect(response.events).toMatchObject([
      {
        tx_hash: 'older',
        height: '10',
        type: EVENT_TYPE_PACKET.ACKNOWLEDGE_PACKET,
        packet: {
          sequence: '7',
          acknowledgement_hex: 'cafe',
        },
      },
      {
        tx_hash: 'newer',
        height: '12',
        type: EVENT_TYPE_PACKET.ACKNOWLEDGE_PACKET,
        packet: {
          sequence: '7',
          acknowledgement_hex: 'feed',
        },
      },
    ]);
  });

  it('rejects invalid packet event search parameters', async () => {
    await expect(
      service.queryPacketEventsByPacket({
        sourceChannel: 'bad-1',
        destinationChannel: 'channel-2',
        sequence: '7',
      }),
    ).rejects.toThrow(GrpcInvalidArgumentException);

    await expect(
      service.queryPacketEventsByPacket({
        sourceChannel: 'channel-1',
        destinationChannel: 'bad-2',
        sequence: '7',
      }),
    ).rejects.toThrow(GrpcInvalidArgumentException);

    await expect(
      service.queryPacketEventsByPacket({
        sourceChannel: 'channel-1',
        destinationChannel: 'channel-2',
        sequence: 'not-a-number',
      }),
    ).rejects.toThrow(GrpcInvalidArgumentException);
  });
});
