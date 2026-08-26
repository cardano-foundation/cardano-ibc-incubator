import * as fs from 'node:fs';
import * as path from 'node:path';

import { renderAikenFixtureModule } from '../ci/tendermint-update-capacity';

const OUTPUT_PATH = path.resolve(
  __dirname,
  '../../../../onchain/lib/ibc/client/ics-007-tendermint-client/test_fixtures/tendermint_update_capacity.ak',
);

async function main(): Promise<void> {
  const mode = process.argv[2] ?? '--check';
  if (mode !== '--check' && mode !== '--write') {
    throw new Error('Usage: generate-tendermint-update-capacity-aiken.ts [--check|--write]');
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
