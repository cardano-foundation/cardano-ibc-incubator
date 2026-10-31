import { PacketStateService } from '../services/packet-state.service';


describe('packet lane history occupancy', () => {
  const keys = (receipts: number, acknowledgements = receipts) => [
    ...Array.from({ length: receipts }, (_, i) => `receipts/ports/transfer/channels/channel-0/sequences/${i + 1}`),
    ...Array.from({ length: acknowledgements }, (_, i) => `acks/ports/transfer/channels/channel-0/sequences/${i + 1}`),
  ];
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
          tree: { getKeys: () => keys(32) },
          datum: {
            fields: [
              '',
              '',
              BigInt(index),
              16n,
              0n,
              '',
              new Map(),
              [],
              new Map(),
            ],
          },
        }) as any,
    );
  });

  it('keeps receive capacity available after 512 retained receives', async () => {
    const result = await state.occupancy('transfer', 'channel-0');
    expect(result.height).toBe('42');
    expect(result.lanes).toHaveLength(16);
    expect(result.lanes.every((lane) => lane.entries === 0 && lane.remaining_receive_slots === null)).toBe(true);
    expect(result.lanes.every((lane) => !lane.maintenance_required && lane.prune_candidates.length === 0 && lane.receipts === 32)).toBe(true);
  });

  it('counts only outstanding commitments against live capacity', async () => {
    lane.mockResolvedValue({
      tree: { getKeys: () => keys(2, 1) },
      datum: { fields: ['', '', 0n, 16n, 0n, '', new Map([[10n, 'commitment']]), [], new Map()] },
    } as any);
    const result = await state.occupancy('transfer', 'channel-0');
    expect(result.lanes[0]).toMatchObject({
      entries: 1,
      commitments: 1,
      receipts: 2,
      acknowledgements: 1,
      remaining_receive_slots: null,
      maintenance_required: false,
      prune_candidates: [],
    });
  });

  it('does not schedule mandatory pruning as historical receipt counts grow', async () => {
    let receives = 24;
    lane.mockImplementation(
      async () =>
        ({
          tree: { getKeys: () => keys(receives) },
          datum: {
            fields: [
              '',
              '',
              0n,
              16n,
              0n,
              '',
              new Map(),
              [],
              new Map(),
            ],
          },
        }) as any,
    );
    expect((await state.occupancy('transfer', 'channel-0')).lanes[0]).toMatchObject({
      maintenance_required: false,
      remaining_receive_slots: null,
    });
    receives = 1000;
    expect((await state.occupancy('transfer', 'channel-0')).lanes[0]).toMatchObject({
      maintenance_required: false,
      remaining_receive_slots: null,
    });
  });

  it('rejects a snapshot rolled back while lanes were read', async () => {
    history.findBlockByHeight.mockResolvedValueOnce({ hash: 'canonical' }).mockResolvedValueOnce({ hash: 'rollback' });
    await expect(state.occupancy('transfer', 'channel-0')).rejects.toThrow('rolled back');
  });
});
