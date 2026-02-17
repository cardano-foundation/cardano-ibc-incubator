import { CARDANO_MAINNET_MAGIC } from '@/constants';
import { AssetList, Chain } from '@chain-registry/types';

const ENTRYPOINT_CHAIN_ID = 'entrypoint';

const getEntrypointRpcEndpoint = () =>
  process.env.NEXT_PUBLIC_ENTRYPOINT_RPC_ENDPOINT || '';

const getEntrypointRestEndpoint = () =>
  process.env.NEXT_PUBLIC_ENTRYPOINT_REST_ENDPOINT || '';
const entrypointChainConfig: Chain = {
  chain_name: ENTRYPOINT_CHAIN_ID,
  status: 'active',
  network_type: 'testnet',
  pretty_name: 'Entrypoint chain Localnet',
  chain_id: ENTRYPOINT_CHAIN_ID,
  bech32_prefix: 'cosmos',
  slip44: 118,
  fees: {
    fee_tokens: [
      {
        denom: 'stake',
        fixed_min_gas_price: 0.0,
        low_gas_price: 0.0,
        average_gas_price: 0.0,
        high_gas_price: 0.0,
      },
    ],
  },
  staking: {
    staking_tokens: [
      {
        denom: 'token',
      },
      {
        denom: 'stake',
      },
    ],
  },
  apis: {
    rpc: [
      {
        address: getEntrypointRpcEndpoint(),
        provider: 'local',
      },
    ],
    rest: [
      {
        address: getEntrypointRestEndpoint(),
        provider: 'local',
      },
    ],
  },
  key_algos: ['secp256k1'],
  codebase: {
    ics_enabled: ['ibc-go'],
  },
};

const entrypointChainAssetList: AssetList = {
  chain_name: ENTRYPOINT_CHAIN_ID,
  assets: [
    {
      description: 'Registered denom token for entrypoint chain testing',
      denom_units: [
        {
          denom: 'token',
          exponent: 0,
          aliases: [],
        },
      ],
      base: 'token',
      display: 'token',
      name: 'token',
      symbol: 'token',
    },
    {
      description: 'Registered denom token for entrypoint chain testing',
      denom_units: [
        {
          denom: 'stake',
          exponent: 0,
          aliases: [],
        },
      ],
      base: 'stake',
      display: 'stake',
      name: 'stake',
      symbol: 'stake',
    },
  ],
};

const localOsmosisChainConfig: Chain = {
  chain_name: 'localosmosis',
  status: 'active',
  network_type: 'testnet',
  pretty_name: 'Local Osmosis',
  chain_id: 'localosmosis',
  bech32_prefix: 'osmo',
  slip44: 118,
  fees: {
    fee_tokens: [
      {
        denom: 'uosmo',
        fixed_min_gas_price: 0.0025,
        low_gas_price: 0.0025,
        average_gas_price: 0.025,
        high_gas_price: 0.04,
      },
    ],
  },
  staking: {
    staking_tokens: [
      {
        denom: 'uosmo',
      },
      {
        denom: 'osmo',
      },
    ],
  },
  apis: {
    rpc: [
      {
        address: process.env.NEXT_PUBLIC_LOCALOSMOIS_RPC_ENDPOINT || '',
      },
    ],
    rest: [
      {
        address: process.env.NEXT_PUBLIC_LOCALOSMOIS_REST_ENDPOINT || '',
      },
    ],
  },
  logo_URIs: {
    svg: 'https://app.osmosis.zone/tokens/generated/osmo.svg',
  },
  keywords: ['ibc-go'], // Assuming features map to keywords
};

const localOsmosisAssetList: AssetList = {
  chain_name: 'localosmosis',
  assets: [
    {
      description: 'Registered denom uosmo for localosmosis testing',
      denom_units: [
        {
          denom: 'uosmo',
          exponent: 0,
          aliases: [],
        },
      ],
      base: 'uosmo',
      display: 'uosmo',
      name: 'uosmo',
      symbol: 'uosmo',
    },
    {
      description: 'Registered denom uosmo for localosmosis testing',
      denom_units: [
        {
          denom: 'osmo',
          exponent: 6,
          aliases: [],
        },
      ],
      base: 'osmo',
      display: 'osmo',
      name: 'osmo',
      symbol: 'osmo',
    },
  ],
};

export const customChains: Chain[] = [
  entrypointChainConfig,
  localOsmosisChainConfig,
];

const isCardanoMainnet =
  process.env.NEXT_PUBLIC_CARDANO_CHAIN_ID === CARDANO_MAINNET_MAGIC;

const cardanoChain: Chain = {
  chain_name: 'cardano',
  status: 'active',
  network_type: isCardanoMainnet ? 'mainnet' : 'devnet',
  pretty_name: 'Cardano',
  chain_id: process.env.NEXT_PUBLIC_CARDANO_CHAIN_ID || CARDANO_MAINNET_MAGIC,
  bech32_prefix: isCardanoMainnet ? 'addr' : 'addr_test',
  slip44: 1815,
  logo_URIs: {
    svg: 'https://beta.explorer.cardano.org/assets/ada-price-dark-D1XAVnue.svg',
  },
};

export const chainsRestEndpoints: { [key: string]: string } =
  customChains.reduce((acc: { [key: string]: string }, chain) => {
    const { apis, chain_id: chainId } = chain;
    const [restEndpoint] = apis?.rest!;
    acc[chainId] = restEndpoint.address!;
    return acc;
  }, {});

export const allChains: any[] = [...customChains, cardanoChain];
export const customChainassets: AssetList[] = [
  entrypointChainAssetList,
  localOsmosisAssetList,
];
