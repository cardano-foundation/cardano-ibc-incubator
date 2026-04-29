/* global BigInt */

import {
  activeRuntimeConfig,
  ENTRYPOINT_CHAIN_ID as RUNTIME_ENTRYPOINT_CHAIN_ID,
} from '@/configs/runtimeConfig';

export const THEME_MODE = {
  LIGHT: 'light',
  DARK: 'dark',
};

export const ENTRYPOINT_CHAIN_ID = RUNTIME_ENTRYPOINT_CHAIN_ID;
export const defaultChainName = activeRuntimeConfig.defaultCosmosChainId;

export const FROM_TO = {
  FROM: 'From',
  TO: 'To',
};

export const routes = [
  {
    name: 'Queries',
    path: '/queries',
  },
  {
    name: 'Swap',
    path: '/swap',
  },
  {
    name: 'Transfer',
    path: '/transfer',
  },
];

export const CARDANO_MAINNET_MAGIC = '764824073';
export const CARDANO_LOVELACE_HEX_STRING = '6c6f76656c616365';

export const DEFAULT_PFM_FEE = '0.100000000000000000';

export const HOUR_IN_NANOSEC = BigInt(60 * 60) * BigInt(1000000000);

export const DEFAULT_FORWARD_TIMEOUT = '60m';

export const FORWARD_TIMEOUT =
  process.env.NEXT_PUBLIC_FORWARD_TIMEOUT || DEFAULT_FORWARD_TIMEOUT;

// common Cosmos urls query
export const queryAllDenomTracesUrl = '/ibc/apps/transfer/v1/denoms';
export const queryChannelsPrefixUrl = `/ibc/core/channel/v1/channels`;
export const queryPacketForwardParamsUrl = `/ibc/apps/packetforward/v1/params`;
export const queryAllChannelsUrl = `${queryChannelsPrefixUrl}?pagination.count_total=true&pagination.limit=10000`;
export const cosmosChainsSupported = activeRuntimeConfig.chains
  .filter((chain) => chain.kind === 'cosmos')
  .map((chain) => chain.id);
export const OSMOSIS_CHAIN_ID =
  activeRuntimeConfig.features.localSwap.toChainId;
