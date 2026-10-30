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
    const payloads = buildTendermintStagedPayloads({
      trustLevel: { numerator: 1n, denominator: 3n },
      header,
      mode: 'adjacent',
    });

    expect(payloads.targetValidatorRoot).toBe(scenario.observations.validator_hash);
    expect(payloads.targetValidatorRoot).toBe(header.signedHeader.header.validatorsHash);
    expect(payloads.trustedValidatorRoot).toBeNull();
    expect(payloads.trustedBatches).toEqual([]);
    expect(payloads.targetBatches).toHaveLength(2);
    expect(payloads.targetBatches.map((batch) => batch.entries.length)).toEqual([24, 21]);
    expect(payloads.targetBatches.flatMap((batch) => batch.entries).every((entry) => !entry.trustedMembership)).toBe(
      true,
    );
  });

  it('builds exact, unique trusted memberships for the frozen skipped-height update', () => {
    const scenario = capacityFixture.scenarios.non_adjacent_mixed;
    const header = fixtureHeader(scenario);
    const payloads = buildTendermintStagedPayloads({
      trustLevel: { numerator: 1n, denominator: 3n },
      header,
      mode: 'non_adjacent',
      expectedTrustedValidatorsHash: scenario.trusted_consensus_state.next_validators_hash,
    });

    expect(payloads.targetValidatorRoot).toBe(scenario.observations.validator_hash);
    expect(payloads.trustedValidatorRoot).toBe(scenario.trusted_consensus_state.next_validators_hash);
    expect(payloads.trustedBatches.map((batch) => batch.validators.length)).toEqual([24, 21]);
    expect(payloads.targetBatches.map((batch) => batch.entries.length)).toEqual([6, 6, 6, 6, 6, 6, 6, 3]);

    const memberships = payloads.targetBatches
      .flatMap((batch) => batch.entries)
      .map((entry) => entry.trustedMembership)
      .filter((membership) => membership !== null);
    const membershipIndices = memberships.map((membership) => Number(membership.index));
    const trustedValidatorRoot = payloads.trustedValidatorRoot;
    if (trustedValidatorRoot === null) throw new Error('expected a trusted validator root');

    const entries = payloads.targetBatches.flatMap((batch) => batch.entries);
    expect(entries.filter((entry) => entry.commitSig.block_id_flag === 2n)).toHaveLength(17);
    expect(memberships).toHaveLength(6);
    expect(entries.map((entry) => entry.targetValidator)).toEqual(header.validatorSet.validators);
    expect(header.signedHeader.commit.signatures.filter((sig) => sig.block_id_flag === 2n)).toHaveLength(43);
    expect(new Set(membershipIndices).size).toBe(membershipIndices.length);
    memberships.forEach((membership) => {
      expect(
        verifyTendermintValidatorMembership({
          expectedRoot: trustedValidatorRoot,
          validator: membership.trustedValidator,
          index: Number(membership.index),
          total: header.trustedValidators.validators.length,
          auditPath: membership.auditPath,
        }),
      ).toBe(true);
    });
  });

  function powersHeader(powers: bigint[], trustedPowers = powers): DecodedTendermintHeaderForStaging {
    const keys = deterministicValidators(powers.length);
    const order = (left: StagedTendermintValidator, right: StagedTendermintValidator) =>
      left.votingPower === right.votingPower
        ? left.address.localeCompare(right.address)
        : left.votingPower > right.votingPower
          ? -1
          : 1;
    const validators = keys.map((key, index) => ({ ...key, votingPower: powers[index] })).sort(order);
    const trusted = keys.map((key, index) => ({ ...key, votingPower: trustedPowers[index] })).sort(order);
    return {
      signedHeader: {
        header: { validatorsHash: hashTendermintValidatorSet(validators) },
        commit: { signatures: commitSignatures(validators) },
      },
      validatorSet: { validators },
      trustedValidators: { validators: trusted },
    };
  }

  function selected(
    header: DecodedTendermintHeaderForStaging,
    options: {
      mode?: 'adjacent' | 'unchanged' | 'non_adjacent';
      trustLevel?: { numerator: bigint; denominator: bigint };
      misbehaviour?: boolean;
    } = {},
  ) {
    return buildTendermintStagedPayloads({
      header,
      mode: 'unchanged',
      trustLevel: { numerator: 1n, denominator: 3n },
      expectedTrustedValidatorsHash: hashTendermintValidatorSet(header.trustedValidators.validators),
      ...options,
    }).targetBatches.flatMap((batch) => batch.entries);
  }

  it('keeps strict voting-power boundaries with integers beyond Number precision', () => {
    const above = selected(powersHeader([600_000_000_000_000_001n, 300_000_000_000_000_000n]));
    expect(above.filter((entry) => entry.commitSig.block_id_flag === 2n)).toHaveLength(1);
    expect(above[1].commitSig).toEqual({ block_id_flag: 1n, validator_address: '', timestamp: 0n, signature: '' });
    const equal = selected(powersHeader([600_000_000_000_000_000n, 300_000_000_000_000_000n]));
    expect(equal.filter((entry) => entry.commitSig.block_id_flag === 2n)).toHaveLength(2);
  });

  it('uses the configured higher trust fraction for unchanged sets and adjacent evidence', () => {
    const header = powersHeader([80n, 10n, 10n]);
    const trustLevel = { numerator: 9n, denominator: 10n };
    expect(selected(header).filter((entry) => entry.commitSig.block_id_flag === 2n)).toHaveLength(1);
    for (const options of [{ mode: 'unchanged' as const }, { mode: 'adjacent' as const, misbehaviour: true }]) {
      expect(selected(header, { ...options, trustLevel }).every((entry) => entry.commitSig.block_id_flag === 2n)).toBe(
        true,
      );
    }
    expect(
      selected(header, { mode: 'adjacent', trustLevel }).filter((entry) => entry.commitSig.block_id_flag === 2n),
    ).toHaveLength(3);
  });

  it('permits normal adjacent updates when the available commit cannot meet the higher evidence threshold', () => {
    const header = powersHeader([80n, 10n, 10n]);
    header.signedHeader.commit.signatures[2] = {
      block_id_flag: 1n,
      validator_address: '',
      timestamp: 0n,
      signature: '',
    };
    const trustLevel = { numerator: 9n, denominator: 10n };
    expect(
      selected(header, { mode: 'adjacent', trustLevel }).filter((entry) => entry.commitSig.block_id_flag === 2n),
    ).toHaveLength(1);
    expect(() => selected(header, { mode: 'adjacent', trustLevel, misbehaviour: true })).toThrow(
      'target voting-power quorum',
    );
  });

  it('counts overlap with trusted voting powers and removes redundant memberships', () => {
    const header = powersHeader([70n, 20n, 10n], [1n, 1n, 98n]);
    const entries = selected(header, { mode: 'non_adjacent' });
    expect(
      entries.filter((entry) => entry.commitSig.block_id_flag === 2n).map((entry) => entry.targetValidator.votingPower),
    ).toEqual([70n, 10n]);
    expect(
      entries
        .filter((entry) => entry.trustedMembership)
        .map((entry) => entry.trustedMembership!.trustedValidator.votingPower),
    ).toEqual([98n]);
  });

  it('finds the necessary signer when the authenticated sets share only one key', () => {
    const header = powersHeader([70n, 20n, 10n], [1n, 1n, 98n]);
    const shared = header.trustedValidators.validators[0];
    const outsiders = deterministicValidators(5)
      .slice(3)
      .map((validator) => ({ ...validator, votingPower: 1n }));
    outsiders.sort((left, right) => left.address.localeCompare(right.address));
    header.trustedValidators.validators = [shared, ...outsiders];
    const entries = selected(header, { mode: 'non_adjacent' });
    expect(entries.filter((entry) => entry.trustedMembership).map((entry) => entry.targetValidator.pubkey)).toEqual([
      shared.pubkey,
    ]);
    expect(entries.filter((entry) => entry.commitSig.block_id_flag === 2n)).toHaveLength(2);
    header.signedHeader.commit.signatures[2] = {
      block_id_flag: 1n,
      validator_address: '',
      timestamp: 0n,
      signature: '',
    };
    expect(() => selected(header, { mode: 'non_adjacent' })).toThrow('trusted voting-power quorum');
  });

  it('rejects insufficient overlap even when the available target power exceeds two thirds', () => {
    const header = powersHeader([70n, 20n, 10n], [1n, 1n, 98n]);
    header.signedHeader.commit.signatures[2].block_id_flag = 3n;
    expect(() => selected(header, { mode: 'non_adjacent' })).toThrow('trusted voting-power quorum');
  });

  it('does not count absent slots or nil votes toward target quorum', () => {
    const header = powersHeader([2n, 2n, 2n]);
    for (const flag of [1n, 3n]) {
      header.signedHeader.commit.signatures[2] =
        flag === 1n
          ? { block_id_flag: 1n, validator_address: '', timestamp: 0n, signature: '' }
          : { ...commitSignatures(header.validatorSet.validators)[2], block_id_flag: flag };
      expect(() => selected(header)).toThrow('target voting-power quorum');
    }
  });

  it('makes the same witness choices on retry without mutating the supplied header', () => {
    const header = fixtureHeader(capacityFixture.scenarios.non_adjacent_mixed);
    const before = structuredClone(header);
    expect(selected(header, { mode: 'non_adjacent' })).toEqual(selected(header, { mode: 'non_adjacent' }));
    expect(header).toEqual(before);
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
        trustLevel: { numerator: 1n, denominator: 3n },
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

    expect(() =>
      buildTendermintStagedPayloads({ trustLevel: { numerator: 1n, denominator: 3n }, header, mode: 'adjacent' }),
    ).toThrow('target validator root mismatch');
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
