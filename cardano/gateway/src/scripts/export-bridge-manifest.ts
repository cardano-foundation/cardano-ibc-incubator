import { Client } from 'pg';
import { HistoryConfigurationError, verifyHistoryCoverage } from '../config/history-coverage';
import * as fs from 'fs';
import * as path from 'path';
import { deriveCardanoNetwork, normalizeHandlerJsonDeploymentConfig } from '../config/bridge-manifest';

function usage(): never {
  throw new Error(
    'Usage: ts-node -r tsconfig-paths/register src/scripts/export-bridge-manifest.ts <handler-json-path> <output-path>',
  );
}

const [handlerJsonPath, outputPath] = process.argv.slice(2);

if (!handlerJsonPath || !outputPath) {
  usage();
}

const networkMagic = Number(process.env.CARDANO_CHAIN_NETWORK_MAGIC || 42);
const handlerJson = JSON.parse(fs.readFileSync(handlerJsonPath, 'utf8'));
// Export uses the same normalization path as Gateway startup so the generated
// manifest is exactly the public bootstrap document the service would expose.
const loadedBridgeConfig = normalizeHandlerJsonDeploymentConfig(handlerJson, {
  chain_id: process.env.CARDANO_CHAIN_ID || 'cardano-devnet',
  network_magic: networkMagic,
  network: process.env.CARDANO_NETWORK || deriveCardanoNetwork(networkMagic),
});

async function exportManifest() {
  if (!loadedBridgeConfig.bridgeManifest.history)
    throw new Error('Handler has no history bootstrap; upgrade it from retained chain data before exporting');
  const database = new Client({
    connectionString: process.env.HISTORY_DB_URL,
    host: process.env.HISTORY_DB_HOST || 'localhost',
    port: Number(process.env.HISTORY_DB_PORT || process.env.YACI_STORE_POSTGRES_PORT || 15432),
    database: process.env.HISTORY_DB_NAME || 'yaci_store',
    user: process.env.HISTORY_DB_USERNAME || 'yaci',
    password: process.env.HISTORY_DB_PASSWORD || 'dbpass',
    connectionTimeoutMillis: 30000,
    statement_timeout: 30000,
  });
  await database.connect();
  try {
    const timeout = Number(process.env.BRIDGE_HISTORY_SYNC_TIMEOUT_SECONDS || 7200);
    if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 86400)
      throw new Error('Invalid BRIDGE_HISTORY_SYNC_TIMEOUT_SECONDS');
    const deadline = Date.now() + timeout * 1000;
    for (;;) {
      await database.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        await verifyHistoryCoverage(
          { query: async (text, values) => (await database.query(text, values)).rows },
          loadedBridgeConfig.bridgeManifest,
        );
        await database.query('COMMIT');
        break;
      } catch (error) {
        await database.query('ROLLBACK');
        if (error instanceof HistoryConfigurationError || Date.now() >= deadline) throw error;
        console.warn(`Waiting to verify deployment history before publishing manifest: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, Math.min(10000, deadline - Date.now())));
      }
    }
  } finally {
    await database.end();
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(loadedBridgeConfig.bridgeManifest, null, 2)}\n`, 'utf8');

  console.log(`Wrote bridge manifest to ${outputPath}`);
}
void exportManifest().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
