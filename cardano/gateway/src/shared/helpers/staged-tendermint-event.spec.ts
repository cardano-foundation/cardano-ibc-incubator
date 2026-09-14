import crypto from 'crypto';

import type { Validator } from '../types/cometbft/validator';
import type { SessionDatum, SpendSessionRedeemer, TargetEntry, UpdatePlan } from '../types/tendermint-update-session';
import { hashTendermintValidatorSet } from '../../tx/update-client-staged-payload';
import { reconstructStagedTendermintHeader } from './staged-tendermint-event';

const validator = (publicKeyByte: string, votingPower: bigint): Validator => {
  const pubkey = publicKeyByte.repeat(32);
  return {
    address: crypto.createHash('sha256').update(Buffer.from(pubkey, 'hex')).digest('hex').slice(0, 40),
    pubkey,
    votingPower,
    proposerPriority: 0n,
  };
};

const TARGET_HIGH = validator('21', 20n);
const TARGET_LOW = validator('22', 10n);
const TRUSTED_HIGH = validator('41', 30n);
const TRUSTED_LOW = validator('42', 15n);

function targetEntry(targetValidator: Validator, signatureByte: string): TargetEntry {
  return {
    targetValidator,
    commitSig: {
      block_id_flag: 2n,
      validator_address: targetValidator.address,
      timestamp: 123n,
      signature: signatureByte.repeat(64),
    },
    trustedMembership: null,
  };
}

function completeSession(): SessionDatum {
  const targetValidators = [TARGET_HIGH, TARGET_LOW];
  const trustedValidators = [TRUSTED_HIGH, TRUSTED_LOW];
  const plan: UpdatePlan = {
    clientToken: { policyId: '51'.repeat(28), name: '52' },
    trustedHeight: { revisionNumber: 0n, revisionHeight: 7n },
    trustedConsensusState: {
      timestamp: 1n,
      next_validators_hash: hashTendermintValidatorSet(trustedValidators),
      root: { hash: '53'.repeat(32) },
    },
    trustLevel: { numerator: 1n, denominator: 3n },
    trustingPeriod: 10n,
    maxClockDrift: 2n,
    header: {
      version: { block: 11n, app: 0n },
      chainId: Buffer.from('chain-0').toString('hex'),
      height: 9n,
      time: 3n,
      lastBlockId: { hash: '54'.repeat(32), partSetHeader: { total: 1n, hash: '55'.repeat(32) } },
      lastCommitHash: '56'.repeat(32),
      dataHash: '57'.repeat(32),
      validatorsHash: hashTendermintValidatorSet(targetValidators),
      nextValidatorsHash: '58'.repeat(32),
      consensusHash: '59'.repeat(32),
      appHash: '5a'.repeat(32),
      lastResultsHash: '5b'.repeat(32),
      evidenceHash: '5c'.repeat(32),
      proposerAddress: TARGET_LOW.address,
    },
    commit: {
      height: 9n,
      round: 0n,
      blockId: { hash: '5d'.repeat(32), partSetHeader: { total: 1n, hash: '5e'.repeat(32) } },
    },
    targetValidatorCount: 2n,
    trustedValidatorCount: 2n,
  };

  return {
    sessionToken: { policyId: '61'.repeat(28), name: '62'.repeat(32) },
    owner: '63'.repeat(28),
    plan,
    phase: {
      Complete: {
        targetRoot: plan.header.validatorsHash,
        targetTotalPower: 30n,
        targetSignedPower: 30n,
        trustedRoot: plan.trustedConsensusState.next_validators_hash,
        trustedTotalPower: 45n,
        trustedSignedPower: 30n,
      },
    },
  };
}

describe('reconstructStagedTendermintHeader', () => {
  it('rebuilds validator sets and aligned commit signatures from durable batches', () => {
    const session = completeSession();
    const redeemers: SpendSessionRedeemer[] = [
      { VerifyTarget: { entries: [targetEntry(TARGET_LOW, '72')] } },
      { VerifyTrusted: { validators: [TRUSTED_LOW] } },
      { VerifyTarget: { entries: [targetEntry(TARGET_HIGH, '71')] } },
      { VerifyTrusted: { validators: [TRUSTED_HIGH] } },
    ];

    const header = reconstructStagedTendermintHeader(session, redeemers);

    expect(header.signedHeader.header).toBe(session.plan.header);
    expect(header.validatorSet.validators).toEqual([TARGET_HIGH, TARGET_LOW]);
    expect(header.signedHeader.commit.signatures.map((signature) => signature.signature)).toEqual([
      '71'.repeat(64),
      '72'.repeat(64),
    ]);
    expect(header.validatorSet.proposer).toEqual(TARGET_LOW);
    expect(header.trustedValidators.validators).toEqual([TRUSTED_HIGH, TRUSTED_LOW]);
    expect(header.trustedValidators.proposer).toEqual(TRUSTED_HIGH);
  });

  it('rejects incomplete durable batch history', () => {
    const session = completeSession();

    expect(() =>
      reconstructStagedTendermintHeader(session, [
        { VerifyTrusted: { validators: [TRUSTED_HIGH, TRUSTED_LOW] } },
        { VerifyTarget: { entries: [targetEntry(TARGET_HIGH, '71')] } },
      ]),
    ).toThrow('expected 2 target validators, found 1');
  });
});
