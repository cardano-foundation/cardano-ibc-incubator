import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type AppliedReferenceValidator = {
  title: string;
  mode: string;
  appliedScriptBytes: number;
  estimatedReferenceOutputBytes: number;
};

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid deployment plan: ${label} must be an object`);
  }
  return value as JsonObject;
}

/** Consume the inventory exported by the production loader, never a second script list. */
export function readAppliedDeploymentPlan(
  planPath: string,
  blueprintPath: string,
  maxTxSize: number,
  headroomBytes: number,
): AppliedReferenceValidator[] {
  const plan = object(JSON.parse(readFileSync(planPath, 'utf8')), 'root');
  const blueprintSha256 = createHash('sha256').update(readFileSync(blueprintPath)).digest('hex');
  if (plan.schemaVersion !== 1 || plan.network !== 'Preview') {
    throw new Error('Invalid deployment plan schema or fixture network; regenerate with the production exporter');
  }
  if (plan.blueprintSha256 !== blueprintSha256) {
    throw new Error('Deployment plan is stale: blueprint hash differs; regenerate after the production build');
  }
  if (!Array.isArray(plan.modes)) throw new Error('Deployment plan modes are missing');
  const modes = new Set<string>();
  const references: AppliedReferenceValidator[] = [];
  for (const value of plan.modes) {
    const mode = object(value, 'mode');
    if (typeof mode.name !== 'string' || modes.has(mode.name)) {
      throw new Error('Deployment plan mode names must be unique strings');
    }
    modes.add(mode.name);
    if (!Array.isArray(mode.referenceValidators) || !mode.referenceValidators.length) {
      throw new Error(`Deployment plan ${mode.name} has no reference validators`);
    }
    const titles = new Set<string>();
    for (const value of mode.referenceValidators) {
      const entry = object(value, 'reference validator');
      const script = object(entry.script, 'applied script');
      if (typeof entry.title !== 'string' || !entry.title || titles.has(entry.title)) {
        throw new Error(`Deployment plan ${mode.name} validator titles must be nonempty and unique`);
      }
      titles.add(entry.title);
      if (
        !['bootstrap', 'runtime'].includes(String(entry.publication)) ||
        script.type !== 'PlutusV3' ||
        typeof script.script !== 'string' ||
        !/^(?:[a-fA-F0-9]{2})+$/.test(script.script) ||
        entry.appliedScriptBytes !== script.script.length / 2 ||
        !Number.isSafeInteger(entry.estimatedReferenceOutputBytes) ||
        Number(entry.estimatedReferenceOutputBytes) < Number(entry.appliedScriptBytes)
      ) {
        throw new Error(`Invalid applied deployment reference: ${mode.name}/${entry.title}`);
      }
      const reference = {
        title: entry.title,
        mode: mode.name,
        appliedScriptBytes: entry.appliedScriptBytes as number,
        estimatedReferenceOutputBytes: entry.estimatedReferenceOutputBytes as number,
      };
      // This mandatory deployment check is independent of the modeled runtime
      // budget ratchet. An allowlisted scenario cannot hide an undeployable script.
      if (reference.estimatedReferenceOutputBytes > maxTxSize - headroomBytes) {
        throw new Error(
          `Deployment reference ${mode.name}/${entry.title}: fully applied output ` +
            `${reference.estimatedReferenceOutputBytes} exceeds safe limit ${maxTxSize - headroomBytes}`,
        );
      }
      references.push(reference);
    }
  }
  for (const required of ['production', 'local-benchmark']) {
    if (!modes.has(required)) throw new Error(`Deployment plan is missing required mode: ${required}`);
  }
  return references;
}
