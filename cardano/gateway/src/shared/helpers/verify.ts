import { MAX_EXPECTED_TIME_PER_BLOCK } from '../../constant';

export function getBlockDelay(timeDelay: bigint): number {
  const expectedTimePerBlock = BigInt(MAX_EXPECTED_TIME_PER_BLOCK);
  return Math.ceil(Number(timeDelay / expectedTimePerBlock));
}
