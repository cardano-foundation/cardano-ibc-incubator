import { YaciRestClient } from '../shared/helpers/yaci-rest';
import { YaciRestHistory } from '../shared/helpers/yaci-rest-history';
import * as dotenv from 'dotenv';
dotenv.config();
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
  const seconds = Number(process.env.BRIDGE_HISTORY_SYNC_TIMEOUT_SECONDS || 7200);
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 86400)
    throw new Error('Invalid BRIDGE_HISTORY_SYNC_TIMEOUT_SECONDS');
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    try {
      await verifyHistoryCoverage(
        new YaciRestHistory(new YaciRestClient(process.env.YACI_STORE_ENDPOINT)),
        loadedBridgeConfig.bridgeManifest,
      );
      break;
    } catch (error) {
      if (error instanceof HistoryConfigurationError || Date.now() >= deadline) throw error;
      console.warn(`Waiting for Yaci REST deployment history before publishing manifest: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(10000, deadline - Date.now())));
    }
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(loadedBridgeConfig.bridgeManifest, null, 2)}\n`, 'utf8');

  console.log(`Wrote bridge manifest to ${outputPath}`);
}
void exportManifest().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
