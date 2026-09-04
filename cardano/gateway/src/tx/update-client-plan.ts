import crypto from 'crypto';

const TENDERMINT_MULTITX_PROTOCOL = 'tendermint-multitx-v1' as const;
export const TENDERMINT_MULTITX_MAX_BATCH_SIZE = 6;
export const TENDERMINT_MULTITX_MAX_VALIDATOR_COUNT = 256;

export type TendermintUpdateMode = 'adjacent' | 'non_adjacent';

export type TendermintUpdateStepKind = 'initialize' | 'verify_trusted' | 'verify_target' | 'finalize';

export interface TendermintValidatorRange {
  start: number;
  end: number;
}

interface TendermintUpdatePlanStep {
  id: string;
  kind: TendermintUpdateStepKind;
  dependsOn: string[];
  range?: TendermintValidatorRange;
}

interface TendermintUpdateCleanupStep {
  id: 'cancel';
  kind: 'cancel';
  /**
   * Cancellation is an alternative terminal action, not a happy-path DAG node.
   * The session validator requires the session owner's signature.
   */
  authorization: 'session_validator';
}

interface TendermintUpdatePlan {
  protocol: typeof TENDERMINT_MULTITX_PROTOCOL;
  /** Stable query/retry key. The minted session token additionally commits to its seed UTxO. */
  planId: string;
  clientId: string;
  clientMessageHash: string;
  mode: TendermintUpdateMode;
  batchSize: number;
  targetValidatorCount: number;
  trustedValidatorCount: number;
  steps: TendermintUpdatePlanStep[];
  cleanup: TendermintUpdateCleanupStep;
}

interface BuildTendermintUpdatePlanInput {
  clientId: string;
  /** SHA3-256 commitment to the canonical MsgUpdateClient protobuf bytes. */
  clientMessageHash: string;
  mode: TendermintUpdateMode;
  targetValidatorCount: number;
  trustedValidatorCount: number;
  batchSize?: number;
}

/**
 * Build the logical, transaction-independent update plan.
 *
 * Version 1 intentionally has a single authenticated session UTxO, so every
 * verification step depends on the previous one. Keeping dependencies explicit
 * lets the wire format and Hermes executor evolve to parallel receipt/merge DAGs
 * without changing the plan envelope.
 */
export function buildTendermintUpdatePlan(input: BuildTendermintUpdatePlanInput): TendermintUpdatePlan {
  const clientId = input.clientId.trim();
  if (!clientId || clientId.includes('\0')) {
    throw new Error('clientId must be non-empty and must not contain NUL');
  }

  const clientMessageHash = normalizeHash(input.clientMessageHash);
  const targetValidatorCount = validateCount('targetValidatorCount', input.targetValidatorCount, false);
  const trustedValidatorCount = validateCount(
    'trustedValidatorCount',
    input.trustedValidatorCount,
    input.mode === 'adjacent',
  );
  const batchSize = validateBatchSize(input.batchSize ?? TENDERMINT_MULTITX_MAX_BATCH_SIZE);

  if (input.mode !== 'adjacent' && input.mode !== 'non_adjacent') {
    throw new Error(`unsupported Tendermint update mode: ${String(input.mode)}`);
  }
  if (input.mode === 'adjacent' && trustedValidatorCount !== 0) {
    throw new Error('trustedValidatorCount must be zero for an adjacent Tendermint update plan');
  }

  const planId = derivePlanId({
    clientId,
    clientMessageHash,
    mode: input.mode,
    targetValidatorCount,
    trustedValidatorCount,
    batchSize,
  });

  const steps: TendermintUpdatePlanStep[] = [];
  let previousStepId: string | undefined;

  const appendStep = (step: Omit<TendermintUpdatePlanStep, 'dependsOn'>): void => {
    const plannedStep: TendermintUpdatePlanStep = {
      ...step,
      dependsOn: previousStepId ? [previousStepId] : [],
    };
    steps.push(plannedStep);
    previousStepId = plannedStep.id;
  };

  appendStep({ id: 'initialize', kind: 'initialize' });

  if (input.mode === 'non_adjacent') {
    for (const range of partitionValidatorRange(trustedValidatorCount, batchSize)) {
      appendStep({
        id: rangeStepId('verify_trusted', range),
        kind: 'verify_trusted',
        range,
      });
    }
  }

  for (const range of partitionValidatorRange(targetValidatorCount, batchSize)) {
    appendStep({
      id: rangeStepId('verify_target', range),
      kind: 'verify_target',
      range,
    });
  }

  appendStep({ id: 'finalize', kind: 'finalize' });

  return {
    protocol: TENDERMINT_MULTITX_PROTOCOL,
    planId,
    clientId,
    clientMessageHash,
    mode: input.mode,
    batchSize,
    targetValidatorCount,
    trustedValidatorCount,
    steps,
    cleanup: {
      id: 'cancel',
      kind: 'cancel',
      authorization: 'session_validator',
    },
  };
}

/** Return all dependency-satisfied actions after re-querying on-chain progress. */
export function getReadyTendermintUpdateSteps(
  plan: TendermintUpdatePlan,
  completedStepIds: Iterable<string>,
): TendermintUpdatePlanStep[] {
  const completed = new Set(completedStepIds);
  const knownStepIds = new Set(plan.steps.map((step) => step.id));

  for (const completedStepId of completed) {
    if (!knownStepIds.has(completedStepId)) {
      throw new Error(`completed Tendermint update step is not in plan: ${completedStepId}`);
    }
  }

  return plan.steps.filter(
    (step) => !completed.has(step.id) && step.dependsOn.every((dependency) => completed.has(dependency)),
  );
}

function partitionValidatorRange(validatorCount: number, batchSize: number): TendermintValidatorRange[] {
  const ranges: TendermintValidatorRange[] = [];
  for (let start = 0; start < validatorCount; start += batchSize) {
    ranges.push({ start, end: Math.min(start + batchSize, validatorCount) });
  }
  return ranges;
}

function rangeStepId(kind: 'verify_trusted' | 'verify_target', range: TendermintValidatorRange): string {
  return `${kind}:${range.start}-${range.end}`;
}

function validateCount(name: string, value: number, allowZero: boolean): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > TENDERMINT_MULTITX_MAX_VALIDATOR_COUNT) {
    const expected = allowZero ? 'a non-negative integer' : 'a positive integer';
    throw new Error(`${name} must be ${expected}`);
  }
  return value;
}

function validateBatchSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > TENDERMINT_MULTITX_MAX_BATCH_SIZE) {
    throw new Error(`batchSize must be an integer between 1 and ${TENDERMINT_MULTITX_MAX_BATCH_SIZE}`);
  }
  return value;
}

function normalizeHash(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('clientMessageHash must be a 32-byte hexadecimal SHA3-256 digest');
  }
  return normalized;
}

function derivePlanId(input: {
  clientId: string;
  clientMessageHash: string;
  mode: TendermintUpdateMode;
  targetValidatorCount: number;
  trustedValidatorCount: number;
  batchSize: number;
}): string {
  const commitment = [
    TENDERMINT_MULTITX_PROTOCOL,
    input.clientId,
    input.clientMessageHash,
    input.mode,
    input.targetValidatorCount.toString(10),
    input.trustedValidatorCount.toString(10),
    input.batchSize.toString(10),
  ].join('\0');

  return crypto.createHash('sha3-256').update(commitment, 'utf8').digest('hex');
}
