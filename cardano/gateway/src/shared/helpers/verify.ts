import { MAX_EXPECTED_TIME_PER_BLOCK } from '../../constant';

// Mirrors on-chain `math.ceil_divide_uinteger(delay_period, max_expected_time_per_block)`.
//
// Cardano stores `delay_period` in nanoseconds (IBC convention). This helper converts that
// time delay into a block delay using a conservative max-expected-time-per-block bound.
export function getBlockDelay(timeDelay: bigint): bigint {
  const expectedTimePerBlock = BigInt(MAX_EXPECTED_TIME_PER_BLOCK);
  if (timeDelay <= 0n) return 0n;
  if (expectedTimePerBlock <= 0n) return 0n;

  const quotient = timeDelay / expectedTimePerBlock;
  const remainder = timeDelay % expectedTimePerBlock;
  return remainder === 0n ? quotient : quotient + 1n;
}
