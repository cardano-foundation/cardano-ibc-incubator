import type { Validator } from '../types/cometbft/validator';
import type { Header } from '../types/header';
import type { SessionDatum, SpendSessionRedeemer } from '../types/tendermint-update-session';
import { hashTendermintValidatorSet } from '../../tx/update-client-staged-payload';

function canonicalValidatorOrder(left: Validator, right: Validator): number {
  if (left.votingPower !== right.votingPower) return left.votingPower > right.votingPower ? -1 : 1;
  return left.address.localeCompare(right.address);
}

function totalVotingPower(validators: readonly Validator[]): bigint {
  return validators.reduce((total, validator) => total + validator.votingPower, 0n);
}

function requireCount(label: string, actual: number, expected: bigint): void {
  if (BigInt(actual) !== expected) {
    throw new Error(`Cannot reconstruct staged Tendermint header: expected ${expected} ${label}, found ${actual}`);
  }
}

function requireValidatorRoot(label: string, validators: Validator[], expectedRoot: string): void {
  const actualRoot = hashTendermintValidatorSet(validators);
  if (actualRoot !== expectedRoot.toLowerCase()) {
    throw new Error(
      `Cannot reconstruct staged Tendermint header: ${label} validator root ${actualRoot} does not match ${expectedRoot}`,
    );
  }
}

/**
 * Rebuild the Header carried by an update-client event from durable session
 * data. Validator/signature batches live in the preceding session redeemers,
 * while the completed datum contains the immutable header and commit core.
 */
export function reconstructStagedTendermintHeader(
  completeSession: SessionDatum,
  sessionRedeemers: readonly SpendSessionRedeemer[],
): Header {
  if (!('Complete' in completeSession.phase)) {
    throw new Error('Cannot reconstruct staged Tendermint header from an incomplete session');
  }

  const targetEntries = sessionRedeemers.flatMap((redeemer) =>
    typeof redeemer !== 'string' && 'VerifyTarget' in redeemer ? redeemer.VerifyTarget.entries : [],
  );
  const trustedValidators = sessionRedeemers
    .flatMap((redeemer) =>
      typeof redeemer !== 'string' && 'VerifyTrusted' in redeemer ? redeemer.VerifyTrusted.validators : [],
    )
    .sort(canonicalValidatorOrder);
  targetEntries.sort((left, right) => canonicalValidatorOrder(left.targetValidator, right.targetValidator));

  const plan = completeSession.plan;
  const targetValidators = targetEntries.map((entry) => entry.targetValidator);
  const commitSignatures = targetEntries.map((entry) => entry.commitSig);
  const adjacent = plan.header.height === plan.trustedHeight.revisionHeight + 1n;
  const eventTrustedValidators = adjacent ? targetValidators : trustedValidators;

  requireCount('target validators', targetValidators.length, plan.targetValidatorCount);
  requireCount('commit signatures', commitSignatures.length, plan.targetValidatorCount);
  requireCount('trusted validators', trustedValidators.length, plan.trustedValidatorCount);
  requireValidatorRoot('target', targetValidators, plan.header.validatorsHash);
  requireValidatorRoot('trusted', eventTrustedValidators, plan.trustedConsensusState.next_validators_hash);

  const targetTotalPower = totalVotingPower(targetValidators);
  const trustedTotalPower = totalVotingPower(eventTrustedValidators);
  if (targetTotalPower !== completeSession.phase.Complete.targetTotalPower) {
    throw new Error('Cannot reconstruct staged Tendermint header: target voting power does not match the receipt');
  }
  if (!adjacent && trustedTotalPower !== completeSession.phase.Complete.trustedTotalPower) {
    throw new Error('Cannot reconstruct staged Tendermint header: trusted voting power does not match the receipt');
  }

  const targetProposer = targetValidators.find(
    (validator) => validator.address.toLowerCase() === plan.header.proposerAddress.toLowerCase(),
  );
  if (!targetProposer) {
    throw new Error('Cannot reconstruct staged Tendermint header: target proposer is not in the validator set');
  }

  // The trusted ValidatorSet proposer is not part of the validator-set hash and
  // is not used by Tendermint light verification. A skipped-height session does
  // not retain that redundant field, so choose a deterministic set member. All
  // consensus-relevant Header fields remain identical to the submitted Header.
  const trustedProposer = adjacent ? targetProposer : eventTrustedValidators[0];
  if (!trustedProposer) {
    throw new Error('Cannot reconstruct staged Tendermint header: trusted validator set is empty');
  }

  return {
    signedHeader: {
      header: plan.header,
      commit: {
        height: plan.commit.height,
        round: plan.commit.round,
        blockId: plan.commit.blockId,
        signatures: commitSignatures,
      },
    },
    validatorSet: {
      validators: targetValidators,
      proposer: targetProposer,
      totalVotingPower: targetTotalPower,
    },
    trustedHeight: plan.trustedHeight,
    trustedValidators: {
      validators: eventTrustedValidators,
      proposer: trustedProposer,
      totalVotingPower: trustedTotalPower,
    },
  };
}
