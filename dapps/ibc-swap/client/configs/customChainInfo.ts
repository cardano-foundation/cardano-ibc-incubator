import { AssetList, Chain } from '@chain-registry/types';

const sideChainConfig: Chain = {
  chain_name: 'sidechain-localnet',
  status: 'active',
  network_type: 'testnet',
  pretty_name: 'Sidechain Localnet',
  chain_id: 'sidechain',
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
        address: process.env.NEXT_PUBLIC_SIDECHAIN_RPC_ENDPOINT || '',
        provider: 'local',
      },
    ],
    rest: [
      {
        address: process.env.NEXT_PUBLIC_SIDECHAIN_REST_ENDPOINT || '',
        provider: 'local',
      },
    ],
  },
  key_algos: ['secp256k1'],
  codebase: {
    ics_enabled: ['ibc-go'],
  },
};

const sideChainAssetList: AssetList = {
  chain_name: 'sidechain-localnet',
  assets: [
    {
      description: 'Registered denom token for sidechain testing',
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
      description: 'Registered denom token for sidechain testing',
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

export const customChains: Chain[] = [sideChainConfig, localOsmosisChainConfig];

export const customChainassets: AssetList[] = [
  sideChainAssetList,
  localOsmosisAssetList,
];
