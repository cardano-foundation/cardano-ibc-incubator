import {
  buildTendermintUpdatePlan,
  getReadyTendermintUpdateSteps,
  TENDERMINT_MULTITX_MAX_BATCH_SIZE,
  TENDERMINT_MULTITX_MAX_VALIDATOR_COUNT,
} from '../update-client-plan';

const MESSAGE_HASH = 'ab'.repeat(32);

function buildPlan(validatorCount: number, mode: 'adjacent' | 'non_adjacent' = 'adjacent') {
  return buildTendermintUpdatePlan({
    clientId: '07-tendermint-0',
    clientMessageHash: MESSAGE_HASH,
    mode,
    targetValidatorCount: validatorCount,
    trustedValidatorCount: mode === 'adjacent' ? 0 : validatorCount,
  });
}

describe('Tendermint multi-transaction update plan', () => {
  it.each([
    [45, 8, 10],
    [100, 17, 19],
    [200, 34, 36],
  ])('partitions an adjacent %i-validator update into %i batches and %i transactions', (count, batchCount, txCount) => {
    const plan = buildPlan(count);
    const targetSteps = plan.steps.filter((step) => step.kind === 'verify_target');

    expect(targetSteps).toHaveLength(batchCount);
    expect(plan.steps).toHaveLength(txCount);
    expect(targetSteps[0].range).toEqual({ start: 0, end: Math.min(count, TENDERMINT_MULTITX_MAX_BATCH_SIZE) });
    expect(targetSteps.at(-1)?.range?.end).toBe(count);
    expect(targetSteps.every((step) => step.range.end - step.range.start <= TENDERMINT_MULTITX_MAX_BATCH_SIZE)).toBe(
      true,
    );
  });

  it.each([
    [45, 18],
    [100, 36],
    [200, 70],
  ])('plans trusted and target phases for a non-adjacent %i-validator update', (count, txCount) => {
    const plan = buildPlan(count, 'non_adjacent');
    const trustedSteps = plan.steps.filter((step) => step.kind === 'verify_trusted');
    const targetSteps = plan.steps.filter((step) => step.kind === 'verify_target');

    expect(plan.steps).toHaveLength(txCount);
    expect(trustedSteps).toHaveLength(Math.ceil(count / TENDERMINT_MULTITX_MAX_BATCH_SIZE));
    expect(targetSteps).toHaveLength(Math.ceil(count / TENDERMINT_MULTITX_MAX_BATCH_SIZE));
    expect(targetSteps[0].dependsOn).toEqual([trustedSteps.at(-1)?.id]);
  });

  it('builds a deterministic dependency chain and resumes at the first incomplete step', () => {
    const first = buildPlan(17, 'non_adjacent');
    const second = buildPlan(17, 'non_adjacent');

    expect(second).toEqual(first);
    expect(first.planId).toMatch(/^[0-9a-f]{64}$/);
    expect(getReadyTendermintUpdateSteps(first, [])).toEqual([first.steps[0]]);

    const completed = first.steps.slice(0, 4).map((step) => step.id);
    expect(getReadyTendermintUpdateSteps(first, completed)).toEqual([first.steps[4]]);

    expect(
      getReadyTendermintUpdateSteps(
        first,
        first.steps.map((step) => step.id),
      ),
    ).toEqual([]);
  });

  it('keeps cancellation outside the happy-path dependency chain', () => {
    const plan = buildPlan(45);

    expect(plan.cleanup).toEqual({
      id: 'cancel',
      kind: 'cancel',
      authorization: 'session_validator',
    });
    expect(plan.steps.some((step) => step.id === plan.cleanup.id)).toBe(false);
  });

  it('rejects unsafe batch sizes and malformed plan commitments', () => {
    expect(() =>
      buildTendermintUpdatePlan({
        clientId: '07-tendermint-0',
        clientMessageHash: MESSAGE_HASH,
        mode: 'adjacent',
        targetValidatorCount: 45,
        trustedValidatorCount: 0,
        batchSize: TENDERMINT_MULTITX_MAX_BATCH_SIZE + 1,
      }),
    ).toThrow('batchSize');

    expect(() =>
      buildTendermintUpdatePlan({
        clientId: '07-tendermint-0',
        clientMessageHash: MESSAGE_HASH,
        mode: 'adjacent',
        targetValidatorCount: 45,
        trustedValidatorCount: 0,
        batchSize: 8,
      }),
    ).toThrow('batchSize');

    expect(() =>
      buildTendermintUpdatePlan({
        clientId: '07-tendermint-0',
        clientMessageHash: 'not-a-hash',
        mode: 'adjacent',
        targetValidatorCount: 45,
        trustedValidatorCount: 0,
      }),
    ).toThrow('clientMessageHash');
  });

  it('mirrors the on-chain 256-validator session limit', () => {
    expect(buildPlan(TENDERMINT_MULTITX_MAX_VALIDATOR_COUNT).targetValidatorCount).toBe(256);

    expect(() => buildPlan(TENDERMINT_MULTITX_MAX_VALIDATOR_COUNT + 1)).toThrow('targetValidatorCount');
  });

  it('requires adjacent callers to normalize the unused trusted count to zero', () => {
    expect(() =>
      buildTendermintUpdatePlan({
        clientId: '07-tendermint-0',
        clientMessageHash: MESSAGE_HASH,
        mode: 'adjacent',
        targetValidatorCount: 45,
        trustedValidatorCount: 45,
      }),
    ).toThrow('must be zero');
  });

  it('rejects progress that belongs to another logical plan', () => {
    const plan = buildPlan(45);

    expect(() => getReadyTendermintUpdateSteps(plan, ['verify_target:80-88'])).toThrow('not in plan');
  });
});
