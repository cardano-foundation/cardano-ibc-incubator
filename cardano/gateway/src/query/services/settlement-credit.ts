import {
  ClientState,
  PoolSettlementCredit,
  SettlementCreditState,
} from '@cardano-ibc/proto-types/ibc/lightclients/probabilistic/v1/probabilistic';

export const ADDITIONAL_SETTLEMENT_CREDIT_BPS = 50n;
export type CreditFraction = { numerator: bigint; denominator: bigint };
type StakeEntry = { poolId: string; stake: bigint };

function fraction(numerator: bigint, denominator: bigint): CreditFraction {
  let a = numerator;
  let b = denominator;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return { numerator: numerator / a, denominator: denominator / a };
}

export function addCredit(a: CreditFraction, b: CreditFraction): CreditFraction {
  return fraction(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
}

function integer(bytes: Uint8Array): bigint {
  if (!bytes.length || bytes.length > 16 || bytes[0] === 0) {
    throw new Error('Settlement credit integers must be positive canonical values of at most 16 bytes');
  }
  return BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
}

function integerBytes(value: bigint): Uint8Array {
  const hex = value.toString(16);
  return Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex');
}

export function computeSettlementCredits(
  entries: StakeEntry[],
  reference?: PoolSettlementCredit[],
): Map<string, CreditFraction> {
  const old = new Map<string, CreditFraction>();
  let referenceTotal: CreditFraction = { numerator: 0n, denominator: 1n };
  for (const row of reference ?? []) {
    const value = { numerator: integer(row.numerator), denominator: integer(row.denominator) };
    const reduced = fraction(value.numerator, value.denominator);
    if (
      !row.pool_id ||
      row.pool_id !== row.pool_id.trim().toLowerCase() ||
      old.has(row.pool_id) ||
      value.numerator > value.denominator ||
      reduced.numerator !== value.numerator ||
      reduced.denominator !== value.denominator
    ) {
      throw new Error('Invalid settlement credit reference');
    }
    old.set(row.pool_id, value);
    referenceTotal = addCredit(referenceTotal, value);
  }
  if (referenceTotal.numerator > referenceTotal.denominator) throw new Error('Settlement reference shares exceed one');
  const total = entries.reduce((sum, row) => sum + row.stake, 0n);
  if (total <= 0n || total > (1n << 64n) - 1n) throw new Error('Invalid settlement stake total');
  const result = new Map<string, CreditFraction>();
  for (const row of entries) {
    const pool = row.poolId.toLowerCase();
    if (!pool || row.stake < 0n || result.has(pool)) throw new Error('Invalid settlement stake entry');
    let value = fraction(row.stake, total);
    if (reference !== undefined) {
      const cap = addCredit(old.get(pool) ?? { numerator: 0n, denominator: 1n }, {
        numerator: ADDITIONAL_SETTLEMENT_CREDIT_BPS,
        denominator: 10_000n,
      });
      if (value.numerator * cap.denominator > cap.numerator * value.denominator) value = cap;
    }
    result.set(pool, value);
  }
  return result;
}

function encodedCredits(credits: Map<string, CreditFraction>): PoolSettlementCredit[] {
  return [...credits]
    .filter(([, value]) => value.numerator > 0n)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pool, value]) => ({
      pool_id: pool,
      numerator: integerBytes(value.numerator),
      denominator: integerBytes(value.denominator),
    }));
}

export function bootstrapSettlementCredit(epoch: bigint, entries: StakeEntry[]): SettlementCreditState {
  return { epoch, reference: encodedCredits(computeSettlementCredits(entries)) };
}

// Query hints come from the destination client. Cosmos repeats the calculation
// using its own checkpoint, so these values cannot redefine settlement credit.
export function settlementReferenceForEpoch(client: ClientState, epoch: bigint): PoolSettlementCredit[] {
  const saved = client.latest_checkpoint_settlement_credit;
  if (!saved || saved.epoch !== client.current_epoch)
    throw new Error('Destination settlement credit checkpoint is unavailable');
  if (epoch === saved.epoch) return saved.reference;
  if (epoch !== saved.epoch + 1n) throw new Error('Settlement credit supports only adjacent epoch transitions');
  const context = client.epoch_contexts.find((row) => row.epoch === saved.epoch);
  if (!context) throw new Error('Destination reference epoch stake context is unavailable');
  return encodedCredits(
    computeSettlementCredits(
      context.stake_distribution.map((row) => ({ poolId: row.pool_id, stake: row.stake })),
      saved.reference,
    ),
  );
}

export function creditBasisPoints(value: CreditFraction): bigint {
  return (value.numerator * 10_000n) / value.denominator;
}
