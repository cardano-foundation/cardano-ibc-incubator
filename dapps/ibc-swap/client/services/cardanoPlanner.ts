import {
  createPlannerClient,
  type ResolvedCardanoAssetTrace,
} from '@cardano-ibc/planner';
import axios from 'axios';
import {
  CARDANO_ENTRYPOINT_CHANNEL_ID,
  CARDANO_IBC_CHAIN_ID,
  CROSSCHAIN_SWAP_ADDRESS,
  ENTRYPOINT_INJECTIVE_CHANNEL_ID,
  ENTRYPOINT_REST_ENDPOINT,
  LOCAL_OSMOSIS_REST_ENDPOINT,
  GATEWAY_TX_BUILDER_ENDPOINT,
} from '@/configs/runtime';
import { ENTRYPOINT_CHAIN_ID, INJECTIVE_TESTNET_CHAIN_ID } from '@/constants';
import type { CardanoAssetDenomTrace } from '@/types/cardanoTrace';

async function resolveCardanoAssetTrace(
  assetId: string,
): Promise<ResolvedCardanoAssetTrace | null> {
  const response = await axios.get<CardanoAssetDenomTrace>(
    `/api/cardano/trace-registry/${encodeURIComponent(assetId)}`,
  );
  const trace = response.data;
  if (trace.kind !== 'ibc_voucher') {
    return null;
  }

  return {
    path: trace.path,
    baseDenom: trace.baseDenom,
    fullDenom: trace.fullDenom,
  };
}

export const cardanoPlannerClient = createPlannerClient({
  cardanoChainId: CARDANO_IBC_CHAIN_ID,
  cardanoRestEndpoint: GATEWAY_TX_BUILDER_ENDPOINT,
  entrypointRestEndpoint: ENTRYPOINT_REST_ENDPOINT,
  localOsmosisRestEndpoint: LOCAL_OSMOSIS_REST_ENDPOINT,
  swapRouterAddress: CROSSCHAIN_SWAP_ADDRESS,
  preferredChannels: [
    ...(CARDANO_ENTRYPOINT_CHANNEL_ID
      ? [
          {
            fromChainId: CARDANO_IBC_CHAIN_ID,
            toChainId: ENTRYPOINT_CHAIN_ID,
            srcPort: 'transfer',
            srcChannel: CARDANO_ENTRYPOINT_CHANNEL_ID,
          },
        ]
      : []),
    ...(ENTRYPOINT_INJECTIVE_CHANNEL_ID
      ? [
          {
            fromChainId: ENTRYPOINT_CHAIN_ID,
            toChainId: INJECTIVE_TESTNET_CHAIN_ID,
            srcPort: 'transfer',
            srcChannel: ENTRYPOINT_INJECTIVE_CHANNEL_ID,
          },
        ]
      : []),
  ],
  resolveCardanoAssetDenomTrace: resolveCardanoAssetTrace,
});
