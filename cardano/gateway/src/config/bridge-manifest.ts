export * from '@cardano-ibc/tx-builder-runtime/bridgeManifest';
import { normalizeBridgeManifestConfig, type LoadedBridgeConfig } from '@cardano-ibc/tx-builder-runtime/bridgeManifest';
import { checkedDeploymentMode } from '@cardano-ibc/tx-builder-runtime/migrationRuntime';

type JsonFileReader = {
  readFileSync(path: string, encoding: string): string;
};

export function loadBridgeConfigFromEnv(
  env: Record<string, string | undefined>,
  fs: JsonFileReader,
): LoadedBridgeConfig {
  const bridgeManifestPath = env.BRIDGE_MANIFEST_PATH;
  if (!bridgeManifestPath) throw new Error('BRIDGE_MANIFEST_PATH is required');

  const supportedOperationalProfile = (loaded: LoadedBridgeConfig): LoadedBridgeConfig => {
    const selected = env.IBC_DEPLOYMENT_MODE ?? loaded.deployment.deploymentMode ?? 'upgradeable';
    checkedDeploymentMode(selected, loaded.deployment.migration);
    if (loaded.deployment.deploymentMode && selected !== loaded.deployment.deploymentMode)
      throw new Error('Configured deployment mode conflicts with authenticated deployment artifacts');
    // Publish the validated startup selection, including older unlabelled inputs.
    // Downstream SDKs must receive the same explicit capability decision.
    loaded.deployment.deploymentMode = selected as 'upgradeable' | 'legacy';
    loaded.bridgeManifest.deploymentMode = loaded.deployment.deploymentMode;
    return loaded;
  };

  const manifestJson = JSON.parse(fs.readFileSync(bridgeManifestPath, 'utf8'));
  return supportedOperationalProfile(normalizeBridgeManifestConfig(manifestJson));
}
