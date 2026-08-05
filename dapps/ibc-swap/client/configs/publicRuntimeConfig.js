const PUBLIC_RUNTIME_KEYS = Object.freeze([
  'NEXT_PUBLIC_IBC_SWAP_MODE',
  'NEXT_PUBLIC_CARDANO_NETWORK',
  'NEXT_PUBLIC_CARDANO_CHAIN_ID',
  'NEXT_PUBLIC_CARDANO_IBC_CHAIN_ID',
  'NEXT_PUBLIC_LOCALOSMOSIS_RPC_ENDPOINT',
  'NEXT_PUBLIC_LOCALOSMOIS_RPC_ENDPOINT',
  'NEXT_PUBLIC_LOCALOSMOSIS_REST_ENDPOINT',
  'NEXT_PUBLIC_LOCALOSMOIS_REST_ENDPOINT',
  'NEXT_PUBLIC_INJECTIVE_RPC_ENDPOINT',
  'NEXT_PUBLIC_INJECTIVE_REST_ENDPOINT',
  'NEXT_PUBLIC_GATEWAY_TX_BUILDER_ENDPOINT',
  'NEXT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL',
  'NEXT_PUBLIC_CROSSCHAIN_SWAP_ADDRESS',
  'NEXT_PUBLIC_ENABLE_MAINNET_IBC_SWAP',
  'NEXT_PUBLIC_FORWARD_TIMEOUT',
]);

function firstNonEmpty(...values) {
  return values.find(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
}

function isUnauthenticatedDemeterEndpoint(endpoint, authenticatedPrefix) {
  try {
    const hostname = new URL(endpoint).hostname;
    const isDemeterHost =
      hostname.endsWith('.dmtr.host') || hostname.endsWith('.demeter.run');
    return isDemeterHost && !hostname.startsWith(authenticatedPrefix);
  } catch {
    return false;
  }
}

function validateRemoteKupmiosAuth(environment) {
  const mode = firstNonEmpty(
    environment.NEXT_PUBLIC_IBC_SWAP_MODE,
    environment.IBC_SWAP_MODE,
  )
    ?.trim()
    .toLowerCase();
  if (!['testnet', 'preprod', 'preview', 'mainnet'].includes(mode)) return;

  const kupmiosUrl = firstNonEmpty(
    environment.IBC_SWAP_KUPMIOS_INTERNAL_URL,
    environment.IBC_SWAP_KUPMIOS_URL,
  );
  if (!kupmiosUrl) {
    throw new Error(
      'Public IBC Swap mode requires IBC_SWAP_KUPMIOS_INTERNAL_URL or IBC_SWAP_KUPMIOS_URL.',
    );
  }

  const endpoints = kupmiosUrl.split(',').map((value) => value.trim());
  if (endpoints.length !== 2 || endpoints.some((endpoint) => !endpoint)) {
    throw new Error(
      'Public IBC Swap mode requires exactly one Kupo URL and one Ogmios URL.',
    );
  }
  for (const [label, endpoint] of [
    ['Kupo', endpoints[0]],
    ['Ogmios', endpoints[1]],
  ]) {
    try {
      const parsed = new URL(endpoint);
      if (!parsed.hostname || !['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('unsupported endpoint');
      }
    } catch {
      throw new Error(`Public IBC Swap mode has an invalid ${label} URL.`);
    }
  }
  const [kupoEndpoint, ogmiosEndpoint] = endpoints;
  const missing = [];

  if (
    isUnauthenticatedDemeterEndpoint(kupoEndpoint, 'kupo') &&
    !firstNonEmpty(environment.IBC_SWAP_KUPO_API_KEY, environment.KUPO_API_KEY)
  ) {
    missing.push('IBC_SWAP_KUPO_API_KEY');
  }
  if (
    isUnauthenticatedDemeterEndpoint(ogmiosEndpoint, 'ogmios') &&
    !firstNonEmpty(
      environment.IBC_SWAP_OGMIOS_API_KEY,
      environment.OGMIOS_API_KEY,
    )
  ) {
    missing.push('IBC_SWAP_OGMIOS_API_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `Unauthenticated Demeter endpoints require server-side credentials: ${missing.join(
        ', ',
      )}`,
    );
  }
}

/**
 * Keep this an explicit allowlist. In particular, Kupmios URLs are server-only:
 * Demeter supports authenticated hostnames that contain the API key itself.
 *
 * @param {Record<string, string | undefined>} environment
 */
function selectPublicRuntimeEnvironment(environment) {
  return Object.fromEntries(
    PUBLIC_RUNTIME_KEYS.flatMap((key) => {
      const value = environment[key]?.trim();
      return value ? [[key, value]] : [];
    }),
  );
}

function requireBrowserRuntimeEnvironment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      'IBC Swap runtime configuration failed to load; refusing to use build-time network defaults.',
    );
  }
  return value;
}

module.exports = {
  PUBLIC_RUNTIME_KEYS,
  requireBrowserRuntimeEnvironment,
  selectPublicRuntimeEnvironment,
  validateRemoteKupmiosAuth,
};
