import { createHash } from 'node:crypto';

import {
  buildEurekaMisbehaviourOutput,
  encodeEurekaMisbehaviourOutput,
  EUREKA_MISBEHAVIOUR_PROGRAM_VKEY,
} from './sp1-misbehaviour';

const clientState = {
  chainId: Buffer.from('simd-1').toString('hex'),
  trustLevel: { numerator: 1n, denominator: 3n },
  trustingPeriod: 1_209_600n * 1_000_000_000n,
  unbondingPeriod: 1_814_400n * 1_000_000_000n,
  maxClockDrift: 15_000_000_000n,
  frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
  latestHeight: { revisionNumber: 1n, revisionHeight: 11n },
  proofSpecs: [],
};

const trustedConsensusState = {
  timestamp: 1_777_896_775_963_975_465n,
  root: { hash: '1faa68903ddafe1c26abebc43f307f32c3fa8b0c08c0a488be7500090d891d23' },
  next_validators_hash: 'c583ab493e4a98860b5dc015d704504288edddf84a05275a5f27ede8b26a70e3',
};

describe('Eureka Misbehaviour ABI', () => {
  it('matches the exact public output committed by the upstream v2.0.0 fixture', () => {
    const output = buildEurekaMisbehaviourOutput({
      clientState,
      time: 1_777_896_791_137_126_000n,
      trustedHeight1: { revisionNumber: 1n, revisionHeight: 11n },
      trustedHeight2: { revisionNumber: 1n, revisionHeight: 11n },
      trustedConsensusState1: trustedConsensusState,
      trustedConsensusState2: trustedConsensusState,
    });
    const encoded = encodeEurekaMisbehaviourOutput(output);

    expect(encoded.length).toBe(768);
    expect(createHash('sha256').update(encoded).digest('hex')).toBe(
      '94cc09897fe5497cc4d6658920a1f156b40b293a54a1bc232fde76b7b763945a',
    );
    expect(encoded.subarray(0, 32).equals(Buffer.from('20'.padStart(64, '0'), 'hex'))).toBe(true);
    expect(encoded.subarray(32, 64).equals(Buffer.from('180'.padStart(64, '0'), 'hex'))).toBe(true);
  });

  it('supports a 50-byte Cardano chain id', () => {
    const output = buildEurekaMisbehaviourOutput({
      clientState: { ...clientState, chainId: Buffer.from('x'.repeat(50)).toString('hex') },
      time: 3n,
      trustedHeight1: { revisionNumber: 1n, revisionHeight: 10n },
      trustedHeight2: { revisionNumber: 1n, revisionHeight: 11n },
      trustedConsensusState1: trustedConsensusState,
      trustedConsensusState2: trustedConsensusState,
    });

    expect(encodeEurekaMisbehaviourOutput(output).length).toBe(800);
  });

  it('pins the program key derived from the released ELF', () => {
    expect(EUREKA_MISBEHAVIOUR_PROGRAM_VKEY).toBe('0010008da4267c2e85d02616e853379e3c937c03a271b5b005f479cff09ccfcb');
  });

  it('rejects a malformed trusted consensus state', () => {
    expect(() =>
      buildEurekaMisbehaviourOutput({
        clientState,
        time: 3n,
        trustedHeight1: { revisionNumber: 1n, revisionHeight: 10n },
        trustedHeight2: { revisionNumber: 1n, revisionHeight: 11n },
        trustedConsensusState1: { ...trustedConsensusState, root: { hash: '00' } },
        trustedConsensusState2: trustedConsensusState,
      }),
    ).toThrow('trustedConsensusState1.root');
  });
});
