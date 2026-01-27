import { Height } from '@shared/types/height';

export function isValidProofHeight(heights: Height[], proofHeight: Height): boolean {
  return heights.some(
    (height) =>
      height.revisionNumber === proofHeight.revisionNumber &&
      height.revisionHeight === proofHeight.revisionHeight,
  );
}
