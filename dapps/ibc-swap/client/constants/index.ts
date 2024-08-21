/* global BigInt */

export const THEME_MODE = {
  LIGHT: 'light',
  DARK: 'dark',
};

export const defaultChainName = 'sidechain';

export const FROM_TO = {
  FROM: 'From',
  TO: 'To',
};

export const routes = [
  {
    name: 'Swap',
    path: '/swap',
  },
  {
    name: 'Transfer',
    path: '/transfer',
  },
];

export const OSMOSIS_MAINNET_RPC_ENDPOINT = 'https://rpc.osmosis.zone'
export const OSMOSIS_MAINNET_REST_ENDPOINT = 'https://lcd.osmosis.zone'

export const CARDANO_MAINNET_MAGIC = '764824073';
export const DEFAULT_PFM_FEE = '0.100000000000000000';

export const HOUR_IN_NANOSEC = BigInt(60 * 60) * BigInt(1000000000);

export const queryAllDenomTracesUrl = '/ibc/apps/transfer/v1/denom_traces';
export const queryChannelsPrefixUrl = `/ibc/core/channel/v1/channels`;
export const queryPacketForwardParamsUrl = `/ibc/apps/packetforward/v1/params`;
export const queryAllChannelsUrl = `${queryChannelsPrefixUrl}?pagination.count_total=true&pagination.limit=10000`;

export const cosmosChainsSupported = ['localosmosis', 'sidechain'];
export const OSMOSIS_CHAIN_ID = 'localosmosis';
