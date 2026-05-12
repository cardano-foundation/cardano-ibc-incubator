import { AssetList } from '@chain-registry/types';
import {
  activeRuntimeConfig,
  cosmosRuntimeChains,
  selectableRuntimeChains,
  type RuntimeChainConfig,
} from '@/configs/runtimeConfig';

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

const toCustomChain = (chain: RuntimeChainConfig): CustomChain => ({
  chain_name: chain.id,
  chain_type: chain.kind === 'cosmos' ? 'cosmos' : 'unknown',
  status: chain.disabledReason ? 'inactive' : 'active',
  network_type: chain.networkType,
  pretty_name: chain.prettyName,
  chain_id: chain.id,
  ibc_chain_id: chain.ibcChainId,
  bech32_prefix: chain.bech32Prefix,
  slip44: chain.slip44,
  fees: chain.feeDenom
    ? {
        fee_tokens: [
          {
            denom: chain.feeDenom,
            fixed_min_gas_price: chain.fixedMinGasPrice ?? 0.0025,
            low_gas_price: chain.fixedMinGasPrice ?? 0.0025,
            average_gas_price: chain.fixedMinGasPrice ?? 0.0025,
            high_gas_price: chain.fixedMinGasPrice ?? 0.0025,
          },
        ],
      }
    : undefined,
  staking: chain.assets?.length
    ? {
        staking_tokens: chain.assets.map((asset) => ({
          denom: asset.base,
        })),
      }
    : undefined,
  apis:
    chain.rpcEndpoint || chain.restEndpoint
      ? {
          rpc: chain.rpcEndpoint
            ? [
                {
                  address: chain.rpcEndpoint,
                  provider: 'runtime-config',
                },
              ]
            : undefined,
          rest: chain.restEndpoint
            ? [
                {
                  address: chain.restEndpoint,
                  provider: 'runtime-config',
                },
              ]
            : undefined,
        }
      : undefined,
  key_algos: chain.keyAlgos,
  codebase:
    chain.kind === 'cosmos'
      ? {
          ics_enabled: ['ibc-go'],
        }
      : undefined,
  logo_URIs: {
    svg: chain.logoUri,
  },
  keywords: chain.kind === 'cosmos' ? ['ibc-go'] : undefined,
});

const toAssetList = (chain: RuntimeChainConfig): AssetList | null => {
  if (!chain.assets?.length) return null;

  return {
    chain_name: chain.id,
    assets: chain.assets.map((asset) => ({
      description: asset.description,
      denom_units: [
        {
          denom: asset.base,
          exponent: 0,
          aliases: [],
        },
        ...(asset.exponent > 0
          ? [
              {
                denom: asset.display,
                exponent: asset.exponent,
                aliases: [],
              },
            ]
          : []),
      ],
      base: asset.base,
      display: asset.display,
      name: asset.name,
      symbol: asset.symbol,
    })),
  };
};

export const customChains: CustomChain[] =
  cosmosRuntimeChains.map(toCustomChain);

export const customChainassets: AssetList[] = cosmosRuntimeChains
  .map(toAssetList)
  .filter((assetList): assetList is AssetList => assetList !== null);

export const allChains: CustomChain[] =
  activeRuntimeConfig.chains.map(toCustomChain);

export const selectableChains: CustomChain[] =
  selectableRuntimeChains.map(toCustomChain);

export const chainsRestEndpoints: { [key: string]: string } =
  cosmosRuntimeChains.reduce((acc: { [key: string]: string }, chain) => {
    if (chain.restEndpoint) {
      acc[chain.id] = chain.restEndpoint;
    }
    return acc;
  }, {});

export const cosmosEndpointOptions = {
  endpoints: cosmosRuntimeChains.reduce(
    (
      acc: Record<string, { isLazy: boolean; rpc?: string[]; rest?: string[] }>,
      chain,
    ) => {
      acc[chain.id] = {
        isLazy: true,
        rpc: chain.rpcEndpoint ? [chain.rpcEndpoint] : undefined,
        rest: chain.restEndpoint ? [chain.restEndpoint] : undefined,
      };
      return acc;
    },
    {},
  ),
};
