/** Add replay metadata to an existing artifact using retained canonical Yaci data.
 * Does not upgrade contracts or change the artifact's contract schema/version.
 */
import { Client } from 'pg';
import { readFileSync, writeFileSync } from 'fs';
import { upgradeHistoryArtifact } from '../config/history-upgrade';

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || input === output)
    throw new Error('Usage: upgrade-bridge-history <existing-artifact> <new-artifact>; use a separate output file');
  const artifact = JSON.parse(readFileSync(input, 'utf8'));
  const db = new Client({
    connectionString: process.env.HISTORY_DB_URL,
    host: process.env.HISTORY_DB_HOST || 'localhost',
    port: Number(process.env.HISTORY_DB_PORT || process.env.YACI_STORE_POSTGRES_PORT || 15432),
    database: process.env.HISTORY_DB_NAME || 'yaci_store',
    user: process.env.HISTORY_DB_USERNAME || 'yaci',
    password: process.env.HISTORY_DB_PASSWORD || 'dbpass',
    connectionTimeoutMillis: 30000,
    statement_timeout: 30000,
  });
  await db.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const upgraded = await upgradeHistoryArtifact(db, artifact, {
      network_magic: Number(process.env.CARDANO_CHAIN_NETWORK_MAGIC),
      chain_id: process.env.CARDANO_CHAIN_ID,
    });
    await db.query('COMMIT');
    writeFileSync(output, JSON.stringify(upgraded, null, 2) + '\n', { flag: 'wx' });
    console.log(`Wrote verified history metadata to ${output}; contract schema and scripts are unchanged`);
  } finally {
    await db.end();
  }
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
