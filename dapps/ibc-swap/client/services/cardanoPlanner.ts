import {
  createPlannerClient,
  type ResolvedCardanoAssetTrace,
} from '@cardano-ibc/planner';
import {
  CARDANO_IBC_CHAIN_ID,
  CROSSCHAIN_SWAP_ADDRESS,
  ENTRYPOINT_REST_ENDPOINT,
  LOCAL_OSMOSIS_REST_ENDPOINT,
} from '@/configs/runtime';
import { lookupCardanoAssetDenomTraceFromRegistry } from './cardanoTraceRegistry';

async function resolveCardanoAssetTrace(
  assetId: string,
): Promise<ResolvedCardanoAssetTrace | null> {
  try {
    const trace = await lookupCardanoAssetDenomTraceFromRegistry(assetId);
    if (trace.kind !== 'ibc_voucher') {
      return null;
    }

    return {
      path: trace.path,
      baseDenom: trace.baseDenom,
      fullDenom: trace.fullDenom,
    };
  } catch {
    return null;
  }
}

export const cardanoPlannerClient = createPlannerClient({
  cardanoChainId: CARDANO_IBC_CHAIN_ID,
  entrypointRestEndpoint: ENTRYPOINT_REST_ENDPOINT,
  localOsmosisRestEndpoint: LOCAL_OSMOSIS_REST_ENDPOINT,
  swapRouterAddress: CROSSCHAIN_SWAP_ADDRESS,
  resolveCardanoAssetDenomTrace: resolveCardanoAssetTrace,
});
