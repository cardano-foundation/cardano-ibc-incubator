import { Height } from '../types/height';

export function isHeightAtLeast(candidate: Height, floor: Height): boolean {
  return (
    candidate.revisionNumber > floor.revisionNumber ||
    (candidate.revisionNumber === floor.revisionNumber &&
      candidate.revisionHeight >= floor.revisionHeight)
  );
}

export function maximumHeight(left: Height, right: Height): Height {
  return isHeightAtLeast(left, right) ? left : right;
}
