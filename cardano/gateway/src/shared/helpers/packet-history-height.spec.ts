import { isHeightAtLeast, maximumHeight } from './packet-history-height';

describe('packet history proof-height bounds', () => {
  const height = (revisionHeight: bigint) => ({ revisionNumber: 0n, revisionHeight });

  it('accepts out-of-order receives above the prune floor without lowering the high-water mark', () => {
    const minimum = height(10n);
    const maximum = height(30n);
    const receiveProof = height(20n);

    expect(isHeightAtLeast(receiveProof, minimum)).toBe(true);
    expect(maximumHeight(maximum, receiveProof)).toEqual(maximum);
  });

  it('advances the receive high-water mark for a newer proof', () => {
    expect(maximumHeight(height(30n), height(40n))).toEqual(height(40n));
  });

  it('rejects replay heights below the prune floor and prune heights below receive high-water', () => {
    expect(isHeightAtLeast(height(9n), height(10n))).toBe(false);
    expect(isHeightAtLeast(height(29n), height(30n))).toBe(false);
  });

  it('orders revisions before revision heights', () => {
    expect(
      isHeightAtLeast(
        { revisionNumber: 2n, revisionHeight: 1n },
        { revisionNumber: 1n, revisionHeight: 999n },
      ),
    ).toBe(true);
  });
});
