import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildEurekaUpdateClientOutput,
  encodeEurekaUpdateClientOutput,
  maskedEurekaPublicValuesDigest,
  toEurekaClientState,
} from './sp1-update-client';

const clientState = {
  chainId: Buffer.from('cosmoshub-4').toString('hex'),
  trustLevel: { numerator: 1n, denominator: 3n },
  trustingPeriod: 1_209_600n * 1_000_000_000n,
  unbondingPeriod: 1_814_400n * 1_000_000_000n,
  maxClockDrift: 15_000_000_000n,
  frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
  latestHeight: { revisionNumber: 4n, revisionHeight: 30_958_714n },
  proofSpecs: [],
};

const trustedConsensusState = {
  timestamp: 1_777_895_596_297_552_485n,
  root: { hash: 'aef8b4344c566856024153a6d926846fa86247d424aa9a2897acdc903e550fd9' },
  next_validators_hash: 'a94f05181f311848889c44bf508e23f2c12685ab4e4090c2ac093e5d6114d39e',
};

const newConsensusState = {
  timestamp: 1_777_896_114_885_132_442n,
  root: { hash: '480cf4c31bde380d1e21ab9f8b09eb211acee7bb5b5b773529e716cc30133a3f' },
  next_validators_hash: 'ff1ca5b63e9d71d07c9aaffcb666e2fd8d4a2cfc00d324e7e8ec665a5b61f6db',
};

describe('Eureka UpdateClient ABI', () => {
  it('matches the exact public output committed by the upstream fixture', () => {
    const output = buildEurekaUpdateClientOutput({
      clientState,
      trustedConsensusState,
      newConsensusState,
      time: 1_777_896_213_341_521_000n,
      trustedHeight: { revisionNumber: 4n, revisionHeight: 30_958_714n },
      newHeight: { revisionNumber: 4n, revisionHeight: 30_958_804n },
    });
    const actual = encodeEurekaUpdateClientOutput(output);
    const fixture = readFileSync(
      resolve(
        __dirname,
        '../../../../sp1-tendermint-prover/bn254-to-bls-wrapper/artifacts/public_values.bin',
      ),
    );

    expect(actual.equals(fixture)).toBe(true);
    expect(actual.length).toBe(768);
    expect(maskedEurekaPublicValuesDigest(actual)).toBe(
      7_502_551_290_996_298_928_656_580_645_170_696_463_477_893_656_310_018_581_787_309_607_620_505_586_428n,
    );
  });

  it('supports the existing Cardano 50-byte chain-id limit', () => {
    const output = buildEurekaUpdateClientOutput({
      clientState: {
        ...clientState,
        chainId: Buffer.from('x'.repeat(50)).toString('hex'),
      },
      trustedConsensusState,
      newConsensusState,
      time: 1n,
      trustedHeight: { revisionNumber: 1n, revisionHeight: 1n },
      newHeight: { revisionNumber: 1n, revisionHeight: 2n },
    });
    const encoded = encodeEurekaUpdateClientOutput(output);

    expect(encoded.length).toBe(800);
  });

  it.each([
    ['fraction wider than uint8', { trustLevel: { numerator: 256n, denominator: 256n } }],
    ['fraction with zero denominator', { trustLevel: { numerator: 1n, denominator: 0n } }],
    ['fraction above one', { trustLevel: { numerator: 2n, denominator: 1n } }],
    ['sub-second trusting period', { trustingPeriod: 1_000_000_001n }],
    ['non-Eureka clock drift', { maxClockDrift: 10_000_000_000n }],
    ['frozen client', { frozenHeight: { revisionNumber: 1n, revisionHeight: 2n } }],
    ['height wider than uint64', { latestHeight: { revisionNumber: 1n, revisionHeight: 2n ** 64n } }],
  ])('rejects a %s', (_name, change) => {
    expect(() => toEurekaClientState({ ...clientState, ...change })).toThrow();
  });

  it('rejects malformed consensus hashes', () => {
    expect(() =>
      buildEurekaUpdateClientOutput({
        clientState,
        trustedConsensusState: { ...trustedConsensusState, next_validators_hash: '00' },
        newConsensusState,
        time: 1n,
        trustedHeight: { revisionNumber: 4n, revisionHeight: 1n },
        newHeight: { revisionNumber: 4n, revisionHeight: 2n },
      }),
    ).toThrow('trustedConsensusState.nextValidatorsHash');
  });
});
