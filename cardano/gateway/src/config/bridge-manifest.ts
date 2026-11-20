export * from '@cardano-ibc/tx-builder-runtime/bridgeManifest';
import { normalizeBridgeManifestConfig, type LoadedBridgeConfig } from '@cardano-ibc/tx-builder-runtime/bridgeManifest';

type JsonFileReader = {
  readFileSync(path: string, encoding: string): string;
};

export function loadBridgeConfigFromEnv(
  env: Record<string, string | undefined>,
  fs: JsonFileReader,
): LoadedBridgeConfig {
  const bridgeManifestPath = env.BRIDGE_MANIFEST_PATH;
  if (!bridgeManifestPath) throw new Error('BRIDGE_MANIFEST_PATH is required');

  if (env.IBC_DEPLOYMENT_MODE) throw new Error('IBC_DEPLOYMENT_MODE was removed. Gateway requires a current governed deployment manifest');

  const manifestJson = JSON.parse(fs.readFileSync(bridgeManifestPath, 'utf8'));
  return normalizeBridgeManifestConfig(manifestJson);
}
