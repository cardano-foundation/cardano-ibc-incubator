import {
  analyzeCompactTendermintUpdateCapacity,
  assertPrototypeResults,
  cometValidatorSetHash,
  signerIndicesFromBitmap,
} from './compact-tendermint-update-capacity';

describe('compact Tendermint update capacity prototype', () => {
  it('measures the Injective and equal-power structural transactions deterministically', async () => {
    const first = await analyzeCompactTendermintUpdateCapacity();
    const second = await analyzeCompactTendermintUpdateCapacity();

    assertPrototypeResults(first);
    expect(second.map(({ signedCbor }) => signedCbor)).toEqual(first.map(({ signedCbor }) => signedCbor));
    expect(
      first.map(({ report }) => [
        report.validatorCount,
        report.signerCount,
        report.signedBytes,
        report.validatorSetReference.inlineDatumBytes,
        report.validatorSetReference.registration.signedBytes,
      ]),
    ).toEqual([
      [45, 15, 2_833, 1_907, 2_411],
      [200, 134, 11_689, 8_296, 8_800],
      [256, 171, 14_444, 10_608, 11_112],
    ]);
  });

  it('uses the documented least-significant-bit-first signer bitmap', () => {
    expect(signerIndicesFromBitmap(Buffer.from([0b10000001, 0b00000001]), 9)).toEqual([0, 7, 8]);
    expect(() => signerIndicesFromBitmap(Buffer.from([0b11111110]), 1)).toThrow(
      'Signer bitmap has non-zero bits outside the validator set',
    );
  });

  it('matches the CometBFT ordered SimpleValidator hash fixture', () => {
    const validator = {
      address: '4ae76aed128636dad8c84f814aff2b5b965a8001',
      pubkey: '6210fc94ff775add5fb919f1abbf9eb94aab6c345c334a035f3d4f2ea485ed70',
      votingPower: 1n,
      proposerPriority: 0n,
    };
    expect(cometValidatorSetHash(Array.from({ length: 45 }, () => validator))).toBe(
      '4580cb4ea9e7f279f54ee772a718e14d4ce151e6f3ccd63a40a710d033e40c50',
    );
  });
});
