import { YaciRestClient } from '../shared/helpers/yaci-rest';
import { YaciRestHistory } from '../shared/helpers/yaci-rest-history';
import * as dotenv from 'dotenv';
dotenv.config();
import { HistoryConfigurationError, verifyHistoryCoverage } from '../config/history-coverage';
import * as fs from 'fs';
import * as path from 'path';
import { normalizeBridgeManifestConfig } from '../config/bridge-manifest';

function usage(): never {
  throw new Error(
    'Usage: ts-node -r tsconfig-paths/register src/scripts/publish-bridge-manifest.ts <manifest-json-path> <output-path>',
  );
}

const [manifestPath, outputPath] = process.argv.slice(2);

if (!manifestPath || !outputPath) {
  usage();
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const loadedBridgeConfig = normalizeBridgeManifestConfig(manifest);

async function publishManifest() {
  if (!loadedBridgeConfig.bridgeManifest.history) throw new Error('Manifest has no history bootstrap');
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
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`Wrote bridge manifest to ${outputPath}`);
}
void publishManifest().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
