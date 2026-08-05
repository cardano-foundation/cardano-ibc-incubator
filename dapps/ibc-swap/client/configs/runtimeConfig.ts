import DefaultCardanoNetworkIcon from '@/assets/icons/cardano.svg';
import DefaultCosmosNetworkIcon from '@/assets/icons/cosmos-icon.svg';
import {
  CARDANO_BRIDGE_MANIFEST_URL,
  CARDANO_CHAIN_ID,
  CARDANO_IBC_CHAIN_ID,
  CARDANO_NETWORK,
  ENABLE_MAINNET_IBC_SWAP,
  HAS_EXPLICIT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL,
  IBC_SWAP_MODE,
  INJECTIVE_REST_ENDPOINT,
  INJECTIVE_RPC_ENDPOINT,
  LOCAL_OSMOSIS_REST_ENDPOINT,
  LOCAL_OSMOSIS_RPC_ENDPOINT,
  type CardanoNetwork,
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
  defaultCosmosChainId: string;
  cardanoNetwork: CardanoNetwork;
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

export const LOCAL_OSMOSIS_CHAIN_ID = 'localosmosis';
export const INJECTIVE_TESTNET_CHAIN_ID = 'injective-888';
export const INJECTIVE_MAINNET_CHAIN_ID = 'injective-1';

function cardanoPrettyName(): string {
  switch (CARDANO_NETWORK) {
    case 'mainnet':
      return 'Cardano Mainnet';
    case 'preview':
      return 'Cardano Preview';
    case 'preprod':
      return 'Cardano Preprod';
    case 'devnet':
    default:
      return 'Cardano Local';
  }
}

function cardanoNetworkType(): RuntimeChainConfig['networkType'] {
  switch (CARDANO_NETWORK) {
    case 'mainnet':
      return 'mainnet';
    case 'preview':
    case 'preprod':
      return 'testnet';
    case 'devnet':
    default:
      return 'devnet';
  }
}

const cardanoChain = (
  networkType: RuntimeChainConfig['networkType'] = cardanoNetworkType(),
): RuntimeChainConfig => ({
  id: CARDANO_CHAIN_ID,
  ibcChainId: CARDANO_IBC_CHAIN_ID,
  chainName: 'cardano',
  kind: 'cardano',
  role: 'user',
  networkType,
  prettyName: cardanoPrettyName(),
  bech32Prefix: CARDANO_NETWORK === 'mainnet' ? 'addr' : 'addr_test',
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
  HAS_EXPLICIT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL &&
    INJECTIVE_RPC_ENDPOINT &&
    INJECTIVE_REST_ENDPOINT &&
    ENABLE_MAINNET_IBC_SWAP,
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
      viaChainIds: [],
      label: `${labelA} to ${labelB}`,
      enabled,
      disabledReason,
    },
    {
      id: `${idPrefix}-${chainB}-to-${chainA}`,
      fromChainId: chainB,
      toChainId: chainA,
      viaChainIds: [],
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
      description: `${cardanoPrettyName()} plus Injective testnet direct-route preview.`,
      enabled: true,
      defaultCosmosChainId: INJECTIVE_TESTNET_CHAIN_ID,
      cardanoNetwork: CARDANO_NETWORK,
      cardanoChainId: CARDANO_CHAIN_ID,
      cardanoIbcChainId: CARDANO_IBC_CHAIN_ID,
      cardanoBridgeManifestUrl: CARDANO_BRIDGE_MANIFEST_URL,
      plannerCounterpartyRestEndpoint: INJECTIVE_REST_ENDPOINT,
      pfmFeeChainIds: [],
      chains: [cardanoChain(), injectiveTestnetChain],
      routes: bidirectionalRoutes(
        'testnet',
        CARDANO_CHAIN_ID,
        INJECTIVE_TESTNET_CHAIN_ID,
        cardanoPrettyName(),
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
      defaultCosmosChainId: INJECTIVE_MAINNET_CHAIN_ID,
      cardanoNetwork: CARDANO_NETWORK,
      cardanoChainId: CARDANO_CHAIN_ID,
      cardanoIbcChainId: CARDANO_IBC_CHAIN_ID,
      cardanoBridgeManifestUrl: CARDANO_BRIDGE_MANIFEST_URL,
      plannerCounterpartyRestEndpoint: INJECTIVE_REST_ENDPOINT,
      pfmFeeChainIds: [],
      chains: [
        cardanoChain(),
        {
          ...injectiveMainnetChain,
          disabledReason,
        },
      ],
      routes: bidirectionalRoutes(
        'mainnet',
        CARDANO_CHAIN_ID,
        INJECTIVE_MAINNET_CHAIN_ID,
        cardanoPrettyName(),
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
    description: `${cardanoPrettyName()} demo stack plus Local Osmosis direct-route preview.`,
    enabled: true,
    defaultCosmosChainId: LOCAL_OSMOSIS_CHAIN_ID,
    cardanoNetwork: CARDANO_NETWORK,
    cardanoChainId: CARDANO_CHAIN_ID,
    cardanoIbcChainId: CARDANO_IBC_CHAIN_ID,
    cardanoBridgeManifestUrl: CARDANO_BRIDGE_MANIFEST_URL,
    plannerCounterpartyRestEndpoint: LOCAL_OSMOSIS_REST_ENDPOINT,
    pfmFeeChainIds: [],
    chains: [cardanoChain(), localOsmosisChain],
    routes: bidirectionalRoutes(
      'local',
      CARDANO_CHAIN_ID,
      LOCAL_OSMOSIS_CHAIN_ID,
      cardanoPrettyName(),
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
