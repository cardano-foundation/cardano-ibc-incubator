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

export const CARDANO_MAINNET_MAGIC = '764824073';

export const HOUR_IN_NANOSEC = BigInt(60 * 60) * BigInt(1000000000);

export const queryAllDenomTracesUrl = '/ibc/apps/transfer/v1/denom_traces';
export const queryChannelsPrefixUrl = `/ibc/core/channel/v1/channels`;
export const queryAllChannelsUrl = `${queryChannelsPrefixUrl}?pagination.count_total=true&pagination.limit=10000`;

export const cosmosChainsSupported = ['localosmosis', 'sidechain'];
export const cardanoChainsSupported = ['cardano'];
