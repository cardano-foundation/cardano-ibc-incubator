import { ledgerVisibleValidityUpperBoundMs } from './time';

describe('ledgerVisibleValidityUpperBoundMs', () => {
  const slotConfig = { zeroTime: 1_500, zeroSlot: 10, slotLength: 1_000 };

  it('normalizes a non-slot-aligned bound to the enclosing slot start', () => {
    expect(ledgerVisibleValidityUpperBoundMs(4_750, slotConfig)).toBe(4_500);
  });

  it('preserves an exact slot boundary', () => {
    expect(ledgerVisibleValidityUpperBoundMs(4_500, slotConfig)).toBe(4_500);
  });

  it('rejects an invalid slot configuration', () => {
    expect(() => ledgerVisibleValidityUpperBoundMs(4_500, { ...slotConfig, slotLength: 0 })).toThrow(
      'Invalid Cardano validity upper bound or slot configuration',
    );
  });
});
