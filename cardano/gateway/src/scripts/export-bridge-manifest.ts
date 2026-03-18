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

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(loadedBridgeConfig.bridgeManifest, null, 2)}\n`, 'utf8');

console.log(`Wrote bridge manifest to ${outputPath}`);
