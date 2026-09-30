import { epochTimingAtSlot } from './epoch-timing';

describe('epochTimingAtSlot', () => {
  const eras = [
    {
      start: { slot: 0, epoch: 0 },
      end: { slot: 4_492_800 },
      parameters: { epochLength: 21_600, slotLength: { milliseconds: 20_000 } },
    },
    {
      start: { slot: 4_492_800, epoch: 208 },
      parameters: { epochLength: 432_000, slotLength: { milliseconds: 1_000 } },
    },
  ];

  it('uses the era boundary rather than the first produced block', () => {
    expect(epochTimingAtSlot(eras, 4_492_800n + 432_000n + 1_000n, 209)).toEqual({
      firstEpochSlot: 4_492_800n + 432_000n,
      epochLengthSlots: 432_000n,
      slotLengthMs: 1_000,
    });
  });

  it('rejects stale history that reports the wrong epoch', () => {
    expect(() => epochTimingAtSlot(eras, 4_492_800n + 432_000n, 208)).toThrow();
  });
});
