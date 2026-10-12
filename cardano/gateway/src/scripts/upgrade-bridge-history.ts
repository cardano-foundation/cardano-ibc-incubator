/** Add replay metadata to an existing artifact using retained canonical Yaci data.
 * Does not upgrade contracts or change the artifact's contract schema/version.
 */
import { YaciRestClient } from '../shared/helpers/yaci-rest';
import { YaciRestHistory } from '../shared/helpers/yaci-rest-history';
import * as dotenv from 'dotenv';
dotenv.config();
import { readFileSync, writeFileSync } from 'fs';
import { upgradeHistoryArtifact } from '../config/history-upgrade';

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || input === output)
    throw new Error('Usage: upgrade-bridge-history <existing-artifact> <new-artifact>; use a separate output file');
  const artifact = JSON.parse(readFileSync(input, 'utf8'));
  const upgraded = await upgradeHistoryArtifact(
    new YaciRestHistory(new YaciRestClient(process.env.YACI_STORE_ENDPOINT)),
    artifact,
    {
      network_magic: Number(process.env.CARDANO_CHAIN_NETWORK_MAGIC),
      chain_id: process.env.CARDANO_CHAIN_ID,
    },
  );
  writeFileSync(output, JSON.stringify(upgraded, null, 2) + '\n', { flag: 'wx' });
  console.log(`Wrote verified history metadata to ${output}`);
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
