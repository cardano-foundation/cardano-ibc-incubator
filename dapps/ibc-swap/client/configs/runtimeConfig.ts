import DefaultCardanoNetworkIcon from '@/assets/icons/cardano.svg';
import DefaultCosmosNetworkIcon from '@/assets/icons/cosmos-icon.svg';
import {
  CARDANO_CHAIN_ID,
  CARDANO_IBC_CHAIN_ID,
  CARDANO_BRIDGE_MANIFEST_URL,
  ENTRYPOINT_REST_ENDPOINT,
  ENTRYPOINT_RPC_ENDPOINT,
  IBC_SWAP_MODE,
  INJECTIVE_REST_ENDPOINT,
  INJECTIVE_RPC_ENDPOINT,
  LOCAL_OSMOSIS_REST_ENDPOINT,
  LOCAL_OSMOSIS_RPC_ENDPOINT,
  type IbcSwapMode,
} from '@/configs/runtime';

export type RuntimeChainKind = 'cardano' | 'cosmos';
export type RuntimeChainRole = 'user' | 'route-infra';

export type RuntimeAssetConfig = {
  base: string;
  display: string;
  name: string;
  symbol: string;
  exponent: number;
  description: string;
};

export type RuntimeChainConfig = {
  id: string;
  ibcChainId: string;
  chainName: string;
  prettyName: string;
  kind: RuntimeChainKind;
  role: RuntimeChainRole;
  networkType: 'local' | 'testnet' | 'mainnet' | 'controlled' | 'devnet';
  bech32Prefix: string;
  slip44: number;
  logoUri: string;
  visibleInSelector: boolean;
  rpcEndpoint?: string;
  restEndpoint?: string;
  feeDenom?: string;
  fixedMinGasPrice?: number;
  keyAlgos?: string[];
  assets?: RuntimeAssetConfig[];
  disabledReason?: string;
};

export type RuntimeRouteConfig = {
  id: string;
  fromChainId: string;
  toChainId: string;
  viaChainIds: string[];
  label: string;
  enabled: boolean;
  disabledReason?: string;
};

export type RuntimeConfig = {
  mode: IbcSwapMode;
  label: string;
  description: string;
  enabled: boolean;
  disabledReason?: string;
  entrypointChainId: string;
  defaultCosmosChainId: string;
  cardanoChainId: string;
  cardanoIbcChainId: string;
  cardanoBridgeManifestUrl: string;
  plannerCounterpartyRestEndpoint: string;
  pfmFeeChainIds: string[];
  chains: RuntimeChainConfig[];
  routes: RuntimeRouteConfig[];
  features: {
    localSwap: {
      enabled: boolean;
      toChainId: string;
    };
  };
};

export const ENTRYPOINT_CHAIN_ID = 'entrypoint';
export const LOCAL_OSMOSIS_CHAIN_ID = 'localosmosis';
export const INJECTIVE_TESTNET_CHAIN_ID = 'injective-888';
export const INJECTIVE_MAINNET_CHAIN_ID = 'injective-1';

const entrypointChain: RuntimeChainConfig = {
  id: ENTRYPOINT_CHAIN_ID,
  ibcChainId: ENTRYPOINT_CHAIN_ID,
  chainName: ENTRYPOINT_CHAIN_ID,
  kind: 'cosmos',
  role: 'route-infra',
  networkType: 'controlled',
  prettyName: 'Entrypoint',
  bech32Prefix: 'cosmos',
  slip44: 118,
  logoUri: DefaultCosmosNetworkIcon.src,
  visibleInSelector: false,
  rpcEndpoint: ENTRYPOINT_RPC_ENDPOINT,
  restEndpoint: ENTRYPOINT_REST_ENDPOINT,
  feeDenom: 'stake',
  fixedMinGasPrice: 0,
  keyAlgos: ['secp256k1'],
  assets: [
    {
      description: 'Registered denom token for entrypoint chain testing',
      base: 'token',
      display: 'token',
      name: 'token',
      symbol: 'token',
      exponent: 0,
    },
    {
      description: 'Registered denom stake for entrypoint chain testing',
      base: 'stake',
      display: 'stake',
      name: 'stake',
      symbol: 'stake',
      exponent: 0,
    },
  ],
};

function cardanoPrettyName(): string {
  if (IBC_SWAP_MODE === 'testnet') return 'Cardano Preprod';
  if (IBC_SWAP_MODE === 'mainnet') return 'Cardano Mainnet';
  return 'Cardano Local';
}

const cardanoChain = (
  networkType: RuntimeChainConfig['networkType'],
): RuntimeChainConfig => ({
  id: CARDANO_CHAIN_ID,
  ibcChainId: CARDANO_IBC_CHAIN_ID,
  chainName: 'cardano',
  kind: 'cardano',
  role: 'user',
  networkType,
  prettyName: cardanoPrettyName(),
  bech32Prefix: IBC_SWAP_MODE === 'mainnet' ? 'addr' : 'addr_test',
  slip44: 1815,
  logoUri: DefaultCardanoNetworkIcon.src,
  visibleInSelector: true,
});

const localOsmosisChain: RuntimeChainConfig = {
  id: LOCAL_OSMOSIS_CHAIN_ID,
  ibcChainId: LOCAL_OSMOSIS_CHAIN_ID,
  chainName: LOCAL_OSMOSIS_CHAIN_ID,
  kind: 'cosmos',
  role: 'user',
  networkType: 'local',
  prettyName: 'Local Osmosis',
  bech32Prefix: 'osmo',
  slip44: 118,
  logoUri: 'https://app.osmosis.zone/tokens/generated/osmo.svg',
  visibleInSelector: true,
  rpcEndpoint: LOCAL_OSMOSIS_RPC_ENDPOINT,
  restEndpoint: LOCAL_OSMOSIS_REST_ENDPOINT,
  feeDenom: 'uosmo',
  fixedMinGasPrice: 0.0025,
  keyAlgos: ['secp256k1'],
  assets: [
    {
      description: 'Registered denom uosmo for localosmosis testing',
      base: 'uosmo',
      display: 'uosmo',
      name: 'uosmo',
      symbol: 'uosmo',
      exponent: 0,
    },
    {
      description: 'Registered denom osmo for localosmosis testing',
      base: 'osmo',
      display: 'osmo',
      name: 'osmo',
      symbol: 'osmo',
      exponent: 6,
    },
  ],
};

const injectiveTestnetChain: RuntimeChainConfig = {
  id: INJECTIVE_TESTNET_CHAIN_ID,
  ibcChainId: INJECTIVE_TESTNET_CHAIN_ID,
  chainName: 'injective',
  kind: 'cosmos',
  role: 'user',
  networkType: 'testnet',
  prettyName: 'Injective Testnet',
  bech32Prefix: 'inj',
  slip44: 60,
  logoUri: DefaultCosmosNetworkIcon.src,
  visibleInSelector: true,
  rpcEndpoint: INJECTIVE_RPC_ENDPOINT,
  restEndpoint: INJECTIVE_REST_ENDPOINT,
  feeDenom: 'inj',
  fixedMinGasPrice: 500000000,
  keyAlgos: ['ethsecp256k1'],
  assets: [
    {
      description: 'Injective testnet native token',
      base: 'inj',
      display: 'inj',
      name: 'INJ',
      symbol: 'INJ',
      exponent: 18,
    },
  ],
};

const mainnetConfigured = Boolean(
  process.env.NEXT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL &&
    INJECTIVE_RPC_ENDPOINT &&
    INJECTIVE_REST_ENDPOINT &&
    process.env.NEXT_PUBLIC_ENABLE_MAINNET_IBC_SWAP === 'true',
);

const injectiveMainnetChain: RuntimeChainConfig = {
  ...injectiveTestnetChain,
  id: INJECTIVE_MAINNET_CHAIN_ID,
  ibcChainId: INJECTIVE_MAINNET_CHAIN_ID,
  networkType: 'mainnet',
  prettyName: 'Injective Mainnet',
  rpcEndpoint: INJECTIVE_RPC_ENDPOINT,
  restEndpoint: INJECTIVE_REST_ENDPOINT,
};

function bidirectionalRoutes(
  idPrefix: string,
  chainA: string,
  chainB: string,
  labelA: string,
  labelB: string,
  options: {
    enabled?: boolean;
    disabledReason?: string;
  } = {},
): RuntimeRouteConfig[] {
  const { enabled = true, disabledReason } = options;

  return [
    {
      id: `${idPrefix}-${chainA}-to-${chainB}`,
      fromChainId: chainA,
      toChainId: chainB,
      viaChainIds: [ENTRYPOINT_CHAIN_ID],
      label: `${labelA} to ${labelB}`,
      enabled,
      disabledReason,
    },
    {
      id: `${idPrefix}-${chainB}-to-${chainA}`,
      fromChainId: chainB,
      toChainId: chainA,
      viaChainIds: [ENTRYPOINT_CHAIN_ID],
      label: `${labelB} to ${labelA}`,
      enabled,
      disabledReason,
    },
  ];
}

function buildRuntimeConfig(mode: IbcSwapMode): RuntimeConfig {
  if (mode === 'testnet') {
    return {
      mode,
      label: 'Testnet',
      description: 'Cardano preprod plus Injective testnet through Entrypoint.',
      enabled: true,
      entrypointChainId: ENTRYPOINT_CHAIN_ID,
      defaultCosmosChainId: ENTRYPOINT_CHAIN_ID,
      cardanoChainId: CARDANO_CHAIN_ID,
      cardanoIbcChainId: CARDANO_IBC_CHAIN_ID,
      cardanoBridgeManifestUrl: CARDANO_BRIDGE_MANIFEST_URL,
      plannerCounterpartyRestEndpoint: INJECTIVE_REST_ENDPOINT,
      pfmFeeChainIds: [],
      chains: [entrypointChain, cardanoChain('testnet'), injectiveTestnetChain],
      routes: bidirectionalRoutes(
        'testnet',
        CARDANO_CHAIN_ID,
        INJECTIVE_TESTNET_CHAIN_ID,
        'Cardano Preprod',
        'Injective Testnet',
      ),
      features: {
        localSwap: {
          enabled: false,
          toChainId: LOCAL_OSMOSIS_CHAIN_ID,
        },
      },
    };
  }

  if (mode === 'mainnet') {
    const disabledReason = mainnetConfigured
      ? undefined
      : 'Mainnet requires explicit public endpoints, manifests, and NEXT_PUBLIC_ENABLE_MAINNET_IBC_SWAP=true.';
    return {
      mode,
      label: 'Mainnet',
      description: 'Production topology. Disabled until fully configured.',
      enabled: mainnetConfigured,
      disabledReason,
      entrypointChainId: ENTRYPOINT_CHAIN_ID,
      defaultCosmosChainId: ENTRYPOINT_CHAIN_ID,
      cardanoChainId: CARDANO_CHAIN_ID,
      cardanoIbcChainId: CARDANO_IBC_CHAIN_ID,
      cardanoBridgeManifestUrl: CARDANO_BRIDGE_MANIFEST_URL,
      plannerCounterpartyRestEndpoint: INJECTIVE_REST_ENDPOINT,
      pfmFeeChainIds: [],
      chains: [
        entrypointChain,
        cardanoChain('mainnet'),
        {
          ...injectiveMainnetChain,
          disabledReason,
        },
      ],
      routes: bidirectionalRoutes(
        'mainnet',
        CARDANO_CHAIN_ID,
        INJECTIVE_MAINNET_CHAIN_ID,
        'Cardano Mainnet',
        'Injective Mainnet',
        {
          enabled: mainnetConfigured,
          disabledReason,
        },
      ),
      features: {
        localSwap: {
          enabled: false,
          toChainId: LOCAL_OSMOSIS_CHAIN_ID,
        },
      },
    };
  }

  return {
    mode,
    label: 'Local',
    description:
      'Local Cardano demo stack plus Local Osmosis through Entrypoint.',
    enabled: true,
    entrypointChainId: ENTRYPOINT_CHAIN_ID,
    defaultCosmosChainId: ENTRYPOINT_CHAIN_ID,
    cardanoChainId: CARDANO_CHAIN_ID,
    cardanoIbcChainId: CARDANO_IBC_CHAIN_ID,
    cardanoBridgeManifestUrl: CARDANO_BRIDGE_MANIFEST_URL,
    plannerCounterpartyRestEndpoint: LOCAL_OSMOSIS_REST_ENDPOINT,
    pfmFeeChainIds: [ENTRYPOINT_CHAIN_ID],
    chains: [entrypointChain, cardanoChain('devnet'), localOsmosisChain],
    routes: bidirectionalRoutes(
      'local',
      CARDANO_CHAIN_ID,
      LOCAL_OSMOSIS_CHAIN_ID,
      'Cardano Local',
      'Local Osmosis',
    ),
    features: {
      localSwap: {
        enabled: true,
        toChainId: LOCAL_OSMOSIS_CHAIN_ID,
      },
    },
  };
}

export const activeRuntimeConfig = buildRuntimeConfig(IBC_SWAP_MODE);

export const selectableRuntimeChains = activeRuntimeConfig.chains.filter(
  (chain) => chain.visibleInSelector,
);

export const cosmosRuntimeChains = activeRuntimeConfig.chains.filter(
  (chain) => chain.kind === 'cosmos',
);

export function findRuntimeChain(
  chainId?: string,
): RuntimeChainConfig | undefined {
  if (!chainId) return undefined;
  return activeRuntimeConfig.chains.find(
    (chain) => chain.id === chainId || chain.ibcChainId === chainId,
  );
}

function runtimeChainId(chainId?: string): string | undefined {
  if (!chainId) return undefined;
  return findRuntimeChain(chainId)?.id || chainId;
}

export function findRuntimeRoute(
  fromChainId?: string,
  toChainId?: string,
): RuntimeRouteConfig | undefined {
  const normalizedFromChainId = runtimeChainId(fromChainId);
  const normalizedToChainId = runtimeChainId(toChainId);
  if (!normalizedFromChainId || !normalizedToChainId) return undefined;
  return activeRuntimeConfig.routes.find(
    (route) =>
      route.fromChainId === normalizedFromChainId &&
      route.toChainId === normalizedToChainId,
  );
}

export function runtimeRouteChainIds(
  fromChainId?: string,
  toChainId?: string,
  plannedChainIds?: string[],
): string[] {
  if (plannedChainIds?.length) return plannedChainIds;
  const normalizedFromChainId = runtimeChainId(fromChainId);
  const normalizedToChainId = runtimeChainId(toChainId);
  const route = findRuntimeRoute(normalizedFromChainId, normalizedToChainId);
  if (!route) {
    return normalizedFromChainId && normalizedToChainId
      ? [normalizedFromChainId, normalizedToChainId]
      : [];
  }
  return [route.fromChainId, ...route.viaChainIds, route.toChainId];
}

export function runtimeChainLabel(chainId: string): string {
  return findRuntimeChain(chainId)?.prettyName || chainId;
}

export function isRuntimeRouteEnabled(
  fromChainId?: string,
  toChainId?: string,
): boolean {
  return Boolean(findRuntimeRoute(fromChainId, toChainId)?.enabled);
}

export function runtimeRouteDisabledReason(
  fromChainId?: string,
  toChainId?: string,
): string {
  const route = findRuntimeRoute(fromChainId, toChainId);
  if (!route) return 'No configured route for this pair.';
  return (
    route.disabledReason || 'This route is not enabled in the active mode.'
  );
}
