import { createTestTreeStore } from '../../shared/testing/ibc-tree-test-store';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelService } from '../services/channel.service';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { HistoryService } from '../services/history.service';
import { decodeChannelDatum } from '../../shared/types/channel/channel-datum';

jest.mock('../../shared/types/channel/channel-datum', () => ({
  decodeChannelDatum: jest.fn(),
}));

function toHex(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex');
}

function makeChannelDatum(ordering: 'Ordered' | 'Unordered', pendingSequences: bigint[]) {
  return {
    port: toHex('transfer'),
    state: {
      channel: {
        state: 'Open',
        ordering,
        counterparty: {
          port_id: toHex('transfer'),
          channel_id: toHex('channel-0'),
        },
        connection_hops: [toHex('connection-0')],
        version: toHex('ics20-1'),
      },
      upgrade: { pending: null, error_receipt: null, recv_start_sequence: 0n },
      next_sequence_send: 9n,
      next_sequence_recv: 1n,
      next_sequence_ack: 1n,
      minimum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
      maximum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
      packet_commitment: new Map(pendingSequences.map((sequence) => [sequence, 'commitment'])),
      packet_receipt: new Map(),
      packet_acknowledgement: new Map(),
    },
    token: {
      policyId: 'policy',
      name: 'name',
    },
  };
}

function makeService(packetState?: any) {
  const lucidService = {
    LucidImporter: { Data: { from: jest.fn() } },
    findUtxoByUnit: jest.fn(),
    getChannelTokenUnit: jest.fn(() => ['policy', 'channel-token']),
    findUtxoAtWithUnit: jest.fn(async () => ({
      txHash: 'channel-utxo',
      outputIndex: 0,
      datum: 'channel-datum',
    })),
  };

  const service = new ChannelService(
    {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger,
    {
      get: jest.fn((key: string) => {
        if (key === 'deployment') {
          return {
            packetState,
            validators: {
              spendChannel: {
                address: 'addr_test1...',
              },
            },
          };
        }
        return undefined;
      }),
    } as unknown as ConfigService,
    lucidService as unknown as LucidService,
    {} as KupoService,
    {
      findLatestBlock: jest.fn(async () => ({ height: 42 })),
      rebuildPacketLaneTreeAtBlock: jest.fn(async () => ({ tree: { getKeys: () => ['acks/ports/transfer/channels/channel-0/sequences/2'] } })),
    } as unknown as HistoryService,
    {} as any,
      createTestTreeStore(),
  );

  return { service, lucidService };
}

describe('ChannelService.getChannelHealth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks ordered channels with pending packet commitments as blocked', async () => {
    (decodeChannelDatum as jest.Mock).mockResolvedValue(makeChannelDatum('Ordered', [3n, 1n]));
    const { service } = makeService();

    const response = await service.getChannelHealth('channel-0', 'transfer');

    expect(response).toMatchObject({
      port_id: 'transfer',
      channel_id: 'channel-0',
      ordering: 'Ordered',
      status: 'blocked',
      pending_packet_commitment_count: '2',
      earliest_pending_packet_sequence: '1',
      pending_packet_commitment_sequences: ['1', '3'],
      next_sequence_send: '9',
    });
    expect(response.reason).toContain('earliest sequence 1');
  });

  it('leaves unordered channels available even when packet commitments are pending', async () => {
    (decodeChannelDatum as jest.Mock).mockResolvedValue(makeChannelDatum('Unordered', [1n]));
    const { service } = makeService();

    await expect(service.getChannelHealth('channel-0', 'transfer')).resolves.toMatchObject({
      ordering: 'Unordered',
      status: 'available',
      reason: null,
      pending_packet_commitment_count: '1',
    });
  });
  it('reports lane obligations and disables sending on an unordered flushing channel', async () => {
    const { packetLaneTokenName, sendSequencerTokenName } = await import('@cardano-ibc/tx-builder/dist/packet-lanes');
    const datum: any = makeChannelDatum('Unordered', []);
    datum.state.channel.state = 'Flushing';
    datum.state.upgrade.pending = { flushed_lanes: 1n, counterparty_upgrade: null };
    (decodeChannelDatum as jest.Mock).mockResolvedValue(datum);
    const packetState = { laneCount: 2, state: { scriptHash: 'aa'.repeat(28) } };
    const { service, lucidService } = makeService(packetState);
    const data: Record<string, any> = {};
    for (const lane of [0, 1]) {
      data[packetState.state.scriptHash + packetLaneTokenName('transfer', 'channel-0', lane, 2)] = {
        fields: [toHex('transfer'), toHex('channel-0'), BigInt(lane), 2n, 0n, '',
          new Map(lane === 1 ? [[5n, 'aa']] : []), [], new Map()],
      };
    }
    data[packetState.state.scriptHash + sendSequencerTokenName('transfer', 'channel-0')] = {
      fields: [toHex('transfer'), toHex('channel-0'), '', 11n],
    };
    lucidService.LucidImporter.Data.from.mockImplementation((value: string) => data[value]);
    lucidService.findUtxoByUnit.mockImplementation(async (unit: string) => ({ datum: unit, assets: { [unit]: 1n } }));
    const response = await service.getChannelHealth('channel-0');
    expect(response).toMatchObject({
      status: 'blocked', sending_available: false, next_sequence_send: '11',
      pending_packet_commitment_sequences: ['5'],
      flushing: { certified_lane_count: '1', remaining_lane_count: '1', awaiting_counterparty_upgrade: true },
      packet_lanes: [
        { lane: 0, certified_empty: true, pending_packet_commitment_sequences: [], retained_acknowledgement_count: '1' },
        { lane: 1, certified_empty: false, pending_packet_commitment_sequences: ['5'], retained_acknowledgement_count: '1' },
      ],
    });
    lucidService.findUtxoByUnit.mockRejectedValue(new Error('endpoint unavailable'));
    await expect(service.getChannelHealth('channel-0')).rejects.toThrow('endpoint unavailable');
  });

});
