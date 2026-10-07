import { PacketStateService } from '../services/packet-state.service';

jest.mock('@cardano-ibc/tx-builder-runtime/packetLaneTransactions', () => ({ laneTree: jest.fn() }));

describe('packet lane maintenance occupancy', () => {
  const history = { findBlockByHeight: jest.fn() };
  const state = new PacketStateService(
    { getOrThrow: () => ({ packetState: { laneCount: 16 } }) } as any,
    {} as any,
    history as any,
    {} as any,
  );
  const lane = jest.spyOn(state, 'lane');
  beforeEach(() => {
    jest.spyOn(state, 'height').mockResolvedValue(42n);
    history.findBlockByHeight.mockReset().mockResolvedValue({ hash: 'canonical' });
    lane.mockImplementation(
      async (_port, _channel, index) =>
        ({
          datum: {
            fields: [
              '',
              '',
              BigInt(index),
              16n,
              0n,
              '',
              new Map(),
              Array.from({ length: 32 }, (_, i) => BigInt(i + 1)),
              new Map(Array.from({ length: 32 }, (_, i) => [BigInt(i + 1), 'ack'])),
            ],
          },
        }) as any,
    );
  });

  it('reports 512 unpruned receives as full rather than spare channel capacity', async () => {
    const result = await state.occupancy('transfer', 'channel-0');
    expect(result.height).toBe('42');
    expect(result.lanes).toHaveLength(16);
    expect(result.lanes.every((lane) => lane.entries === 64 && lane.remaining_receive_slots === 0)).toBe(true);
    expect(result.lanes.every((lane) => lane.maintenance_required && lane.prune_candidates.length === 32)).toBe(true);
  });

  it('counts commitments too and only lists complete history pairs', async () => {
    lane.mockResolvedValue({
      datum: { fields: ['', '', 0n, 16n, 0n, '', new Map([[10n, 'commitment']]), [1n, 2n], new Map([[1n, 'ack']])] },
    } as any);
    const result = await state.occupancy('transfer', 'channel-0');
    expect(result.lanes[0]).toMatchObject({
      entries: 4,
      commitments: 1,
      receipts: 2,
      acknowledgements: 1,
      remaining_receive_slots: 30,
      maintenance_required: false,
      prune_candidates: ['1'],
    });
  });

  it('requires maintenance before the lane fills and reflects pruning at the next height', async () => {
    let receives = 24;
    lane.mockImplementation(
      async () =>
        ({
          datum: {
            fields: [
              '',
              '',
              0n,
              16n,
              0n,
              '',
              new Map(),
              Array.from({ length: receives }, (_, i) => BigInt(i + 1)),
              new Map(Array.from({ length: receives }, (_, i) => [BigInt(i + 1), 'ack'])),
            ],
          },
        }) as any,
    );
    expect((await state.occupancy('transfer', 'channel-0')).lanes[0]).toMatchObject({
      maintenance_required: true,
      remaining_receive_slots: 8,
    });
    receives = 8;
    expect((await state.occupancy('transfer', 'channel-0')).lanes[0]).toMatchObject({
      maintenance_required: false,
      remaining_receive_slots: 24,
    });
  });

  it('rejects a snapshot rolled back while lanes were read', async () => {
    history.findBlockByHeight.mockResolvedValueOnce({ hash: 'canonical' }).mockResolvedValueOnce({ hash: 'rollback' });
    await expect(state.occupancy('transfer', 'channel-0')).rejects.toThrow('rolled back');
  });
});
