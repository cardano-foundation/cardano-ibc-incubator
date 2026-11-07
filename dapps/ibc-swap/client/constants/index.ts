/* global BigInt */
import {
  activeRuntimeConfig,
  cosmosRuntimeChains,
} from '@/configs/runtimeConfig';
import { FORWARD_TIMEOUT as RUNTIME_FORWARD_TIMEOUT } from '@/configs/runtime';

export const THEME_MODE = {
  LIGHT: 'light',
  DARK: 'dark',
};

export const INJECTIVE_TESTNET_CHAIN_ID = 'injective-888';
export const defaultChainName = activeRuntimeConfig.defaultCosmosChainId;

export const FROM_TO = {
  FROM: 'From',
  TO: 'To',
};

export const routes: Array<{
  name: string;
  path: string;
  disabled?: boolean;
  badge?: string;
}> = [
  {
    name: 'Queries',
    path: '/queries',
    disabled: true,
    badge: 'Coming soon',
  },
  {
    name: 'Swap',
    path: '/swap',
    disabled: true,
    badge: 'Coming soon',
  },
  {
    name: 'Transfer',
    path: '/transfer',
  },
];

export const CARDANO_MAINNET_MAGIC = '764824073';
export const CARDANO_LOVELACE_HEX_STRING = '6c6f76656c616365';

export const DEFAULT_PFM_FEE = '0.100000000000000000';

// Source packet deadline; packet-forwarding memo timeouts are configured separately below.
export const PACKET_TIMEOUT_NANOSEC = BigInt(30 * 60) * BigInt(1000000000);

export const DEFAULT_FORWARD_TIMEOUT = '60m';

export const FORWARD_TIMEOUT =
  RUNTIME_FORWARD_TIMEOUT || DEFAULT_FORWARD_TIMEOUT;

// common Cosmos urls query
export const queryPacketForwardParamsUrl = `/ibc/apps/packetforward/v1/params`;
export const cosmosChainsSupported = cosmosRuntimeChains.map(
  (chain) => chain.id,
);
