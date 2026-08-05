const CARDANO_IDENTITIES = Object.freeze({
  devnet: Object.freeze({
    mode: 'local',
    chainId: '42',
    ibcChainId: 'cardano-devnet',
  }),
  preprod: Object.freeze({
    mode: 'testnet',
    chainId: '1',
    ibcChainId: 'cardano-preprod',
  }),
  preview: Object.freeze({
    mode: 'testnet',
    chainId: '2',
    ibcChainId: 'cardano-preview',
  }),
  mainnet: Object.freeze({
    mode: 'mainnet',
    chainId: '764824073',
    ibcChainId: 'cardano-mainnet',
  }),
});

const firstNonEmpty = (...values) =>
  values
    .find((value) => typeof value === 'string' && value.trim().length > 0)
    ?.trim();

const normalizeMode = (value) => {
  switch (value?.trim().toLowerCase()) {
    case 'mainnet':
      return 'mainnet';
    case 'testnet':
    case 'preprod':
    case 'preview':
      return 'testnet';
    case 'local':
    case 'devnet':
    case 'custom':
    case 'cardano-devnet':
      return 'local';
    default:
      return undefined;
  }
};

const networkImpliedByModeAlias = (value) => {
  switch (value?.trim().toLowerCase()) {
    case 'preprod':
      return 'preprod';
    case 'preview':
      return 'preview';
    case 'mainnet':
      return 'mainnet';
    case 'local':
    case 'devnet':
    case 'custom':
    case 'cardano-devnet':
      return 'devnet';
    default:
      return undefined;
  }
};

const normalizeNetwork = (value) => {
  switch (value?.trim().toLowerCase()) {
    case 'mainnet':
      return 'mainnet';
    case 'preprod':
    case 'testnet':
      return 'preprod';
    case 'preview':
      return 'preview';
    case 'devnet':
    case 'local':
    case 'custom':
    case 'cardano-devnet':
      return 'devnet';
    default:
      return undefined;
  }
};

const findNetworkBy = (property, value) =>
  Object.entries(CARDANO_IDENTITIES).find(
    ([, identity]) => identity[property] === value,
  )?.[0];

const assertKnownValue = (label, value, resolved) => {
  if (value && !resolved) {
    throw new Error(`Unsupported ${label} "${value}".`);
  }
};

/**
 * Resolve and validate the identity fields that must always describe the same
 * Cardano network. This intentionally rejects "close enough" combinations:
 * signing against the wrong network is worse than refusing to start.
 *
 * @param {Record<string, string | undefined>} environment
 */
function resolveRuntimeIdentity(environment = {}) {
  const rawMode = firstNonEmpty(environment.NEXT_PUBLIC_IBC_SWAP_MODE);
  const mode = normalizeMode(rawMode) || 'local';
  assertKnownValue('IBC swap mode', rawMode, normalizeMode(rawMode));

  const rawNetwork = firstNonEmpty(environment.NEXT_PUBLIC_CARDANO_NETWORK);
  const configuredNetwork = normalizeNetwork(rawNetwork);
  assertKnownValue('Cardano network', rawNetwork, configuredNetwork);

  const configuredChainId = firstNonEmpty(
    environment.NEXT_PUBLIC_CARDANO_CHAIN_ID,
  );
  if (configuredChainId && !/^\d+$/.test(configuredChainId)) {
    throw new Error(
      `Cardano chain ID must be a numeric network magic, received "${configuredChainId}".`,
    );
  }
  const chainIdNetwork = configuredChainId
    ? findNetworkBy('chainId', configuredChainId)
    : undefined;
  assertKnownValue('Cardano chain ID', configuredChainId, chainIdNetwork);

  const configuredIbcChainId = firstNonEmpty(
    environment.NEXT_PUBLIC_CARDANO_IBC_CHAIN_ID,
  );
  const ibcChainIdNetwork = configuredIbcChainId
    ? findNetworkBy('ibcChainId', configuredIbcChainId.toLowerCase())
    : undefined;
  assertKnownValue(
    'Cardano IBC chain ID',
    configuredIbcChainId,
    ibcChainIdNetwork,
  );

  const explicitNetworks = [
    networkImpliedByModeAlias(rawMode),
    configuredNetwork,
    chainIdNetwork,
    ibcChainIdNetwork,
  ].filter(Boolean);
  const distinctNetworks = [...new Set(explicitNetworks)];
  if (distinctNetworks.length > 1) {
    throw new Error(
      `Cardano runtime identity is inconsistent: ${distinctNetworks.join(
        ', ',
      )} were configured by mode, network, numeric chain ID, or IBC chain ID.`,
    );
  }

  const defaultNetwork =
    mode === 'mainnet' ? 'mainnet' : mode === 'testnet' ? 'preprod' : 'devnet';
  const network = distinctNetworks[0] || defaultNetwork;
  const identity = CARDANO_IDENTITIES[network];

  if (identity.mode !== mode) {
    throw new Error(
      `IBC swap mode "${mode}" cannot use Cardano ${network}; expected mode "${identity.mode}".`,
    );
  }

  return Object.freeze({
    mode,
    network,
    chainId: identity.chainId,
    ibcChainId: identity.ibcChainId,
  });
}

/**
 * @param {unknown} manifest
 * @param {{network: string, chainId: string, ibcChainId: string}} identity
 */
function assertBridgeManifestMatchesIdentity(manifest, identity) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Cardano bridge manifest must be a JSON object.');
  }

  const cardano = manifest.cardano;
  if (!cardano || typeof cardano !== 'object' || Array.isArray(cardano)) {
    throw new Error('Cardano bridge manifest is missing cardano metadata.');
  }

  const manifestNetwork = String(cardano.network || '').toLowerCase();
  const actualNetwork =
    manifestNetwork === 'custom' || manifestNetwork === 'cardano-devnet'
      ? 'devnet'
      : manifestNetwork;
  const actualChainId = String(cardano.chain_id || '').toLowerCase();
  const actualNetworkMagic = String(cardano.network_magic ?? '');
  if (
    actualNetwork !== identity.network ||
    actualChainId !== identity.ibcChainId ||
    actualNetworkMagic !== identity.chainId
  ) {
    throw new Error(
      `Cardano bridge manifest identifies ${actualNetwork || 'unknown'}/${
        actualChainId || 'unknown'
      }/${actualNetworkMagic || 'unknown'}, but the dapp is configured for ${
        identity.network
      }/${identity.ibcChainId}/${identity.chainId}.`,
    );
  }
}

module.exports = {
  CARDANO_IDENTITIES,
  assertBridgeManifestMatchesIdentity,
  firstNonEmpty,
  resolveRuntimeIdentity,
};
