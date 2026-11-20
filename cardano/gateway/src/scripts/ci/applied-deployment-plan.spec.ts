import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readAppliedDeploymentPlan } from './applied-deployment-plan';

describe('fully applied production deployment inventory', () => {
  let directory: string;
  let blueprintPath: string;
  let planPath: string;
  const blueprint = '{"validators":[]}';
  const reference = (title = 'parameterized.spend') => ({
    title,
    publication: 'runtime',
    script: { type: 'PlutusV3', script: 'aabbccdd' },
    appliedScriptBytes: 4,
    estimatedReferenceOutputBytes: 204,
  });
  const fixture = () => ({
    schemaVersion: 1,
    network: 'Preview',
    blueprintSha256: createHash('sha256').update(blueprint).digest('hex'),
    modes: ['production', 'local-benchmark'].map((name) => ({ name, referenceValidators: [reference()] })),
  });
  const read = () => readAppliedDeploymentPlan(planPath, blueprintPath, 16_384, 750);
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'applied-deployment-plan-'));
    blueprintPath = join(directory, 'plutus.json');
    planPath = join(directory, 'deployment-plan.json');
    writeFileSync(blueprintPath, blueprint);
    writeFileSync(planPath, JSON.stringify(fixture()));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('uses every fully applied reference from both production modes', () => {
    expect(read()).toEqual(['production', 'local-benchmark'].map((mode) => ({
      mode, title: 'parameterized.spend', appliedScriptBytes: 4, estimatedReferenceOutputBytes: 204,
    })));
  });

  it('fails closed when no production artifact was generated', () => {
    rmSync(planPath);
    expect(read).toThrow(/ENOENT/);
  });

  it('rejects a stale artifact after any blueprint change', () => {
    writeFileSync(blueprintPath, `${blueprint}\n`);
    expect(read).toThrow(/stale/);
  });

  it('rejects raw-script byte counts paired with fully applied script bytes', () => {
    const plan = fixture();
    plan.modes[0].referenceValidators[0].appliedScriptBytes = 3;
    writeFileSync(planPath, JSON.stringify(plan));
    expect(read).toThrow(/Invalid applied/);
  });

  it('rejects a missing or empty production mode', () => {
    const plan = fixture();
    plan.modes.pop();
    writeFileSync(planPath, JSON.stringify(plan));
    expect(read).toThrow(/missing required mode/);
    plan.modes[0].referenceValidators = [];
    writeFileSync(planPath, JSON.stringify(plan));
    expect(read).toThrow(/no reference validators/);
  });

  it('rejects a newly registered oversized reference without a scenario allowlist', () => {
    const plan = fixture();
    const added = reference('previously.unlisted.mint');
    added.script.script = 'ab'.repeat(15_435);
    added.appliedScriptBytes = 15_435;
    added.estimatedReferenceOutputBytes = 15_635;
    plan.modes[1].referenceValidators.push(added);
    writeFileSync(planPath, JSON.stringify(plan));
    expect(read).toThrow(/local-benchmark\/previously.unlisted.mint.*15635.*15634/);
  });

  it('rejects duplicate references instead of hiding omissions behind the count', () => {
    const plan = fixture();
    plan.modes[0].referenceValidators.push(reference());
    writeFileSync(planPath, JSON.stringify(plan));
    expect(read).toThrow(/titles must be nonempty and unique/);
  });
});
