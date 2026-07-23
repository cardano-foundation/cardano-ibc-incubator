import { configureSlotTimingFromSystemStart } from './time';

describe('configureSlotTimingFromSystemStart', () => {
  it('preserves Lucid public-network era timing', () => {
    const slotConfig = {
      zeroTime: Date.parse('2022-06-21T00:00:00Z'),
      zeroSlot: 86400,
      slotLength: 1000,
    };

    configureSlotTimingFromSystemStart('Preprod', slotConfig, Date.parse('2022-06-01T00:00:00Z'));

    expect(slotConfig).toEqual({
      zeroTime: Date.parse('2022-06-21T00:00:00Z'),
      zeroSlot: 86400,
      slotLength: 1000,
    });
  });

  it('initializes custom-network timing from the Ogmios system start', () => {
    const systemStart = Date.parse('2026-07-23T12:00:00Z');
    const slotConfig = {
      zeroTime: 0,
      zeroSlot: 86400,
      slotLength: 20000,
    };

    configureSlotTimingFromSystemStart('Custom', slotConfig, systemStart);

    expect(slotConfig).toEqual({
      zeroTime: systemStart,
      zeroSlot: 0,
      slotLength: 1000,
    });
  });
});
