import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelService } from '../services/channel.service';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { HistoryService } from '../services/history.service';
import { decodeChannelDatum } from '../../shared/types/channel/channel-datum';
import { listPacketStoreEntries } from '../../shared/helpers/packet-state-store';

jest.mock('../../shared/types/channel/channel-datum', () => ({
  decodeChannelDatum: jest.fn(),
}));

jest.mock('../../shared/helpers/ibc-state-root', () => ({
  getCurrentTree: jest.fn(() => ({})),
  isTreeAligned: jest.fn(() => true),
  alignTreeWithChain: jest.fn(),
}));

jest.mock('../../shared/helpers/packet-state-store', () => ({
  listPacketStoreEntries: jest.fn(),
}));

function toHex(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex');
}

function makeChannelDatum(ordering: 'Ordered' | 'Unordered') {
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
    findUtxoAtHostStateNFT: jest.fn(async () => ({ datum: 'host-state-datum' })),
    decodeDatum: jest.fn(async () => ({ state: { ibc_state_root: 'ab'.repeat(32) } })),
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
    (decodeChannelDatum as jest.Mock).mockResolvedValue(makeChannelDatum('Ordered'));
    (listPacketStoreEntries as jest.Mock).mockReturnValue([
      { sequence: 1n, value: 'aa' },
      { sequence: 3n, value: 'bb' },
    ]);
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
    (decodeChannelDatum as jest.Mock).mockResolvedValue(makeChannelDatum('Unordered'));
    (listPacketStoreEntries as jest.Mock).mockReturnValue([{ sequence: 1n, value: 'aa' }]);
    const { service } = makeService();

    await expect(service.getChannelHealth('channel-0', 'transfer')).resolves.toMatchObject({
      ordering: 'Unordered',
      status: 'available',
      reason: null,
      pending_packet_commitment_count: '1',
    });
  });
});
