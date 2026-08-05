import {
  firstNonEmpty,
  resolveRuntimeIdentity,
} from '@/configs/runtimeIdentity';
import { requireBrowserRuntimeEnvironment } from '@/configs/publicRuntimeConfig';

type RuntimeWindow = Window & {
  ibcSwapRuntimeConfig?: Readonly<Record<string, string>>;
};

const browserRuntimeEnvironment =
  typeof window === 'undefined'
    ? undefined
    : requireBrowserRuntimeEnvironment(
        (window as RuntimeWindow).ibcSwapRuntimeConfig,
      );

const publicRuntimeValue = (key: string): string | undefined =>
  typeof window === 'undefined'
    ? process.env[key]
    : browserRuntimeEnvironment?.[key];

export type IbcSwapMode = 'local' | 'testnet' | 'mainnet';
export type CardanoNetwork = 'devnet' | 'preprod' | 'preview' | 'mainnet';

const isServerRuntime = typeof window === 'undefined';

const serverFirstNonEmpty = (
  ...values: Array<string | undefined>
): string | undefined =>
  isServerRuntime ? firstNonEmpty(...values) : undefined;

const runtimeIdentity = resolveRuntimeIdentity({
  NEXT_PUBLIC_IBC_SWAP_MODE: publicRuntimeValue('NEXT_PUBLIC_IBC_SWAP_MODE'),
  NEXT_PUBLIC_CARDANO_NETWORK: publicRuntimeValue(
    'NEXT_PUBLIC_CARDANO_NETWORK',
  ),
  NEXT_PUBLIC_CARDANO_CHAIN_ID: publicRuntimeValue(
    'NEXT_PUBLIC_CARDANO_CHAIN_ID',
  ),
  NEXT_PUBLIC_CARDANO_IBC_CHAIN_ID: publicRuntimeValue(
    'NEXT_PUBLIC_CARDANO_IBC_CHAIN_ID',
  ),
});

export const IBC_SWAP_MODE = runtimeIdentity.mode as IbcSwapMode;

export const LOCAL_CARDANO_CHAIN_ID = '42';
export const LOCAL_CARDANO_IBC_CHAIN_ID = 'cardano-devnet';
export const PREPROD_CARDANO_CHAIN_ID = '1';
export const PREPROD_CARDANO_IBC_CHAIN_ID = 'cardano-preprod';
export const PREVIEW_CARDANO_CHAIN_ID = '2';
export const PREVIEW_CARDANO_IBC_CHAIN_ID = 'cardano-preview';
export const MAINNET_CARDANO_CHAIN_ID = '764824073';
export const MAINNET_CARDANO_IBC_CHAIN_ID = 'cardano-mainnet';

export const CARDANO_NETWORK = runtimeIdentity.network as CardanoNetwork;
export const CARDANO_CHAIN_ID = runtimeIdentity.chainId;
export const CARDANO_IBC_CHAIN_ID = runtimeIdentity.ibcChainId;

export const isCardanoChainRef = (chainId?: string): boolean =>
  chainId === CARDANO_CHAIN_ID || chainId === CARDANO_IBC_CHAIN_ID;

export const LOCAL_OSMOSIS_RPC_ENDPOINT =
  firstNonEmpty(
    publicRuntimeValue('NEXT_PUBLIC_LOCALOSMOSIS_RPC_ENDPOINT'),
    publicRuntimeValue('NEXT_PUBLIC_LOCALOSMOIS_RPC_ENDPOINT'),
  ) || 'http://localhost:26658';

export const LOCAL_OSMOSIS_REST_ENDPOINT =
  firstNonEmpty(
    publicRuntimeValue('NEXT_PUBLIC_LOCALOSMOSIS_REST_ENDPOINT'),
    publicRuntimeValue('NEXT_PUBLIC_LOCALOSMOIS_REST_ENDPOINT'),
  ) || 'http://localhost:1318';

export const INJECTIVE_RPC_ENDPOINT =
  firstNonEmpty(publicRuntimeValue('NEXT_PUBLIC_INJECTIVE_RPC_ENDPOINT')) ||
  (IBC_SWAP_MODE === 'testnet'
    ? 'https://testnet.sentry.tm.injective.network:443'
    : '');

export const INJECTIVE_REST_ENDPOINT =
  firstNonEmpty(publicRuntimeValue('NEXT_PUBLIC_INJECTIVE_REST_ENDPOINT')) ||
  (IBC_SWAP_MODE === 'testnet'
    ? 'https://testnet.sentry.lcd.injective.network:443'
    : '');

export const GATEWAY_TX_BUILDER_ENDPOINT =
  serverFirstNonEmpty(
    process.env.IBC_SWAP_GATEWAY_TX_BUILDER_ENDPOINT,
    process.env.IBC_SWAP_GATEWAY_ENDPOINT,
  ) ||
  firstNonEmpty(
    publicRuntimeValue('NEXT_PUBLIC_GATEWAY_TX_BUILDER_ENDPOINT'),
  ) ||
  'http://localhost:8000';

export const CARDANO_BRIDGE_MANIFEST_URL =
  serverFirstNonEmpty(process.env.IBC_SWAP_CARDANO_BRIDGE_MANIFEST_URL) ||
  firstNonEmpty(
    publicRuntimeValue('NEXT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL'),
  ) ||
  `${GATEWAY_TX_BUILDER_ENDPOINT}/api/bridge-manifest`;

export const HAS_EXPLICIT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL = Boolean(
  firstNonEmpty(publicRuntimeValue('NEXT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL')),
);

export const KUPMIOS_URL =
  serverFirstNonEmpty(process.env.IBC_SWAP_KUPMIOS_URL) ||
  'http://localhost:1442,http://localhost:1337';

const KUPMIOS_KUPO_API_KEY = serverFirstNonEmpty(
  process.env.IBC_SWAP_KUPO_API_KEY,
  process.env.KUPO_API_KEY,
);

const KUPMIOS_OGMIOS_API_KEY = serverFirstNonEmpty(
  process.env.IBC_SWAP_OGMIOS_API_KEY,
  process.env.OGMIOS_API_KEY,
);

const authHeader = (apiKey?: string): Record<string, string> | undefined =>
  apiKey ? { 'dmtr-api-key': apiKey } : undefined;

export const KUPMIOS_AUTH_HEADERS = serverFirstNonEmpty(KUPMIOS_URL)
  ? {
      kupoHeader: authHeader(KUPMIOS_KUPO_API_KEY),
      ogmiosHeader: authHeader(KUPMIOS_OGMIOS_API_KEY),
    }
  : undefined;

export const CROSSCHAIN_SWAP_ADDRESS = firstNonEmpty(
  publicRuntimeValue('NEXT_PUBLIC_CROSSCHAIN_SWAP_ADDRESS'),
);

export const ENABLE_MAINNET_IBC_SWAP =
  publicRuntimeValue('NEXT_PUBLIC_ENABLE_MAINNET_IBC_SWAP') === 'true';

export const FORWARD_TIMEOUT =
  firstNonEmpty(publicRuntimeValue('NEXT_PUBLIC_FORWARD_TIMEOUT')) || '60m';

export const DAPP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const dappApiPath = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${DAPP_BASE_PATH}${normalizedPath}`;
};
