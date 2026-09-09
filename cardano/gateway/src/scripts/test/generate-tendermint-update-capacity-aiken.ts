import * as fs from 'node:fs';
import * as path from 'node:path';

import { analyzeNormalizedCapacityFixture, renderAikenFixtureModule } from '../ci/tendermint-update-capacity';

const OUTPUT_PATH = path.resolve(
  __dirname,
  '../../../../onchain/lib/ibc/client/ics-007-tendermint-client/test_fixtures/tendermint_update_capacity.ak',
);

async function main(): Promise<void> {
  const mode = process.argv[2] ?? '--check';
  if (mode !== '--check' && mode !== '--write') {
    throw new Error('Usage: generate-tendermint-update-capacity-aiken.ts [--check|--write]');
  }

  // This generator emits only header/trust constants; the executable Aiken
  // transaction fixture lives separately in spending_client_capacity.test.ak.
  // Check its current Gateway counterpart before updating the shared constants.
  // Capacity overflow remains diagnostic: these real 45-validator headers are
  // intentionally retained even when they exceed the transaction-size limit.
  const artifacts = await analyzeNormalizedCapacityFixture();
  for (const { report } of artifacts) {
    if (report.outputConsensusStates !== 1 || report.archivedConsensusStates !== 1 ||
      report.removedConsensusStates !== 0 || report.shape.inlineDatumOutputs !== 3 ||
      report.shape.referenceInputs !== 3 || report.shape.mintRedeemers !== 1 || report.shape.mintedAssets !== 1) {
      throw new Error(`Capacity fixture ${report.scenario} must use a singleton client and one authenticated archive`);
    }
  }
  const expected = await renderAikenFixtureModule();
  if (mode === '--write') {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, expected, 'utf8');
    console.log(`Wrote ${path.relative(process.cwd(), OUTPUT_PATH)}`);
    return;
  }

  if (!fs.existsSync(OUTPUT_PATH)) {
    throw new Error(`Missing generated Aiken fixture ${OUTPUT_PATH}; run with --write`);
  }
  const actual = fs.readFileSync(OUTPUT_PATH, 'utf8');
  if (actual !== expected) {
    throw new Error(`Generated Aiken fixture is stale: ${OUTPUT_PATH}; run with --write`);
  }
  console.log(`Validated ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
