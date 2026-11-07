import { Chain, AssetList } from '@chain-registry/types';

import UnknownTokenIcon from '../assets/images/unknown-token.png';

export const CARDANO_MAINNET_MAGIC = '764824073';

const COSMOS_LOGO =
  'https://raw.githubusercontent.com/cosmos/chain-registry/master/cosmoshub/images/atom.svg';
const INJECTIVE_LOGO =
  'https://raw.githubusercontent.com/cosmos/chain-registry/master/injective/images/inj.svg';

const localCosmosChainConfig: Chain = {
  chain_name: 'v8-classic',
  chain_type: 'cosmos',
  status: 'active',
  network_type: 'testnet',
  pretty_name: 'Local Cosmos',
  chain_id: 'v8-classic-1',
  bech32_prefix: 'cosmos',
  slip44: 118,
  fees: { fee_tokens: [{ denom: 'stake', fixed_min_gas_price: 0.0025 }] },
  staking: { staking_tokens: [{ denom: 'stake' }] },
  apis: {
    rpc: [
      {
        address:
          process.env.REACT_APP_LOCAL_COSMOS_RPC_ENDPOINT ||
          'http://localhost:26757',
      },
    ],
    rest: [
      {
        address:
          process.env.REACT_APP_LOCAL_COSMOS_REST_ENDPOINT ||
          'http://localhost:1327',
      },
    ],
  },
  logo_URIs: { svg: COSMOS_LOGO },
};

const injectiveMainnetChain: Chain = {
  chain_name: 'injective',
  chain_type: 'cosmos',
  status: 'active',
  network_type: 'mainnet',
  pretty_name: 'Injective',
  chain_id: 'injective-1',
  bech32_prefix: 'inj',
  slip44: 60,
  logo_URIs: { svg: INJECTIVE_LOGO },
};

const injectiveTestnetChain: Chain = {
  ...injectiveMainnetChain,
  chain_id: 'injective-888',
  network_type: 'testnet',
  pretty_name: 'Injective Testnet',
};

export const customChains: Chain[] = [
  localCosmosChainConfig,
  injectiveTestnetChain,
  injectiveMainnetChain,
];

export const isCardanoMainnet =
  process.env.REACT_APP_CARDANO_CHAIN_ID === CARDANO_MAINNET_MAGIC;

const cardanoChain: Chain = {
  chain_name: 'cardano',
  chain_type: 'unknown',
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

export const allChains: any[] = [...customChains, cardanoChain];

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

type ChainAssetEntry = {
  base: string;
  logo_URIs?: {
    svg?: string;
  };
};

type ChainAssetListLike = {
  chain_name: string;
  assets: ChainAssetEntry[];
};

const localCosmosAssetList: AssetList = {
  chain_name: 'v8-classic',
  assets: ['stake', 'utest'].map((denom) => ({
    description: `Local Cosmos fixture token ${denom}`,
    denom_units: [{ denom, exponent: 0 }],
    base: denom,
    display: denom,
    name: denom,
    symbol: denom,
    logo_URIs: { svg: COSMOS_LOGO },
  })),
};

const injectiveAssetList: AssetList = {
  chain_name: 'injective',
  assets: [
    {
      description: 'Injective native token',
      denom_units: [
        { denom: 'inj', exponent: 0 },
        { denom: 'INJ', exponent: 18 },
      ],
      base: 'inj',
      display: 'INJ',
      name: 'Injective',
      symbol: 'INJ',
      logo_URIs: { svg: INJECTIVE_LOGO },
    },
  ],
};

const cardanoAssetList: AssetList = {
  chain_name: 'cardano',
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

const allAssetsAndChain: ChainAssetListLike[] = [
  injectiveAssetList,
  localCosmosAssetList,
  cardanoAssetList as ChainAssetListLike,
];

export const findTokenImg = (chainId: string, tokenNameStr: string): string => {
  let tokenName = tokenNameStr.split('/').reverse()?.[0] || tokenNameStr;
  if (tokenName === CARDANO_LOVELACE_HEX) {
    tokenName = 'lovelace';
  }
  const chainName = chainsMapping[chainId]?.chain_name;
  const chainAssets = allAssetsAndChain.find(
    (chain) => chain.chain_name === chainName,
  );
  if (!chainAssets) return UNKNOWN_TOKEN_IMG;
  const assetsData = chainAssets.assets;
  const asset = assetsData.find((a: ChainAssetEntry) => {
    return a.base.toLowerCase() === tokenName.toLowerCase();
  });
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
export const ChainListData = [...customChains, cardanoChain].map((chain) => {
  return {
    chainId: chain.chain_id || chain.chain_name,
    chainName: chain.pretty_name,
    chainLogo: chain?.logo_URIs?.svg || chain?.images?.[0]?.svg || '',
  };
});
