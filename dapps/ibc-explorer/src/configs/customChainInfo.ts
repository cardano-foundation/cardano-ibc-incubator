import { Chain } from '@chain-registry/types';
import { chains } from 'chain-registry';

const CARDANO_MAINNET_MAGIC = '764824073';

const sideChainConfig: Chain = {
  chain_name: 'sidechain',
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

export const customChains: Chain[] = [sideChainConfig, localOsmosisChainConfig];

const isCardanoMainnet =
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
    svg: 'https://beta.explorer.cardano.org/assets/ada-price-dark-D1XAVnue.svg',
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

export const allChains: any[] = [...customChains, ...chains, cardanoChain];

export const chainsMapping: { [key: string]: any } = allChains.reduce(
  (acc: { [key: string]: any }, chain) => {
    const { chain_id: chainId } = chain;
    acc[chainId] = chain;
    return acc;
  },
  {},
);
