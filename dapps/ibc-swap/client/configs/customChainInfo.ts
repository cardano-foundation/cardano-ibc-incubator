import { CARDANO_MAINNET_MAGIC } from '@/constants';
import {
  CARDANO_CHAIN_ID,
  CARDANO_IBC_CHAIN_ID,
  ENTRYPOINT_REST_ENDPOINT,
  ENTRYPOINT_RPC_ENDPOINT,
  LOCAL_OSMOSIS_REST_ENDPOINT,
  LOCAL_OSMOSIS_RPC_ENDPOINT,
} from '@/configs/runtime';
import { AssetList } from '@chain-registry/types';
import DefaultCardanoNetworkIcon from '@/assets/icons/cardano.svg';

type CustomChain = {
  chain_name: string;
  chain_type: 'cosmos' | 'unknown';
  status: string;
  network_type: string;
  pretty_name: string;
  chain_id: string;
  ibc_chain_id?: string;
  bech32_prefix: string;
  slip44: number;
  fees?: {
    fee_tokens: Array<{
      denom: string;
      fixed_min_gas_price?: number;
      low_gas_price?: number;
      average_gas_price?: number;
      high_gas_price?: number;
    }>;
  };
  staking?: {
    staking_tokens: Array<{
      denom: string;
    }>;
  };
  apis?: {
    rpc?: Array<{
      address: string;
      provider?: string;
    }>;
    rest?: Array<{
      address: string;
      provider?: string;
    }>;
  };
  key_algos?: string[];
  codebase?: {
    ics_enabled?: string[];
  };
  logo_URIs?: {
    png?: string;
    svg?: string;
    jpeg?: string;
  };
  keywords?: string[];
};

const ENTRYPOINT_CHAIN_ID = 'entrypoint';

const entrypointChainConfig: CustomChain = {
  chain_name: ENTRYPOINT_CHAIN_ID,
  chain_type: 'cosmos',
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
        address: ENTRYPOINT_RPC_ENDPOINT,
        provider: 'local',
      },
    ],
    rest: [
      {
        address: ENTRYPOINT_REST_ENDPOINT,
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

const localOsmosisChainConfig: CustomChain = {
  chain_name: 'localosmosis',
  chain_type: 'cosmos',
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
        address: LOCAL_OSMOSIS_RPC_ENDPOINT,
      },
    ],
    rest: [
      {
        address: LOCAL_OSMOSIS_REST_ENDPOINT,
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

export const customChains: CustomChain[] = [
  entrypointChainConfig,
  localOsmosisChainConfig,
];

const isCardanoMainnet = CARDANO_CHAIN_ID === CARDANO_MAINNET_MAGIC;

const cardanoChain: CustomChain = {
  chain_name: 'cardano',
  chain_type: 'unknown',
  status: 'active',
  network_type: isCardanoMainnet ? 'mainnet' : 'devnet',
  pretty_name: 'Cardano',
  chain_id: CARDANO_CHAIN_ID,
  ibc_chain_id: CARDANO_IBC_CHAIN_ID,
  bech32_prefix: isCardanoMainnet ? 'addr' : 'addr_test',
  slip44: 1815,
  logo_URIs: {
    svg: DefaultCardanoNetworkIcon.src,
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
