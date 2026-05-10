import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelService } from '../services/channel.service';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
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
      next_sequence_send: 9n,
      next_sequence_recv: 1n,
      next_sequence_ack: 1n,
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

function makeService() {
  const lucidService = {
    LucidImporter: {},
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
    {} as MithrilService,
    {} as HistoryService,
    {} as any,
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
});
