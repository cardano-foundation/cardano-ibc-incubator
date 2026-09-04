import crypto from 'crypto';

import capacityFixture from '../../scripts/test/fixtures/tendermint-update-capacity/normalized.json';
import {
  buildTendermintStagedPayloads,
  buildTendermintValidatorAuditPath,
  DecodedTendermintHeaderForStaging,
  encodeTendermintSimpleValidator,
  hashTendermintValidatorSet,
  StagedTendermintCommitSig,
  StagedTendermintValidator,
  TENDERMINT_MAX_TOTAL_VOTING_POWER,
  verifyTendermintValidatorMembership,
} from '../update-client-staged-payload';

function fixtureValidator(value: any): StagedTendermintValidator {
  return {
    address: value.address,
    pubkey: value.pub_key.ed25519,
    votingPower: BigInt(value.voting_power),
    proposerPriority: BigInt(value.proposer_priority),
  };
}

function fixtureSignature(value: any): StagedTendermintCommitSig {
  return {
    block_id_flag: BigInt(value.block_id_flag),
    validator_address: value.validator_address,
    timestamp: BigInt(value.timestamp),
    signature: value.signature,
  };
}

function fixtureHeader(scenario: any): DecodedTendermintHeaderForStaging {
  return {
    signedHeader: {
      header: { validatorsHash: scenario.header.signed_header.header.validators_hash },
      commit: { signatures: scenario.header.signed_header.commit.signatures.map(fixtureSignature) },
    },
    validatorSet: { validators: scenario.header.validator_set.validators.map(fixtureValidator) },
    trustedValidators: { validators: scenario.header.trusted_validators.validators.map(fixtureValidator) },
  };
}

function deterministicValidators(count: number): StagedTendermintValidator[] {
  return Array.from({ length: count }, (_, index) => {
    const pubkey = crypto.createHash('sha256').update(`validator-${index}`, 'utf8').digest();
    return {
      address: crypto.createHash('sha256').update(pubkey).digest('hex').slice(0, 40),
      pubkey: pubkey.toString('hex'),
      votingPower: BigInt(1_000 - index),
      proposerPriority: 0n,
    };
  });
}

function commitSignatures(validators: readonly StagedTendermintValidator[]): StagedTendermintCommitSig[] {
  return validators.map((validator) => ({
    block_id_flag: 2n,
    validator_address: validator.address,
    timestamp: 1n,
    signature: '11'.repeat(64),
  }));
}

describe('Tendermint staged update payloads', () => {
  it('matches the Aiken SimpleValidator protobuf encoding vector', () => {
    expect(
      encodeTendermintSimpleValidator({
        address: '4ae76aed128636dad8c84f814aff2b5b965a8001',
        pubkey: '6210fc94ff775add5fb919f1abbf9eb94aab6c345c334a035f3d4f2ea485ed70',
        votingPower: 1n,
        proposerPriority: 0n,
      }),
    ).toBe('0a220a206210fc94ff775add5fb919f1abbf9eb94aab6c345c334a035f3d4f2ea485ed701001');
  });

  it.each([
    [1, '932b282041489257a56472bb0f5caa3a920b0c8147c5d5bf6500cb0efbc209a9'],
    [3, '1baf1d34f22c38c99e84688ce6ac033183a693ddb847943fae5ab826f5e89ad8'],
    [5, 'c2ad9b71a39d1ac20c5db6587d0b4f84e32f0155cbba5bc87b3e4d0f45721295'],
    [9, '5a2d381af1c65f4fca79d54854d329bb80ee72a32af369c3dfd83e6840c48a6a'],
  ])('matches the pinned irregular RFC-6962 validator root for %i leaves', (count, expectedRoot) => {
    const validators = deterministicValidators(count);
    expect(hashTendermintValidatorSet(validators)).toBe(expectedRoot);

    validators.forEach((validator, index) => {
      expect(
        verifyTendermintValidatorMembership({
          expectedRoot,
          validator,
          index,
          total: validators.length,
          auditPath: buildTendermintValidatorAuditPath(validators, index),
        }),
      ).toBe(true);
    });
  });

  it('matches the frozen 45-validator Injective root and produces bounded adjacent batches', () => {
    const scenario = capacityFixture.scenarios.adjacent_all_signed;
    const header = fixtureHeader(scenario);
    const payloads = buildTendermintStagedPayloads({ header, mode: 'adjacent' });

    expect(payloads.targetValidatorRoot).toBe(scenario.observations.validator_hash);
    expect(payloads.targetValidatorRoot).toBe(header.signedHeader.header.validatorsHash);
    expect(payloads.trustedValidatorRoot).toBeNull();
    expect(payloads.trustedBatches).toEqual([]);
    expect(payloads.targetBatches).toHaveLength(8);
    expect(payloads.targetBatches.map((batch) => batch.entries.length)).toEqual([6, 6, 6, 6, 6, 6, 6, 3]);
    expect(payloads.targetBatches.flatMap((batch) => batch.entries).every((entry) => !entry.trustedMembership)).toBe(
      true,
    );
  });

  it('builds exact, unique trusted memberships for the frozen skipped-height update', () => {
    const scenario = capacityFixture.scenarios.non_adjacent_mixed;
    const header = fixtureHeader(scenario);
    const payloads = buildTendermintStagedPayloads({
      header,
      mode: 'non_adjacent',
      expectedTrustedValidatorsHash: scenario.trusted_consensus_state.next_validators_hash,
    });

    expect(payloads.targetValidatorRoot).toBe(scenario.observations.validator_hash);
    expect(payloads.trustedValidatorRoot).toBe(scenario.trusted_consensus_state.next_validators_hash);
    expect(payloads.trustedBatches.map((batch) => batch.validators.length)).toEqual([6, 6, 6, 6, 6, 6, 6, 3]);
    expect(payloads.targetBatches.map((batch) => batch.entries.length)).toEqual([6, 6, 6, 6, 6, 6, 6, 3]);

    const memberships = payloads.targetBatches
      .flatMap((batch) => batch.entries)
      .map((entry) => entry.trustedMembership)
      .filter((membership) => membership !== null);
    const membershipIndices = memberships.map((membership) => Number(membership.index));

    expect(memberships).toHaveLength(scenario.observations.commit_vote_count);
    expect(new Set(membershipIndices).size).toBe(membershipIndices.length);
    memberships.forEach((membership) => {
      expect(
        verifyTendermintValidatorMembership({
          expectedRoot: payloads.trustedValidatorRoot,
          validator: membership.trustedValidator,
          index: Number(membership.index),
          total: header.trustedValidators.validators.length,
          auditPath: membership.auditPath,
        }),
      ).toBe(true);
    });
  });

  it('rejects truncated, padded, and index-shifted trusted paths', () => {
    const validators = deterministicValidators(5);
    const expectedRoot = hashTendermintValidatorSet(validators);
    const auditPath = buildTendermintValidatorAuditPath(validators, 4);

    expect(
      verifyTendermintValidatorMembership({
        expectedRoot,
        validator: validators[4],
        index: 4,
        total: validators.length,
        auditPath: auditPath.slice(1),
      }),
    ).toBe(false);
    expect(
      verifyTendermintValidatorMembership({
        expectedRoot,
        validator: validators[4],
        index: 4,
        total: validators.length,
        auditPath: ['00'.repeat(32), ...auditPath],
      }),
    ).toBe(false);
    expect(
      verifyTendermintValidatorMembership({
        expectedRoot,
        validator: validators[4],
        index: 3,
        total: validators.length,
        auditPath,
      }),
    ).toBe(false);
  });

  it('rejects duplicate keys before one trusted index can be selected twice', () => {
    const targetValidators = deterministicValidators(2);
    targetValidators[1] = { ...targetValidators[0] };
    const header: DecodedTendermintHeaderForStaging = {
      signedHeader: {
        header: { validatorsHash: '00'.repeat(32) },
        commit: { signatures: commitSignatures(targetValidators) },
      },
      validatorSet: { validators: targetValidators },
      trustedValidators: { validators: deterministicValidators(2) },
    };

    expect(() =>
      buildTendermintStagedPayloads({
        header,
        mode: 'non_adjacent',
        expectedTrustedValidatorsHash: hashTendermintValidatorSet(header.trustedValidators.validators),
      }),
    ).toThrow('duplicate public key');
  });

  it('rejects a validator-set payload that is not bound to the signed header', () => {
    const scenario = capacityFixture.scenarios.adjacent_all_signed;
    const header = fixtureHeader(scenario);
    header.signedHeader.header.validatorsHash = '00'.repeat(32);

    expect(() => buildTendermintStagedPayloads({ header, mode: 'adjacent' })).toThrow('target validator root mismatch');
  });

  it('rejects zero voting power exactly as the session validator does', () => {
    const [validator] = deterministicValidators(1);

    expect(() => hashTendermintValidatorSet([{ ...validator, votingPower: 0n }])).toThrow(
      'votingPower must be a positive signed int64',
    );
  });

  it('requires CometBFT voting-power/address order before batching', () => {
    const validators = deterministicValidators(2).reverse();

    expect(() => hashTendermintValidatorSet(validators)).toThrow('canonical voting-power/address order');
  });

  it('enforces CometBFT MaxTotalVotingPower across the validator set', () => {
    const [validator] = deterministicValidators(1);
    expect(TENDERMINT_MAX_TOTAL_VOTING_POWER).toBe(1_152_921_504_606_846_975n);

    expect(() =>
      hashTendermintValidatorSet([
        {
          ...validator,
          votingPower: TENDERMINT_MAX_TOTAL_VOTING_POWER + 1n,
        },
      ]),
    ).toThrow(`total voting power exceeds ${TENDERMINT_MAX_TOTAL_VOTING_POWER.toString(10)}`);
  });
});
