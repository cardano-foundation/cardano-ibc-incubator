interface VotingValidator {
  pubkey: string;
  votingPower: bigint;
}

interface QuorumProgress {
  targetCount: bigint;
  targetSignedPower: bigint;
  trustedSignedPower: bigint;
}

/** Select witnesses only. Callers retain and authenticate both complete validator sets. */
export function selectTendermintQuorumWitnesses(input: {
  targetValidators: readonly VotingValidator[];
  commitSignatures: readonly { block_id_flag: bigint }[];
  trustedValidators?: readonly VotingValidator[];
  trustLevel: { numerator: bigint; denominator: bigint };
  requireSingleSetTrust?: boolean;
  preserveEvidenceQuorum?: boolean;
  progress?: QuorumProgress;
}): { signatures: Set<number>; memberships: Set<number> } {
  const { targetValidators, commitSignatures, trustedValidators, trustLevel } = input;
  if (
    trustLevel.denominator <= 0n ||
    trustLevel.numerator * 3n < trustLevel.denominator ||
    trustLevel.numerator > trustLevel.denominator
  ) {
    throw new Error('invalid Tendermint trust level');
  }
  const total = (validators: readonly VotingValidator[]) =>
    validators.reduce((sum, value) => sum + value.votingPower, 0n);
  const targetTotal = total(targetValidators);
  const trustedTotal = trustedValidators ? total(trustedValidators) : 0n;
  const progress = input.progress ?? { targetCount: 0n, targetSignedPower: 0n, trustedSignedPower: 0n };
  if (
    commitSignatures.length !== targetValidators.length ||
    progress.targetCount < 0n ||
    progress.targetCount > BigInt(targetValidators.length) ||
    progress.targetSignedPower < 0n ||
    progress.targetSignedPower > targetTotal ||
    progress.trustedSignedPower < 0n ||
    progress.trustedSignedPower > (trustedValidators ? trustedTotal : targetTotal)
  ) {
    throw new Error('invalid Tendermint quorum progress');
  }
  const signatures = new Set<number>();
  const memberships = new Set<number>();
  let targetSigned = progress.targetSignedPower;
  let trustedSigned = progress.trustedSignedPower;
  // Normal adjacent updates can reuse their receipt for explicit evidence.
  // Preserve that higher trust quorum when available without making it a
  // requirement for a normal update whose supplied commit cannot meet it.
  const available = targetValidators.reduce(
    (power, validator, index) =>
      BigInt(index) >= progress.targetCount && commitSignatures[index].block_id_flag === 2n
        ? power + validator.votingPower
        : power,
    targetSigned,
  );
  const requireSingleSetTrust =
    input.requireSingleSetTrust ||
    (input.preserveEvidenceQuorum && available * trustLevel.denominator > targetTotal * trustLevel.numerator);
  const targetQuorum = (power: bigint) =>
    power * 3n > targetTotal * 2n &&
    (!requireSingleSetTrust || power * trustLevel.denominator > targetTotal * trustLevel.numerator);
  const trustedQuorum = (power = trustedSigned) => power * trustLevel.denominator > trustedTotal * trustLevel.numerator;
  // Target validators are already in descending voting-power order. Keep their
  // original indices so omitted signatures never change the authenticated root.
  const candidates = targetValidators
    .map((validator, index) => ({ validator, index }))
    .filter(({ index }) => BigInt(index) >= progress.targetCount && commitSignatures[index].block_id_flag === 2n);
  const selectSignature = (index: number) => {
    if (!signatures.has(index)) {
      signatures.add(index);
      targetSigned += targetValidators[index].votingPower;
    }
  };
  for (const { index } of candidates) {
    if (targetQuorum(targetSigned)) break;
    selectSignature(index);
  }
  if (!targetQuorum(targetSigned))
    throw new Error('available commit signatures do not exceed the target voting-power quorum');

  if (trustedValidators) {
    const trustedByKey = new Map(trustedValidators.map((validator) => [validator.pubkey, validator]));
    const overlapping = candidates.flatMap(({ validator, index }) => {
      const trusted = trustedByKey.get(validator.pubkey);
      return trusted ? [{ index, power: trusted.votingPower }] : [];
    });
    overlapping.sort((left, right) =>
      left.power === right.power ? left.index - right.index : left.power > right.power ? -1 : 1,
    );
    // Reuse chosen target signatures first. Add other overlapping signers only
    // if the authenticated trusted powers still do not meet the trust fraction.
    for (const selected of [true, false]) {
      for (const { index, power } of overlapping) {
        if (trustedQuorum()) break;
        if (signatures.has(index) !== selected) continue;
        selectSignature(index);
        memberships.add(index);
        trustedSigned += power;
      }
    }
    if (!trustedQuorum()) throw new Error('available commit signatures do not exceed the trusted voting-power quorum');
    for (const { index, power } of [...overlapping].reverse()) {
      if (memberships.has(index) && trustedQuorum(trustedSigned - power)) {
        memberships.delete(index);
        trustedSigned -= power;
      }
    }
    // Extra overlap signatures can make an earlier target-only choice redundant.
    for (const { index } of [...candidates].reverse()) {
      if (
        signatures.has(index) &&
        !memberships.has(index) &&
        targetQuorum(targetSigned - targetValidators[index].votingPower)
      ) {
        signatures.delete(index);
        targetSigned -= targetValidators[index].votingPower;
      }
    }
  }
  return { signatures, memberships };
}
