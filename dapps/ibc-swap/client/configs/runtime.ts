const firstNonEmpty = (...values: Array<string | undefined>): string | undefined =>
  values.find((value) => typeof value === 'string' && value.trim().length > 0);

export const LOCAL_CARDANO_CHAIN_ID = '42';
export const LOCAL_CARDANO_IBC_CHAIN_ID = 'cardano-devnet';

export const CARDANO_CHAIN_ID =
  firstNonEmpty(process.env.NEXT_PUBLIC_CARDANO_CHAIN_ID) ||
  LOCAL_CARDANO_CHAIN_ID;

export const CARDANO_IBC_CHAIN_ID =
  firstNonEmpty(process.env.NEXT_PUBLIC_CARDANO_IBC_CHAIN_ID) ||
  LOCAL_CARDANO_IBC_CHAIN_ID;

export const isCardanoChainRef = (chainId?: string): boolean =>
  chainId === CARDANO_CHAIN_ID || chainId === CARDANO_IBC_CHAIN_ID;

export const ENTRYPOINT_RPC_ENDPOINT =
  firstNonEmpty(
    process.env.NEXT_PUBLIC_ENTRYPOINT_RPC_ENDPOINT,
    process.env.NEXT_PUBLIC_SIDECHAIN_RPC_ENDPOINT,
  ) || 'http://localhost:26657';

export const ENTRYPOINT_REST_ENDPOINT =
  firstNonEmpty(
    process.env.NEXT_PUBLIC_ENTRYPOINT_REST_ENDPOINT,
    process.env.NEXT_PUBLIC_SIDECHAIN_REST_ENDPOINT,
  ) || 'http://localhost:1317';

export const LOCAL_OSMOSIS_RPC_ENDPOINT =
  firstNonEmpty(
    process.env.NEXT_PUBLIC_LOCALOSMOSIS_RPC_ENDPOINT,
    process.env.NEXT_PUBLIC_LOCALOSMOIS_RPC_ENDPOINT,
  ) || 'http://localhost:26658';

export const LOCAL_OSMOSIS_REST_ENDPOINT =
  firstNonEmpty(
    process.env.NEXT_PUBLIC_LOCALOSMOSIS_REST_ENDPOINT,
    process.env.NEXT_PUBLIC_LOCALOSMOIS_REST_ENDPOINT,
  ) || 'http://localhost:1318';

export const GATEWAY_TX_BUILDER_ENDPOINT =
  firstNonEmpty(process.env.NEXT_PUBLIC_GATEWAY_TX_BUILDER_ENDPOINT) ||
  'http://localhost:8000';

export const CARDANO_BRIDGE_MANIFEST_URL =
  firstNonEmpty(process.env.NEXT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL) ||
  `${GATEWAY_TX_BUILDER_ENDPOINT}/api/bridge-manifest`;

export const KUPMIOS_URL =
  firstNonEmpty(process.env.NEXT_PUBLIC_KUPMIOS_URL) ||
  'http://localhost:1442,http://localhost:1337';

export const CROSSCHAIN_SWAP_ADDRESS = firstNonEmpty(
  process.env.NEXT_PUBLIC_CROSSCHAIN_SWAP_ADDRESS,
);
