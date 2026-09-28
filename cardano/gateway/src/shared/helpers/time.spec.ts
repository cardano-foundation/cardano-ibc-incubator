import { ogmiosRequest } from './ogmios';
import { computeLedgerAnchoredValidityWindow, ledgerVisibleValidityUpperBoundMs, queryLocalSlotConfig } from './time';

jest.mock('./ogmios', () => ({ ogmiosRequest: jest.fn() }));

describe('local slot timing', () => {
  const zeroTime = Date.parse('2025-12-31T00:00:00Z');
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('reads sub-second slots from genesis', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ result: '2025-12-31T00:00:00Z' }),
    });
    (ogmiosRequest as jest.Mock).mockResolvedValue({ slotLength: { milliseconds: 100 } });
    await expect(queryLocalSlotConfig('http://ogmios')).resolves.toEqual({
      zeroTime, zeroSlot: 0, slotLength: 100,
    });
  });

  it('keeps sub-second transaction bounds inside the node forecast', async () => {
    (ogmiosRequest as jest.Mock)
      .mockResolvedValueOnce({ slot: 105, id: 'tip' })
      .mockResolvedValueOnce([{ parameters: { safeZone: 576 } }]);
    const result = await computeLedgerAnchoredValidityWindow(
      'http://ogmios', { zeroTime, zeroSlot: 0, slotLength: 100 }, 120_000,
    );
    expect(result.currentLedgerTime).toBe(zeroTime + 10_500);
    expect(result.validToSlot).toBe(393);
    expect(result.validToTime).toBe(zeroTime + 39_300);
  });

  it('preserves one-second public-network validity windows', async () => {
    (ogmiosRequest as jest.Mock).mockResolvedValue({ slot: 105, id: 'tip' });
    const result = await computeLedgerAnchoredValidityWindow(
      'http://ogmios', { zeroTime, zeroSlot: 0, slotLength: 1000 }, 120_000,
    );
    expect(result.validToSlot).toBe(225);
    expect(ogmiosRequest).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing forecast instead of constructing unbounded local transactions', async () => {
    (ogmiosRequest as jest.Mock)
      .mockResolvedValueOnce({ slot: 105, id: 'tip' })
      .mockResolvedValueOnce([{ parameters: { safeZone: null } }]);
    await expect(computeLedgerAnchoredValidityWindow(
      'http://ogmios', { zeroTime, zeroSlot: 0, slotLength: 100 }, 120_000,
    )).rejects.toThrow('forecast safe zone');
  });
});

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
