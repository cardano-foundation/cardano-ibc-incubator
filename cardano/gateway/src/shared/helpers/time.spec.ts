import { ogmiosRequest } from './ogmios';
import { computeLedgerAnchoredValidityWindow, slotToLedgerTime } from './time';

jest.mock('./ogmios', () => ({ ogmiosRequest: jest.fn() }));

describe('Cardano slot timing', () => {
  it('maps an invalid-hereafter slot to the exact POSIX upper bound seen by Plutus', () => {
    const slotConfig = { zeroTime: 1_000_000, zeroSlot: 100, slotLength: 1_000 };

    expect(slotToLedgerTime(103, slotConfig)).toBe(1_003_000);
    // A timestamp later in that slot is useful for making Lucid select slot 103,
    // but it is not the upper-bound time exposed in the Plutus validity interval.
    expect(slotToLedgerTime(104, slotConfig) - 1).toBe(1_003_999);
  });

  it("keeps Lucid's enclosing-slot timestamp separate from the ledger upper bound", async () => {
    jest.mocked(ogmiosRequest).mockResolvedValue({ slot: 102, id: 'tip' });
    const slotConfig = { zeroTime: 1_000_000, zeroSlot: 100, slotLength: 1_000 };

    const validity = await computeLedgerAnchoredValidityWindow('ws://ogmios', slotConfig, 600_000, {
      backdateMs: 60_000,
    });

    expect(validity).toEqual({
      currentSlot: 102,
      currentLedgerTime: 1_002_000,
      validFromTime: 1_000_000,
      validToSlot: 702,
      ledgerValidToTime: 1_602_000,
      validToTime: 1_602_999,
    });
  });
});
