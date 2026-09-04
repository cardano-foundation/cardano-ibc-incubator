import crypto from 'crypto';

import type { ClientDatum } from '../../shared/types/client-datum';
import type { BlockID } from '../../shared/types/cometbft/commit';
import type { TmHeader } from '../../shared/types/cometbft/header';
import type { Validator } from '../../shared/types/cometbft/validator';
import type { ValidatorSet } from '../../shared/types/cometbft/validator-set';
import type { ConsensusState } from '../../shared/types/consensus-state';
import type { Header } from '../../shared/types/header';
import type { SessionDatum } from '../../shared/types/tendermint-update-session';
import capacityFixture from '../../scripts/test/fixtures/tendermint-update-capacity/normalized.json';
import {
  advanceTendermintSession,
  appendTendermintMerkleAccumulator,
  capTendermintStagedValidTo,
  deriveTendermintSessionUpdatePlan,
  emptyTendermintMerkleAccumulator,
  initialTendermintSessionPhase,
  nextTendermintSessionAdvance,
  TENDERMINT_UPDATE_EXPIRY_SAFETY_MARGIN_MS,
  TENDERMINT_UPDATE_MIN_REMAINING_VALIDITY_MS,
  tendermintMerkleAccumulatorRoot,
  validateTendermintStagedFinalization,
} from '../update-client-session-state';
import {
  buildTendermintStagedPayloads,
  encodeTendermintSimpleValidator,
  hashTendermintValidatorSet,
  StagedTendermintValidator,
} from '../update-client-staged-payload';

const TEST_SLOT_CONFIG = { zeroTime: 0, zeroSlot: 0, slotLength: 1_000 };

function fixtureValidator(value: any): Validator {
  return {
    address: value.address,
    pubkey: value.pub_key.ed25519,
    votingPower: BigInt(value.voting_power),
    proposerPriority: BigInt(value.proposer_priority),
  };
}

function fixtureBlockId(value: any): BlockID {
  return {
    hash: value.hash,
    partSetHeader: {
      total: BigInt(value.part_set_header.total),
      hash: value.part_set_header.hash,
    },
  };
}

function fixtureValidatorSet(value: any): ValidatorSet {
  return {
    validators: value.validators.map(fixtureValidator),
    proposer: fixtureValidator(value.proposer),
    totalVotingPower: BigInt(value.total_voting_power),
  };
}

function fixtureHeader(scenario: any): Header {
  const value = scenario.header;
  const header = value.signed_header.header;
  const commit = value.signed_header.commit;
  const tmHeader: TmHeader = {
    version: { block: BigInt(header.version.block), app: BigInt(header.version.app) },
    chainId: Buffer.from(header.chain_id, 'utf8').toString('hex'),
    height: BigInt(header.height),
    time: BigInt(header.time),
    lastBlockId: fixtureBlockId(header.last_block_id),
    lastCommitHash: header.last_commit_hash,
    dataHash: header.data_hash,
    validatorsHash: header.validators_hash,
    nextValidatorsHash: header.next_validators_hash,
    consensusHash: header.consensus_hash,
    appHash: header.app_hash,
    lastResultsHash: header.last_results_hash,
    evidenceHash: header.evidence_hash,
    proposerAddress: header.proposer_address,
  };

  return {
    signedHeader: {
      header: tmHeader,
      commit: {
        height: BigInt(commit.height),
        round: BigInt(commit.round),
        blockId: fixtureBlockId(commit.block_id),
        signatures: commit.signatures.map((signature: any) => ({
          block_id_flag: BigInt(signature.block_id_flag),
          validator_address: signature.validator_address,
          timestamp: BigInt(signature.timestamp),
          signature: signature.signature,
        })),
      },
    },
    validatorSet: fixtureValidatorSet(value.validator_set),
    trustedHeight: {
      revisionNumber: BigInt(value.trusted_height.revision_number),
      revisionHeight: BigInt(value.trusted_height.revision_height),
    },
    trustedValidators: fixtureValidatorSet(value.trusted_validators),
  };
}

function fixtureConsensusState(scenario: any): ConsensusState {
  return {
    timestamp: BigInt(scenario.trusted_consensus_state.timestamp),
    next_validators_hash: scenario.trusted_consensus_state.next_validators_hash,
    root: { hash: scenario.trusted_consensus_state.root },
  };
}

function fixtureClientDatum(header: Header, consensusState: ConsensusState): ClientDatum {
  return {
    token: { policyId: 'aa'.repeat(28), name: 'bb'.repeat(32) },
    state: {
      clientState: {
        chainId: header.signedHeader.header.chainId,
        trustLevel: { numerator: 1n, denominator: 3n },
        trustingPeriod: 1_209_600_000_000_000n,
        unbondingPeriod: 1_814_400_000_000_000n,
        maxClockDrift: 10_000_000_000n,
        frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
        latestHeight: { ...header.trustedHeight },
        proofSpecs: [],
      },
      consensusStates: new Map([[{ ...header.trustedHeight }, consensusState]]),
      processedTimes: new Map(),
      processedHeights: new Map(),
    },
  };
}

function sessionFor(scenario: any): { datum: SessionDatum; header: Header; consensusState: ConsensusState } {
  const header = fixtureHeader(scenario);
  const consensusState = fixtureConsensusState(scenario);
  const plan = deriveTendermintSessionUpdatePlan({
    header,
    clientDatum: fixtureClientDatum(header, consensusState),
    trustedConsensusState: consensusState,
  });
  return {
    header,
    consensusState,
    datum: {
      sessionToken: { policyId: 'cc'.repeat(28), name: 'dd'.repeat(32) },
      owner: 'ee'.repeat(28),
      plan,
      phase: initialTendermintSessionPhase(plan),
    },
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

describe('pure Tendermint update-session state transitions', () => {
  it('caps the shared chain upper bound below the selected trust expiration', () => {
    const scenario = capacityFixture.scenarios.adjacent_all_signed;
    const header = fixtureHeader(scenario);
    const consensusState = fixtureConsensusState(scenario);
    const clientDatum = fixtureClientDatum(header, consensusState);
    const currentLedgerTimeMs = 1_700_000_000_000;
    const trustingPeriodMs = 20 * 60 * 1000;
    consensusState.timestamp = BigInt(currentLedgerTimeMs) * 1_000_000n;
    clientDatum.state.clientState.trustingPeriod = BigInt(trustingPeriodMs) * 1_000_000n;

    expect(
      capTendermintStagedValidTo({
        proposedValidToMs: currentLedgerTimeMs + 30 * 60 * 1000,
        currentLedgerTimeMs,
        trustedHeight: header.trustedHeight,
        clientDatum,
        slotConfig: TEST_SLOT_CONFIG,
      }),
    ).toBe(currentLedgerTimeMs + trustingPeriodMs - TENDERMINT_UPDATE_EXPIRY_SAFETY_MARGIN_MS - 1_000);
  });

  it('rejects before session creation when the safe trust window is too short', () => {
    const scenario = capacityFixture.scenarios.adjacent_all_signed;
    const header = fixtureHeader(scenario);
    const consensusState = fixtureConsensusState(scenario);
    const clientDatum = fixtureClientDatum(header, consensusState);
    const currentLedgerTimeMs = 1_700_000_000_000;
    consensusState.timestamp = BigInt(currentLedgerTimeMs) * 1_000_000n;
    clientDatum.state.clientState.trustingPeriod =
      BigInt(TENDERMINT_UPDATE_EXPIRY_SAFETY_MARGIN_MS + TENDERMINT_UPDATE_MIN_REMAINING_VALIDITY_MS) * 1_000_000n;

    expect(() =>
      capTendermintStagedValidTo({
        proposedValidToMs: currentLedgerTimeMs + 30 * 60 * 1000,
        currentLedgerTimeMs,
        trustedHeight: header.trustedHeight,
        clientDatum,
        slotConfig: TEST_SLOT_CONFIG,
      }),
    ).toThrow('before the safe trust deadline');
  });

  it('keeps an already-shorter proposed upper bound unchanged', () => {
    const scenario = capacityFixture.scenarios.adjacent_all_signed;
    const header = fixtureHeader(scenario);
    const consensusState = fixtureConsensusState(scenario);
    const clientDatum = fixtureClientDatum(header, consensusState);
    const currentLedgerTimeMs = 1_700_000_000_000;
    consensusState.timestamp = BigInt(currentLedgerTimeMs) * 1_000_000n;
    const proposedValidToMs = currentLedgerTimeMs + 10 * 60 * 1000;

    expect(
      capTendermintStagedValidTo({
        proposedValidToMs,
        currentLedgerTimeMs,
        trustedHeight: header.trustedHeight,
        clientDatum,
        slotConfig: TEST_SLOT_CONFIG,
      }),
    ).toBe(proposedValidToMs);
  });

  it('also caps the chain below the current latest consensus-state expiration', () => {
    const scenario = capacityFixture.scenarios.adjacent_all_signed;
    const header = fixtureHeader(scenario);
    const trustedConsensusState = fixtureConsensusState(scenario);
    const clientDatum = fixtureClientDatum(header, trustedConsensusState);
    const currentLedgerTimeMs = 1_700_000_000_000;
    const latestHeight = {
      revisionNumber: header.trustedHeight.revisionNumber,
      revisionHeight: header.trustedHeight.revisionHeight + 1n,
    };
    const latestConsensusState = {
      ...trustedConsensusState,
      timestamp: BigInt(currentLedgerTimeMs) * 1_000_000n,
    };
    trustedConsensusState.timestamp = BigInt(currentLedgerTimeMs + 10 * 60 * 1000) * 1_000_000n;
    clientDatum.state.clientState.latestHeight = latestHeight;
    clientDatum.state.clientState.trustingPeriod = 20n * 60n * 1_000_000_000n;
    clientDatum.state.consensusStates.set(latestHeight, latestConsensusState);

    expect(
      capTendermintStagedValidTo({
        proposedValidToMs: currentLedgerTimeMs + 30 * 60 * 1000,
        currentLedgerTimeMs,
        trustedHeight: header.trustedHeight,
        clientDatum,
        slotConfig: TEST_SLOT_CONFIG,
      }),
    ).toBe(currentLedgerTimeMs + 20 * 60 * 1000 - TENDERMINT_UPDATE_EXPIRY_SAFETY_MARGIN_MS - 1_000);
  });

  it('accepts active-client timing only when both strict on-chain inequalities hold', () => {
    const scenario = capacityFixture.scenarios.adjacent_all_signed;
    const header = fixtureHeader(scenario);
    const consensusState = fixtureConsensusState(scenario);
    const clientDatum = fixtureClientDatum(header, consensusState);
    const validFromTimeMs = 1_700_000_000_000;
    consensusState.timestamp = BigInt(validFromTimeMs - 1_000) * 1_000_000n;
    clientDatum.state.clientState.maxClockDrift = 10_000_000_000n;

    expect(() =>
      validateTendermintStagedFinalization({
        validFromTimeMs,
        trustedHeight: header.trustedHeight,
        headerTimeNs: BigInt(validFromTimeMs) * 1_000_000n,
        clientDatum,
      }),
    ).not.toThrow();
  });

  it('rejects a frozen client before staged finalization work', () => {
    const scenario = capacityFixture.scenarios.adjacent_all_signed;
    const header = fixtureHeader(scenario);
    const consensusState = fixtureConsensusState(scenario);
    const clientDatum = fixtureClientDatum(header, consensusState);
    clientDatum.state.clientState.frozenHeight = { revisionNumber: 0n, revisionHeight: 7n };

    expect(() =>
      validateTendermintStagedFinalization({
        validFromTimeMs: 1_700_000_000_000,
        trustedHeight: header.trustedHeight,
        headerTimeNs: consensusState.timestamp + 1n,
        clientDatum,
      }),
    ).toThrow('Tendermint client is frozen');
  });

  it('rejects a header that is not newer than its trusted consensus state', () => {
    const scenario = capacityFixture.scenarios.adjacent_all_signed;
    const header = fixtureHeader(scenario);
    const consensusState = fixtureConsensusState(scenario);
    const clientDatum = fixtureClientDatum(header, consensusState);

    expect(() =>
      validateTendermintStagedFinalization({
        validFromTimeMs: 1_700_000_000_000,
        trustedHeight: header.trustedHeight,
        headerTimeNs: consensusState.timestamp,
        clientDatum,
      }),
    ).toThrow('header time must be after the trusted consensus state timestamp');
  });

  it('rejects a header that is not newer than the live latest consensus state', () => {
    const scenario = capacityFixture.scenarios.adjacent_all_signed;
    const header = fixtureHeader(scenario);
    const trustedConsensusState = fixtureConsensusState(scenario);
    const clientDatum = fixtureClientDatum(header, trustedConsensusState);
    const latestHeight = {
      revisionNumber: header.trustedHeight.revisionNumber,
      revisionHeight: header.trustedHeight.revisionHeight + 1n,
    };
    const headerTimeNs = 1_700_000_000_000_000_000n;
    trustedConsensusState.timestamp = headerTimeNs - 2_000_000_000n;
    clientDatum.state.clientState.latestHeight = latestHeight;
    clientDatum.state.consensusStates.set(latestHeight, {
      ...trustedConsensusState,
      timestamp: headerTimeNs,
    });

    expect(() =>
      validateTendermintStagedFinalization({
        validFromTimeMs: 1_700_000_000_000,
        trustedHeight: header.trustedHeight,
        headerTimeNs,
        clientDatum,
      }),
    ).toThrow('header time must be after the current latest consensus state timestamp');
  });

  it('rejects a header at the max-clock-drift boundary', () => {
    const scenario = capacityFixture.scenarios.adjacent_all_signed;
    const header = fixtureHeader(scenario);
    const consensusState = fixtureConsensusState(scenario);
    const clientDatum = fixtureClientDatum(header, consensusState);
    const validFromTimeMs = 1_700_000_000_000;
    clientDatum.state.clientState.maxClockDrift = 10_000_000_000n;
    consensusState.timestamp = BigInt(validFromTimeMs - 1_000) * 1_000_000n;

    expect(() =>
      validateTendermintStagedFinalization({
        validFromTimeMs,
        trustedHeight: header.trustedHeight,
        headerTimeNs: BigInt(validFromTimeMs) * 1_000_000n + clientDatum.state.clientState.maxClockDrift,
        clientDatum,
      }),
    ).toThrow('header time must be before the validity lower bound plus max clock drift');
  });

  it.each([
    [1, '932b282041489257a56472bb0f5caa3a920b0c8147c5d5bf6500cb0efbc209a9'],
    [3, '1baf1d34f22c38c99e84688ce6ac033183a693ddb847943fae5ab826f5e89ad8'],
    [5, 'c2ad9b71a39d1ac20c5db6587d0b4f84e32f0155cbba5bc87b3e4d0f45721295'],
    [9, '5a2d381af1c65f4fca79d54854d329bb80ee72a32af369c3dfd83e6840c48a6a'],
  ])('bags streaming peaks to the pinned RFC-6962 root for %i leaves', (count, expectedRoot) => {
    const validators = deterministicValidators(count);
    const accumulator = validators.reduce(
      (current, validator) => appendTendermintMerkleAccumulator(current, encodeTendermintSimpleValidator(validator)),
      emptyTendermintMerkleAccumulator(),
    );

    expect(tendermintMerkleAccumulatorRoot(accumulator)).toBe(expectedRoot);
    expect(tendermintMerkleAccumulatorRoot(accumulator)).toBe(hashTendermintValidatorSet(validators));
  });

  it('derives the compact plan and canonically zeros adjacent trusted-validator count', () => {
    const scenario = capacityFixture.scenarios.adjacent_all_signed;
    const { datum, header, consensusState } = sessionFor(scenario);

    expect(header.trustedValidators.validators).toHaveLength(45);
    expect(datum.plan).toMatchObject({
      clientToken: { policyId: 'aa'.repeat(28), name: 'bb'.repeat(32) },
      trustedHeight: header.trustedHeight,
      trustedConsensusState: consensusState,
      trustLevel: { numerator: 1n, denominator: 3n },
      targetValidatorCount: 45n,
      trustedValidatorCount: 0n,
    });
    expect(datum.plan.commit).toEqual({
      height: header.signedHeader.commit.height,
      round: header.signedHeader.commit.round,
      blockId: header.signedHeader.commit.blockId,
    });
    expect(datum.plan.commit).not.toHaveProperty('signatures');
    expect(datum.phase).toEqual({
      AdjacentTarget: {
        targetAccumulator: { count: 0n, peaks: [] },
        targetTotalPower: 0n,
        targetSignedPower: 0n,
        lastTarget: null,
      },
    });
  });

  it('streams the frozen 45-validator adjacent update to Complete without mutating its input', () => {
    const scenario = capacityFixture.scenarios.adjacent_all_signed;
    const { datum: initial, header } = sessionFor(scenario);
    const payloads = buildTendermintStagedPayloads({ header, mode: 'adjacent' });
    let datum = initial;

    payloads.targetBatches.slice(0, -1).forEach((batch) => {
      datum = advanceTendermintSession(datum, { VerifyTarget: { entries: batch.entries } });
    });
    expect(initial.phase).toEqual(initialTendermintSessionPhase(initial.plan));
    expect(datum.phase).toMatchObject({
      AdjacentTarget: {
        targetAccumulator: { count: 42n, peaks: [{ size: 2n }, { size: 8n }, { size: 32n }] },
      },
    });

    datum = advanceTendermintSession(datum, {
      VerifyTarget: { entries: payloads.targetBatches[payloads.targetBatches.length - 1].entries },
    });
    expect(datum.phase).toEqual({
      Complete: {
        targetRoot: scenario.observations.validator_hash,
        targetTotalPower: BigInt(scenario.header.validator_set.total_voting_power),
        targetSignedPower: BigInt(scenario.header.validator_set.total_voting_power),
        trustedRoot: null,
        trustedTotalPower: 0n,
        trustedSignedPower: 0n,
      },
    });
    expect(nextTendermintSessionAdvance(datum, payloads)).toBeNull();
  });

  it('selects trusted and target redeemers from arbitrary on-chain accumulator counts', () => {
    const scenario = capacityFixture.scenarios.non_adjacent_mixed;
    const { datum: initial, header, consensusState } = sessionFor(scenario);
    const payloads = buildTendermintStagedPayloads({
      header,
      mode: 'non_adjacent',
      expectedTrustedValidatorsHash: consensusState.next_validators_hash,
    });
    const allTrusted = payloads.trustedBatches.flatMap((batch) => batch.validators);
    const allTargets = payloads.targetBatches.flatMap((batch) => batch.entries);

    let datum = advanceTendermintSession(initial, { VerifyTrusted: { validators: allTrusted.slice(0, 3) } });
    const resumedTrusted = nextTendermintSessionAdvance(datum, payloads);
    expect(resumedTrusted).toEqual({ VerifyTrusted: { validators: allTrusted.slice(3, 9) } });

    while ('NonAdjacentTrusted' in datum.phase) {
      const next = nextTendermintSessionAdvance(datum, payloads);
      if (!next || !('VerifyTrusted' in next)) throw new Error('expected trusted advance');
      datum = advanceTendermintSession(datum, next);
    }
    expect(datum.phase).toHaveProperty('NonAdjacentTarget');

    datum = advanceTendermintSession(datum, { VerifyTarget: { entries: allTargets.slice(0, 3) } });
    const resumedTarget = nextTendermintSessionAdvance(datum, payloads);
    expect(resumedTarget).toEqual({ VerifyTarget: { entries: allTargets.slice(3, 9) } });
    expect(resumedTarget && 'VerifyTarget' in resumedTarget && resumedTarget.VerifyTarget.entries).toHaveLength(6);
  });

  it('streams trusted validators, memberships, bitmap, and target powers for the frozen skipped update', () => {
    const scenario = capacityFixture.scenarios.non_adjacent_mixed;
    const { datum: initial, header, consensusState } = sessionFor(scenario);
    const payloads = buildTendermintStagedPayloads({
      header,
      mode: 'non_adjacent',
      expectedTrustedValidatorsHash: consensusState.next_validators_hash,
    });
    let datum = initial;

    payloads.trustedBatches.forEach((batch) => {
      datum = advanceTendermintSession(datum, { VerifyTrusted: { validators: batch.validators } });
    });
    expect(datum.phase).toMatchObject({
      NonAdjacentTarget: {
        trustedRoot: consensusState.next_validators_hash,
        trustedTotalPower: BigInt(scenario.header.trusted_validators.total_voting_power),
        targetAccumulator: { count: 0n, peaks: [] },
        usedTrustedIndices: 0n,
        lastTarget: null,
      },
    });

    payloads.targetBatches.slice(0, -1).forEach((batch) => {
      datum = advanceTendermintSession(datum, { VerifyTarget: { entries: batch.entries } });
    });
    const preFinalMemberships = payloads.targetBatches
      .slice(0, -1)
      .flatMap((batch) => batch.entries)
      .map((entry) => entry.trustedMembership)
      .filter((membership) => membership !== null);
    const expectedBitmap = preFinalMemberships.reduce((bitmap, membership) => bitmap | (1n << membership.index), 0n);
    const expectedTrustedPower = preFinalMemberships.reduce(
      (total, membership) => total + membership.trustedValidator.votingPower,
      0n,
    );
    expect(datum.phase).toMatchObject({
      NonAdjacentTarget: {
        targetAccumulator: { count: 42n, peaks: [{ size: 2n }, { size: 8n }, { size: 32n }] },
        usedTrustedIndices: expectedBitmap,
        trustedSignedPower: expectedTrustedPower,
      },
    });

    datum = advanceTendermintSession(datum, {
      VerifyTarget: { entries: payloads.targetBatches[payloads.targetBatches.length - 1].entries },
    });
    const allEntries = payloads.targetBatches.flatMap((batch) => batch.entries);
    const allMemberships = allEntries
      .map((entry) => entry.trustedMembership)
      .filter((membership) => membership !== null);
    expect(datum.phase).toEqual({
      Complete: {
        targetRoot: scenario.observations.validator_hash,
        targetTotalPower: BigInt(scenario.header.validator_set.total_voting_power),
        targetSignedPower: allEntries.reduce(
          (total, entry) => total + (entry.commitSig.block_id_flag === 2n ? entry.targetValidator.votingPower : 0n),
          0n,
        ),
        trustedRoot: consensusState.next_validators_hash,
        trustedTotalPower: BigInt(scenario.header.trusted_validators.total_voting_power),
        trustedSignedPower: allMemberships.reduce(
          (total, membership) => total + membership.trustedValidator.votingPower,
          0n,
        ),
      },
    });
  });

  it('rejects a tampered commit signature and leaves the prior datum reusable', () => {
    const scenario = capacityFixture.scenarios.adjacent_all_signed;
    const { datum, header } = sessionFor(scenario);
    const [batch] = buildTendermintStagedPayloads({ header, mode: 'adjacent' }).targetBatches;
    const entries = batch.entries.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            commitSig: {
              ...entry.commitSig,
              signature: `${entry.commitSig.signature.slice(0, -2)}00`,
            },
          }
        : entry,
    );

    expect(() => advanceTendermintSession(datum, { VerifyTarget: { entries } })).toThrow(
      'invalid Ed25519 commit signature',
    );
    expect(datum.phase).toEqual(initialTendermintSessionPhase(datum.plan));
  });

  it('rejects a trusted membership index already recorded in the resumed bitmap', () => {
    const scenario = capacityFixture.scenarios.non_adjacent_mixed;
    const { datum: initial, header, consensusState } = sessionFor(scenario);
    const payloads = buildTendermintStagedPayloads({
      header,
      mode: 'non_adjacent',
      expectedTrustedValidatorsHash: consensusState.next_validators_hash,
    });
    let datum = initial;
    payloads.trustedBatches.forEach((batch) => {
      datum = advanceTendermintSession(datum, { VerifyTrusted: { validators: batch.validators } });
    });
    if (!('NonAdjacentTarget' in datum.phase)) throw new Error('expected target phase');
    const entry = payloads.targetBatches
      .flatMap((batch) => batch.entries)
      .find((candidate) => candidate.trustedMembership);
    if (!entry?.trustedMembership) throw new Error('fixture must include a trusted membership');
    datum = {
      ...datum,
      phase: {
        NonAdjacentTarget: {
          ...datum.phase.NonAdjacentTarget,
          usedTrustedIndices: 1n << entry.trustedMembership.index,
        },
      },
    };

    expect(() => advanceTendermintSession(datum, { VerifyTarget: { entries: [entry] } })).toThrow(
      `trusted validator index ${entry.trustedMembership.index.toString()} has already contributed voting power`,
    );
  });

  it('uses exact height identity for trusted-state lookup and rejects ambiguous logical keys', () => {
    const scenario = capacityFixture.scenarios.non_adjacent_mixed;
    const header = fixtureHeader(scenario);
    const consensusState = fixtureConsensusState(scenario);
    const clientDatum = fixtureClientDatum(header, consensusState);
    clientDatum.state.consensusStates.set(
      { ...header.trustedHeight },
      { ...consensusState, root: { ...consensusState.root } },
    );

    expect(() => deriveTendermintSessionUpdatePlan({ header, clientDatum })).toThrow(
      'trusted height must identify exactly one current consensus state; found 2',
    );
  });

  it('rejects wrong-phase and over-limit batches before changing accumulator state', () => {
    const scenario = capacityFixture.scenarios.adjacent_all_signed;
    const { datum, header } = sessionFor(scenario);
    const payloads = buildTendermintStagedPayloads({ header, mode: 'adjacent' });

    expect(() => advanceTendermintSession(datum, { VerifyTrusted: { validators: [] } })).toThrow('wrong session phase');
    expect(() =>
      advanceTendermintSession(datum, {
        VerifyTarget: {
          entries: [...payloads.targetBatches[0].entries, ...payloads.targetBatches[1].entries.slice(0, 2)],
        },
      }),
    ).toThrow('between 1 and 6 entries');
    expect(datum.phase).toEqual(initialTendermintSessionPhase(datum.plan));
  });
});
