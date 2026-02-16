import { Chain, AssetList } from '@chain-registry/types';
import { chains, assets } from 'chain-registry/mainnet';

import UnknownTokenIcon from '@src/assets/images/unknown-token.png';

export const CARDANO_MAINNET_MAGIC = '764824073';

const ENTRYPOINT_CHAIN_ID = 'entrypoint';

const getEntrypointRpcEndpoint = () =>
  process.env.REACT_APP_ENTRYPOINT_RPC_ENDPOINT || '';

const getEntrypointRestEndpoint = () =>
  process.env.REACT_APP_ENTRYPOINT_REST_ENDPOINT || '';
const entrypointChainConfig: Chain = {
  chain_name: 'sidechain',
  status: 'active',
  network_type: 'testnet',
  pretty_name: 'Entrypoint chain Localnet',
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
        address: process.env.REACT_APP_SIDECHAIN_RPC_ENDPOINT || '',
        provider: 'local',
      },
    ],
    rest: [
      {
        address: process.env.REACT_APP_SIDECHAIN_REST_ENDPOINT || '',
        provider: 'local',
      },
    ],
  },
  key_algos: ['secp256k1'],
  codebase: {
    ics_enabled: ['ibc-go'],
  },
  logo_URIs: {
    svg: 'https://cosmos.network/presskit/cosmos-brandmark-dynamic-dark.svg',
  },
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
        address: process.env.REACT_APP_LOCALOSMOIS_RPC_ENDPOINT || '',
      },
    ],
    rest: [
      {
        address: process.env.REACT_APP_LOCALOSMOIS_REST_ENDPOINT || '',
      },
    ],
  },
  logo_URIs: {
    svg: 'https://app.osmosis.zone/tokens/generated/osmo.svg',
  },
  keywords: ['ibc-go'], // Assuming features map to keywords
};

export const customChains: Chain[] = [
  entrypointChainConfig,
  localOsmosisChainConfig,
];

export const isCardanoMainnet =
  process.env.REACT_APP_CARDANO_CHAIN_ID === CARDANO_MAINNET_MAGIC;

const cardanoChain: Chain = {
  chain_name: 'cardano',
  status: 'active',
  network_type: isCardanoMainnet ? 'mainnet' : 'devnet',
  pretty_name: 'Cardano',
  chain_id: process.env.REACT_APP_CARDANO_CHAIN_ID || CARDANO_MAINNET_MAGIC,
  bech32_prefix: isCardanoMainnet ? 'addr' : 'addr_test',
  slip44: 1815,
  logo_URIs: {
    svg: 'https://cdn4.iconfinder.com/data/icons/crypto-currency-and-coin-2/256/cardano_ada-512.png',
  },
  fees: {
    fee_tokens: [
      {
        denom: 'lovelace',
        fixed_min_gas_price: 0.0,
        low_gas_price: 0.0,
        average_gas_price: 0.0,
        high_gas_price: 0.0,
      },
    ],
  },
};

export const allChains: any[] = [...customChains, cardanoChain, ...chains];

export const chainsMapping: { [key: string]: any } = allChains.reduce(
  (acc: { [key: string]: any }, chain) => {
    const { chain_id: chainId } = chain;
    acc[chainId] = chain;
    return acc;
  },
  {},
);

export const CARDANO_LOVELACE_HEX = '6c6f76656c616365';

export const UNKNOWN_TOKEN_IMG = UnknownTokenIcon;

const entrypointChainAssetList: AssetList = {
  chain_name: 'sidechain',
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
      logo_URIs: {
        png: 'https://raw.githubusercontent.com/cosmos/chain-registry/master/osmosis/images/osmo.png',
        svg: 'https://raw.githubusercontent.com/cosmos/chain-registry/master/osmosis/images/osmo.svg',
      },
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
      logo_URIs: {
        png: 'https://raw.githubusercontent.com/cosmos/chain-registry/master/osmosis/images/osmo.png',
        svg: 'https://raw.githubusercontent.com/cosmos/chain-registry/master/osmosis/images/osmo.svg',
      },
    },
  ],
};

const cardanoAssetList: AssetList = {
  chain_name: process.env.REACT_APP_CARDANO_CHAIN_ID!,
  assets: [
    {
      description: 'Lovelace',
      denom_units: [
        {
          denom: 'lovelace',
          exponent: 0,
          aliases: [],
        },
      ],
      base: 'lovelace',
      display: 'lovelace',
      name: 'lovelace',
      symbol: 'lovelace',
      logo_URIs: {
        svg: 'https://cdn4.iconfinder.com/data/icons/crypto-currency-and-coin-2/256/cardano_ada-512.png',
      },
    },
  ],
};

const allAssetsAndChain = [
  ...assets,
  entrypointChainAssetList,
  localOsmosisAssetList,
  cardanoAssetList,
];

export const findTokenImg = (chainId: string, tokenNameStr: string): string => {
  let tokenName = tokenNameStr.split('/').reverse()?.[0] || tokenNameStr;
  if (tokenName === CARDANO_LOVELACE_HEX) {
    tokenName = 'lovelace';
  }
  const chainName = chainId.split('-')[0];
  const chainAssets = allAssetsAndChain.find(
    (chain) => chain.chain_name === chainName,
  );
  if (!chainAssets) return UNKNOWN_TOKEN_IMG;
  const assetsData = chainAssets.assets;
  const asset = assetsData.find(
    (a) => a.base.toLowerCase() === tokenName.toLowerCase(),
  );
  if (!asset || !asset?.logo_URIs?.svg) return UNKNOWN_TOKEN_IMG;
  return asset?.logo_URIs?.svg;
};

export const chainsRestEndpoints: { [key: string]: string } = allChains.reduce(
  (acc: { [key: string]: string }, chain) => {
    const { apis, chain_id: chainId } = chain;
    if (!chainId || (apis?.rest || []).length === 0) return acc;
    const [restEndpoint] = apis?.rest!;
    acc[chainId] = restEndpoint.address!;
    return acc;
  },
  {},
);
// {
//   chainId: '1',
//   chainName: 'AXL',
//   chainLogo:
//     'https://cdn4.iconfinder.com/data/icons/crypto-currency-and-coin-2/256/cardano_ada-512.png',
// },
export const ChainListData = [...customChains, cardanoChain].map((chain) => {
  return {
    chainId: chain.chain_id || chain.chain_name,
    chainName: chain.pretty_name,
    chainLogo: chain?.logo_URIs?.svg || chain?.images?.[0]?.svg || '',
  };
});
