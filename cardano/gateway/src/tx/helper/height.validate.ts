import { Height } from '@shared/types/height';

export function isValidProofHeight(heights: Height[], revisionHeight: bigint): boolean {
  return heights.some((key) => BigInt(revisionHeight) === BigInt(key.revisionHeight));
}
