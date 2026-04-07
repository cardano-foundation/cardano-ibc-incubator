import {
  createTraceRegistryClient,
  type CardanoAssetDenomTrace,
} from '@cardano-ibc/trace-registry';
import {
  CARDANO_BRIDGE_MANIFEST_URL,
  KUPMIOS_URL,
} from '@/configs/runtime';

const traceRegistryClient = createTraceRegistryClient({
  bridgeManifestUrl: CARDANO_BRIDGE_MANIFEST_URL,
  kupmiosUrl: KUPMIOS_URL,
});

export async function lookupCardanoAssetDenomTraceFromRegistry(
  assetId: string,
): Promise<CardanoAssetDenomTrace> {
  return traceRegistryClient.lookupCardanoAssetDenomTrace(assetId);
}

export async function listCardanoIbcAssetsFromRegistry(): Promise<
  CardanoAssetDenomTrace[]
> {
  return traceRegistryClient.listCardanoIbcAssets();
}
