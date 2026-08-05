import {
  createPlannerClient,
  type ResolvedCardanoAssetTrace,
} from '@cardano-ibc/planner';
import {
  CARDANO_IBC_CHAIN_ID,
  CROSSCHAIN_SWAP_ADDRESS,
  GATEWAY_TX_BUILDER_ENDPOINT,
  dappApiPath,
} from '@/configs/runtime';
import { activeRuntimeConfig } from '@/configs/runtimeConfig';

async function resolveCardanoAssetTrace(
  assetId: string,
): Promise<ResolvedCardanoAssetTrace | null> {
  try {
    const response = await fetch(
      dappApiPath(`/api/cardano/trace-registry/${encodeURIComponent(assetId)}`),
    );
    if (!response.ok) return null;
    const trace = (await response.json()) as {
      kind?: string;
      path?: string;
      baseDenom?: string;
      fullDenom?: string;
    };
    if (trace.kind !== 'ibc_voucher') {
      return null;
    }

    if (!trace.path || !trace.baseDenom || !trace.fullDenom) return null;

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
  cardanoRestEndpoint: GATEWAY_TX_BUILDER_ENDPOINT,
  counterpartyChainId: activeRuntimeConfig.defaultCosmosChainId,
  localOsmosisRestEndpoint: activeRuntimeConfig.plannerCounterpartyRestEndpoint,
  swapRouterAddress: CROSSCHAIN_SWAP_ADDRESS,
  resolveCardanoAssetDenomTrace: resolveCardanoAssetTrace,
});
