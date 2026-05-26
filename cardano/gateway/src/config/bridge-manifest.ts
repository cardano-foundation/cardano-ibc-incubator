type RefUtxo = {
  txHash: string;
  outputIndex: number;
};

type AuthToken = {
  policyId: string;
  name: string;
};

type DeploymentRefValidator = {
  scriptHash: string;
  refUtxo: RefUtxo;
};

type DeploymentValidator = {
  scriptHash: string;
  address?: string;
  refUtxo: RefUtxo;
};

type DeploymentVoucherMetadata = {
  address: string;
};

type DeploymentSpendChannelValidator = DeploymentValidator & {
  refValidator: {
    acknowledge_packet: DeploymentRefValidator;
    chan_close_confirm: DeploymentRefValidator;
    chan_close_init: DeploymentRefValidator;
    chan_open_ack: DeploymentRefValidator;
    chan_open_confirm: DeploymentRefValidator;
    recv_packet: DeploymentRefValidator;
    send_packet: DeploymentRefValidator;
    timeout_packet: DeploymentRefValidator;
  };
};

type DeploymentModule = {
  identifier: string;
  address: string;
};

type DeploymentTraceRegistryShard = {
  policyId: string;
  name: string;
};

type DeploymentTraceRegistry = {
  address: string;
  shardPolicyId: string;
  directory: DeploymentTraceRegistryShard;
};

type DeploymentBridgeRegistry = {
  policyId: string;
  tokenName: string;
  address: string;
  refUtxo: RefUtxo;
  governanceKeyHash: string;
};

type DeploymentVoucherCompatibilityProfile = {
  compatibleBridgeVersion: number;
  voucherAssetNameVersion: number;
  redeemerVersion: number;
  packetDataEncodingVersion: number;
  transferDenomLogicVersion: number;
  channelIdDerivationVersion: number;
  hostStateChannelSemanticsVersion: number;
  traceRegistrySemanticsVersion: number;
  metadataFormatVersion: number;
  bridgeRegistryToken: AuthToken;
  traceRegistryId: string;
};

type DeploymentVoucherPolicyRegistryEntry = DeploymentValidator & {
  compatibility?: DeploymentVoucherCompatibilityProfile;
};

type DeploymentVoucherPolicyRegistry = {
  active: DeploymentVoucherPolicyRegistryEntry;
  legacy: DeploymentVoucherPolicyRegistryEntry[];
};

export type DeploymentConfig = {
  deployedAt: string;
  hostStateNFT: AuthToken;
  validators: {
    hostStateStt: DeploymentValidator;
    spendClient: DeploymentValidator;
    spendConnection: DeploymentValidator;
    spendChannel: DeploymentSpendChannelValidator;
    spendMockModule?: DeploymentValidator;
    bridgeRegistry?: DeploymentValidator;
    spendTraceRegistry?: DeploymentValidator;
    spendTransferModule: DeploymentValidator;
    mintIdentifier: DeploymentValidator;
    verifyProof: DeploymentValidator;
    mintClientStt: DeploymentValidator;
    mintConnectionStt: DeploymentValidator;
    mintChannelStt: DeploymentValidator;
    mintVoucher: DeploymentValidator;
    mintTransferEscrowShard: DeploymentValidator;
    mintPort: DeploymentValidator;
    voucherMetadata?: DeploymentVoucherMetadata;
  };
  modules: {
    transfer: DeploymentModule;
    mock?: DeploymentModule;
    icq?: DeploymentModule;
  };
  traceRegistry?: DeploymentTraceRegistry;
  bridgeRegistry?: DeploymentBridgeRegistry;
  voucherPolicyRegistry?: DeploymentVoucherPolicyRegistry;
};

type BridgeManifestRefUtxo = {
  tx_hash: string;
  output_index: number;
};

type BridgeManifestAuthToken = {
  policy_id: string;
  token_name: string;
};

type BridgeManifestRefValidator = {
  script_hash: string;
  ref_utxo: BridgeManifestRefUtxo;
};

type BridgeManifestValidator = {
  script_hash: string;
  address: string;
  ref_utxo: BridgeManifestRefUtxo;
};

type BridgeManifestVoucherMetadata = {
  address: string;
};

type BridgeManifestSpendChannelValidator = BridgeManifestValidator & {
  ref_validator: {
    acknowledge_packet: BridgeManifestRefValidator;
    chan_close_confirm: BridgeManifestRefValidator;
    chan_close_init: BridgeManifestRefValidator;
    chan_open_ack: BridgeManifestRefValidator;
    chan_open_confirm: BridgeManifestRefValidator;
    recv_packet: BridgeManifestRefValidator;
    send_packet: BridgeManifestRefValidator;
    timeout_packet: BridgeManifestRefValidator;
  };
};

type BridgeManifestModule = {
  identifier: string;
  address: string;
};

type BridgeManifestTraceRegistryShard = {
  policy_id: string;
  token_name: string;
};

type BridgeManifestTraceRegistry = {
  address: string;
  shard_policy_id: string;
  directory: BridgeManifestTraceRegistryShard;
};

type BridgeManifestBridgeRegistry = {
  policy_id: string;
  token_name: string;
  address: string;
  ref_utxo: BridgeManifestRefUtxo;
  governance_key_hash: string;
};

type BridgeManifestVoucherCompatibilityProfile = {
  compatible_bridge_version: number;
  voucher_asset_name_version: number;
  redeemer_version: number;
  packet_data_encoding_version: number;
  transfer_denom_logic_version: number;
  channel_id_derivation_version: number;
  host_state_channel_semantics_version: number;
  trace_registry_semantics_version: number;
  metadata_format_version: number;
  bridge_registry_token: BridgeManifestAuthToken;
  trace_registry_id: string;
};

type BridgeManifestVoucherPolicyRegistryEntry = BridgeManifestValidator & {
  compatibility?: BridgeManifestVoucherCompatibilityProfile;
};

type BridgeManifestVoucherPolicyRegistry = {
  active: BridgeManifestVoucherPolicyRegistryEntry;
  legacy: BridgeManifestVoucherPolicyRegistryEntry[];
};

// The manifest is the public, deployment-stable bootstrap document we expose to
// external operators. It intentionally uses snake_case and only includes the
// on-chain facts another Gateway/relayer stack needs to reconnect to this bridge.
export type BridgeManifest = {
  schema_version: number;
  deployment_id: string;
  deployed_at: string;
  cardano: {
    chain_id: string;
    network_magic: number;
    network: string;
  };
  host_state_nft: BridgeManifestAuthToken;
  validators: {
    host_state_stt: BridgeManifestValidator;
    spend_client: BridgeManifestValidator;
    spend_connection: BridgeManifestValidator;
    spend_channel: BridgeManifestSpendChannelValidator;
    spend_mock_module?: BridgeManifestValidator;
    bridge_registry?: BridgeManifestValidator;
    spend_trace_registry?: BridgeManifestValidator;
    spend_transfer_module: BridgeManifestValidator;
    mint_identifier: BridgeManifestValidator;
    verify_proof: BridgeManifestValidator;
    mint_client_stt: BridgeManifestValidator;
    mint_connection_stt: BridgeManifestValidator;
    mint_channel_stt: BridgeManifestValidator;
    mint_voucher: BridgeManifestValidator;
    mint_transfer_escrow_shard: BridgeManifestValidator;
    mint_port: BridgeManifestValidator;
    // The runtime only needs the target script address for the immutable
    // CIP-68 metadata output. We intentionally do not expose ref_utxo or
    // script_hash here because they are not consumed after deployment.
    voucher_metadata?: BridgeManifestVoucherMetadata;
  };
  voucher_policy_registry?: BridgeManifestVoucherPolicyRegistry;
  modules: {
    transfer: BridgeManifestModule;
    mock?: BridgeManifestModule;
    icq?: BridgeManifestModule;
  };
  trace_registry?: BridgeManifestTraceRegistry;
  bridge_registry?: BridgeManifestBridgeRegistry;
};

export type BridgeManifestCardanoIdentity = BridgeManifest['cardano'];

export type LoadedBridgeConfig = {
  deployment: DeploymentConfig;
  bridgeManifest: BridgeManifest;
};

export const DEFAULT_HANDLER_JSON_PATH = '../deployment/offchain/handler.json';

const VOUCHER_COMPATIBILITY_PROTOCOL = {
  compatibleBridgeVersion: 1,
  voucherAssetNameVersion: 1,
  redeemerVersion: 1,
  packetDataEncodingVersion: 1,
  transferDenomLogicVersion: 1,
  channelIdDerivationVersion: 1,
  hostStateChannelSemanticsVersion: 1,
  traceRegistrySemanticsVersion: 1,
  metadataFormatVersion: 1,
} as const;

export function deriveCardanoNetwork(networkMagic: number): string {
  if (networkMagic === 1) {
    return 'Preprod';
  }
  if (networkMagic === 2) {
    return 'Preview';
  }
  if (networkMagic === 764824073) {
    return 'Mainnet';
  }
  return 'Custom';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// These helpers make startup failures point to the exact bad field in the
// manifest/handler file instead of surfacing as later undefined-access errors.
function requireObject(value: unknown, path: string): Record<string, unknown> {
  assert(value && typeof value === 'object', `Invalid bridge config: "${path}" must be an object`);
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, path: string): string {
  assert(isNonEmptyString(value), `Invalid bridge config: "${path}" must be a non-empty string`);
  return value;
}

function requireNonNegativeInteger(value: unknown, path: string): number {
  assert(
    typeof value === 'number' && Number.isInteger(value) && value >= 0,
    `Invalid bridge config: "${path}" must be a non-negative integer`,
  );
  return value;
}

function requireIsoTimestamp(value: unknown, path: string): string {
  const timestamp = requireNonEmptyString(value, path);
  assert(!Number.isNaN(Date.parse(timestamp)), `Invalid bridge config: "${path}" must be an ISO-8601 timestamp`);
  return timestamp;
}

function requireRefUtxo(value: unknown, path: string): RefUtxo {
  const refUtxo = requireObject(value, path);
  return {
    txHash: requireNonEmptyString(refUtxo.txHash, `${path}.txHash`),
    outputIndex: requireNonNegativeInteger(refUtxo.outputIndex, `${path}.outputIndex`),
  };
}

function requireManifestRefUtxo(value: unknown, path: string): BridgeManifestRefUtxo {
  const refUtxo = requireObject(value, path);
  return {
    tx_hash: requireNonEmptyString(refUtxo.tx_hash, `${path}.tx_hash`),
    output_index: requireNonNegativeInteger(refUtxo.output_index, `${path}.output_index`),
  };
}

function requireAuthToken(value: unknown, path: string): AuthToken {
  const authToken = requireObject(value, path);
  return {
    policyId: requireNonEmptyString(authToken.policyId, `${path}.policyId`),
    name: requireNonEmptyString(authToken.name, `${path}.name`),
  };
}

function requireManifestAuthToken(value: unknown, path: string): BridgeManifestAuthToken {
  const authToken = requireObject(value, path);
  return {
    policy_id: requireNonEmptyString(authToken.policy_id, `${path}.policy_id`),
    token_name: requireNonEmptyString(authToken.token_name, `${path}.token_name`),
  };
}

function requireDeploymentValidator(value: unknown, path: string): DeploymentValidator {
  const validator = requireObject(value, path);
  return {
    scriptHash: requireNonEmptyString(validator.scriptHash, `${path}.scriptHash`),
    address: typeof validator.address === 'string' ? validator.address : '',
    refUtxo: requireRefUtxo(validator.refUtxo, `${path}.refUtxo`),
  };
}

function requireManifestValidator(value: unknown, path: string): BridgeManifestValidator {
  const validator = requireObject(value, path);
  return {
    script_hash: requireNonEmptyString(validator.script_hash, `${path}.script_hash`),
    address: typeof validator.address === 'string' ? validator.address : '',
    ref_utxo: requireManifestRefUtxo(validator.ref_utxo, `${path}.ref_utxo`),
  };
}

function requireDeploymentVoucherCompatibilityProfile(
  value: unknown,
  path: string,
): DeploymentVoucherCompatibilityProfile {
  const profile = requireObject(value, path);
  return {
    compatibleBridgeVersion: requireNonNegativeInteger(
      profile.compatibleBridgeVersion,
      `${path}.compatibleBridgeVersion`,
    ),
    voucherAssetNameVersion: requireNonNegativeInteger(
      profile.voucherAssetNameVersion,
      `${path}.voucherAssetNameVersion`,
    ),
    redeemerVersion: requireNonNegativeInteger(profile.redeemerVersion, `${path}.redeemerVersion`),
    packetDataEncodingVersion: requireNonNegativeInteger(
      profile.packetDataEncodingVersion,
      `${path}.packetDataEncodingVersion`,
    ),
    transferDenomLogicVersion: requireNonNegativeInteger(
      profile.transferDenomLogicVersion,
      `${path}.transferDenomLogicVersion`,
    ),
    channelIdDerivationVersion: requireNonNegativeInteger(
      profile.channelIdDerivationVersion,
      `${path}.channelIdDerivationVersion`,
    ),
    hostStateChannelSemanticsVersion: requireNonNegativeInteger(
      profile.hostStateChannelSemanticsVersion,
      `${path}.hostStateChannelSemanticsVersion`,
    ),
    traceRegistrySemanticsVersion: requireNonNegativeInteger(
      profile.traceRegistrySemanticsVersion,
      `${path}.traceRegistrySemanticsVersion`,
    ),
    metadataFormatVersion: requireNonNegativeInteger(profile.metadataFormatVersion, `${path}.metadataFormatVersion`),
    bridgeRegistryToken: requireAuthToken(profile.bridgeRegistryToken, `${path}.bridgeRegistryToken`),
    traceRegistryId: requireNonEmptyString(profile.traceRegistryId, `${path}.traceRegistryId`),
  };
}

function requireManifestVoucherCompatibilityProfile(
  value: unknown,
  path: string,
): BridgeManifestVoucherCompatibilityProfile {
  const profile = requireObject(value, path);
  return {
    compatible_bridge_version: requireNonNegativeInteger(
      profile.compatible_bridge_version,
      `${path}.compatible_bridge_version`,
    ),
    voucher_asset_name_version: requireNonNegativeInteger(
      profile.voucher_asset_name_version,
      `${path}.voucher_asset_name_version`,
    ),
    redeemer_version: requireNonNegativeInteger(profile.redeemer_version, `${path}.redeemer_version`),
    packet_data_encoding_version: requireNonNegativeInteger(
      profile.packet_data_encoding_version,
      `${path}.packet_data_encoding_version`,
    ),
    transfer_denom_logic_version: requireNonNegativeInteger(
      profile.transfer_denom_logic_version,
      `${path}.transfer_denom_logic_version`,
    ),
    channel_id_derivation_version: requireNonNegativeInteger(
      profile.channel_id_derivation_version,
      `${path}.channel_id_derivation_version`,
    ),
    host_state_channel_semantics_version: requireNonNegativeInteger(
      profile.host_state_channel_semantics_version,
      `${path}.host_state_channel_semantics_version`,
    ),
    trace_registry_semantics_version: requireNonNegativeInteger(
      profile.trace_registry_semantics_version,
      `${path}.trace_registry_semantics_version`,
    ),
    metadata_format_version: requireNonNegativeInteger(
      profile.metadata_format_version,
      `${path}.metadata_format_version`,
    ),
    bridge_registry_token: requireManifestAuthToken(profile.bridge_registry_token, `${path}.bridge_registry_token`),
    trace_registry_id: requireNonEmptyString(profile.trace_registry_id, `${path}.trace_registry_id`),
  };
}

function requireDeploymentVoucherPolicyEntry(value: unknown, path: string): DeploymentVoucherPolicyRegistryEntry {
  const entry = requireObject(value, path);
  return {
    ...requireDeploymentValidator(entry, path),
    ...(entry.compatibility
      ? { compatibility: requireDeploymentVoucherCompatibilityProfile(entry.compatibility, `${path}.compatibility`) }
      : {}),
  };
}

function requireManifestVoucherPolicyEntry(value: unknown, path: string): BridgeManifestVoucherPolicyRegistryEntry {
  const entry = requireObject(value, path);
  return {
    ...requireManifestValidator(entry, path),
    ...(entry.compatibility
      ? { compatibility: requireManifestVoucherCompatibilityProfile(entry.compatibility, `${path}.compatibility`) }
      : {}),
  };
}

function requireDeploymentVoucherPolicyRegistry(
  value: unknown,
  fallbackActive: DeploymentValidator,
  path: string,
): DeploymentVoucherPolicyRegistry {
  if (!value) {
    return {
      active: fallbackActive,
      legacy: [],
    };
  }
  const registry = requireObject(value, path);
  return {
    active: registry.active ? requireDeploymentVoucherPolicyEntry(registry.active, `${path}.active`) : fallbackActive,
    legacy: Array.isArray(registry.legacy)
      ? registry.legacy.map((entry, index) => requireDeploymentVoucherPolicyEntry(entry, `${path}.legacy[${index}]`))
      : [],
  };
}

function requireManifestVoucherPolicyRegistry(
  value: unknown,
  fallbackActive: BridgeManifestValidator,
  path: string,
): BridgeManifestVoucherPolicyRegistry {
  if (!value) {
    return {
      active: fallbackActive,
      legacy: [],
    };
  }
  const registry = requireObject(value, path);
  return {
    active: registry.active ? requireManifestVoucherPolicyEntry(registry.active, `${path}.active`) : fallbackActive,
    legacy: Array.isArray(registry.legacy)
      ? registry.legacy.map((entry, index) => requireManifestVoucherPolicyEntry(entry, `${path}.legacy[${index}]`))
      : [],
  };
}

function requireDeploymentBridgeRegistry(value: unknown, path: string): DeploymentBridgeRegistry {
  const registry = requireObject(value, path);
  return {
    policyId: requireNonEmptyString(registry.policyId, `${path}.policyId`),
    tokenName: requireNonEmptyString(registry.tokenName, `${path}.tokenName`),
    address: requireNonEmptyString(registry.address, `${path}.address`),
    refUtxo: requireRefUtxo(registry.refUtxo, `${path}.refUtxo`),
    governanceKeyHash: requireNonEmptyString(registry.governanceKeyHash, `${path}.governanceKeyHash`),
  };
}

function requireManifestBridgeRegistry(value: unknown, path: string): BridgeManifestBridgeRegistry {
  const registry = requireObject(value, path);
  return {
    policy_id: requireNonEmptyString(registry.policy_id, `${path}.policy_id`),
    token_name: requireNonEmptyString(registry.token_name, `${path}.token_name`),
    address: requireNonEmptyString(registry.address, `${path}.address`),
    ref_utxo: requireManifestRefUtxo(registry.ref_utxo, `${path}.ref_utxo`),
    governance_key_hash: requireNonEmptyString(registry.governance_key_hash, `${path}.governance_key_hash`),
  };
}

function requireDeploymentVoucherMetadata(value: unknown, path: string): DeploymentVoucherMetadata {
  const validator = requireObject(value, path);
  return {
    address: requireNonEmptyString(validator.address, `${path}.address`),
  };
}

function requireManifestVoucherMetadata(value: unknown, path: string): BridgeManifestVoucherMetadata {
  const validator = requireObject(value, path);
  return {
    address: requireNonEmptyString(validator.address, `${path}.address`),
  };
}

function requireDeploymentRefValidator(value: unknown, path: string): DeploymentRefValidator {
  const validator = requireObject(value, path);
  return {
    scriptHash: requireNonEmptyString(validator.scriptHash, `${path}.scriptHash`),
    refUtxo: requireRefUtxo(validator.refUtxo, `${path}.refUtxo`),
  };
}

function requireManifestRefValidator(value: unknown, path: string): BridgeManifestRefValidator {
  const validator = requireObject(value, path);
  return {
    script_hash: requireNonEmptyString(validator.script_hash, `${path}.script_hash`),
    ref_utxo: requireManifestRefUtxo(validator.ref_utxo, `${path}.ref_utxo`),
  };
}

function requireDeploymentSpendChannelValidator(value: unknown, path: string): DeploymentSpendChannelValidator {
  const validator = requireObject(value, path);
  const refValidator = requireObject(validator.refValidator, `${path}.refValidator`);

  return {
    ...requireDeploymentValidator(validator, path),
    refValidator: {
      acknowledge_packet: requireDeploymentRefValidator(
        refValidator.acknowledge_packet,
        `${path}.refValidator.acknowledge_packet`,
      ),
      chan_close_confirm: requireDeploymentRefValidator(
        refValidator.chan_close_confirm,
        `${path}.refValidator.chan_close_confirm`,
      ),
      chan_close_init: requireDeploymentRefValidator(
        refValidator.chan_close_init,
        `${path}.refValidator.chan_close_init`,
      ),
      chan_open_ack: requireDeploymentRefValidator(refValidator.chan_open_ack, `${path}.refValidator.chan_open_ack`),
      chan_open_confirm: requireDeploymentRefValidator(
        refValidator.chan_open_confirm,
        `${path}.refValidator.chan_open_confirm`,
      ),
      recv_packet: requireDeploymentRefValidator(refValidator.recv_packet, `${path}.refValidator.recv_packet`),
      send_packet: requireDeploymentRefValidator(refValidator.send_packet, `${path}.refValidator.send_packet`),
      timeout_packet: requireDeploymentRefValidator(refValidator.timeout_packet, `${path}.refValidator.timeout_packet`),
    },
  };
}

function requireManifestSpendChannelValidator(value: unknown, path: string): BridgeManifestSpendChannelValidator {
  const validator = requireObject(value, path);
  const refValidator = requireObject(validator.ref_validator, `${path}.ref_validator`);

  return {
    ...requireManifestValidator(validator, path),
    ref_validator: {
      acknowledge_packet: requireManifestRefValidator(
        refValidator.acknowledge_packet,
        `${path}.ref_validator.acknowledge_packet`,
      ),
      chan_close_confirm: requireManifestRefValidator(
        refValidator.chan_close_confirm,
        `${path}.ref_validator.chan_close_confirm`,
      ),
      chan_close_init: requireManifestRefValidator(
        refValidator.chan_close_init,
        `${path}.ref_validator.chan_close_init`,
      ),
      chan_open_ack: requireManifestRefValidator(refValidator.chan_open_ack, `${path}.ref_validator.chan_open_ack`),
      chan_open_confirm: requireManifestRefValidator(
        refValidator.chan_open_confirm,
        `${path}.ref_validator.chan_open_confirm`,
      ),
      recv_packet: requireManifestRefValidator(refValidator.recv_packet, `${path}.ref_validator.recv_packet`),
      send_packet: requireManifestRefValidator(refValidator.send_packet, `${path}.ref_validator.send_packet`),
      timeout_packet: requireManifestRefValidator(refValidator.timeout_packet, `${path}.ref_validator.timeout_packet`),
    },
  };
}

function requireDeploymentModule(value: unknown, path: string): DeploymentModule {
  const module = requireObject(value, path);
  return {
    identifier: requireNonEmptyString(module.identifier, `${path}.identifier`),
    address: requireNonEmptyString(module.address, `${path}.address`),
  };
}

function requireManifestModule(value: unknown, path: string): BridgeManifestModule {
  const module = requireObject(value, path);
  return {
    identifier: requireNonEmptyString(module.identifier, `${path}.identifier`),
    address: requireNonEmptyString(module.address, `${path}.address`),
  };
}

function requireDeploymentTraceRegistry(value: unknown, path: string): DeploymentTraceRegistry {
  const traceRegistry = requireObject(value, path);
  const directory = requireObject(traceRegistry.directory, `${path}.directory`);

  return {
    address: requireNonEmptyString(traceRegistry.address, `${path}.address`),
    shardPolicyId: requireNonEmptyString(traceRegistry.shardPolicyId, `${path}.shardPolicyId`),
    directory: {
      policyId: requireNonEmptyString(directory.policyId, `${path}.directory.policyId`),
      name: requireNonEmptyString(directory.name, `${path}.directory.name`),
    },
  };
}

function requireManifestTraceRegistry(value: unknown, path: string): BridgeManifestTraceRegistry {
  const traceRegistry = requireObject(value, path);
  const directory = requireObject(traceRegistry.directory, `${path}.directory`);

  return {
    address: requireNonEmptyString(traceRegistry.address, `${path}.address`),
    shard_policy_id: requireNonEmptyString(traceRegistry.shard_policy_id, `${path}.shard_policy_id`),
    directory: {
      policy_id: requireNonEmptyString(directory.policy_id, `${path}.directory.policy_id`),
      token_name: requireNonEmptyString(directory.token_name, `${path}.directory.token_name`),
    },
  };
}

function requireCardanoIdentity(value: BridgeManifestCardanoIdentity): BridgeManifestCardanoIdentity {
  return {
    chain_id: requireNonEmptyString(value.chain_id, 'cardano.chain_id'),
    network_magic: requireNonNegativeInteger(value.network_magic, 'cardano.network_magic'),
    network: requireNonEmptyString(value.network, 'cardano.network'),
  };
}

function buildDeploymentId(cardano: BridgeManifestCardanoIdentity, hostStateNFT: AuthToken): string {
  return `${cardano.chain_id}:${hostStateNFT.policyId}.${hostStateNFT.name}`;
}

function deploymentAuthTokenToManifest(authToken: AuthToken): BridgeManifestAuthToken {
  return {
    policy_id: authToken.policyId,
    token_name: authToken.name,
  };
}

function manifestAuthTokenToDeployment(authToken: BridgeManifestAuthToken): AuthToken {
  return {
    policyId: authToken.policy_id,
    name: authToken.token_name,
  };
}

function deploymentRefUtxoToManifest(refUtxo: RefUtxo): BridgeManifestRefUtxo {
  return {
    tx_hash: refUtxo.txHash,
    output_index: refUtxo.outputIndex,
  };
}

function manifestRefUtxoToDeployment(refUtxo: BridgeManifestRefUtxo): RefUtxo {
  return {
    txHash: refUtxo.tx_hash,
    outputIndex: refUtxo.output_index,
  };
}

function deploymentValidatorToManifest(validator: DeploymentValidator): BridgeManifestValidator {
  return {
    script_hash: validator.scriptHash,
    address: validator.address ?? '',
    ref_utxo: deploymentRefUtxoToManifest(validator.refUtxo),
  };
}

function manifestValidatorToDeployment(validator: BridgeManifestValidator): DeploymentValidator {
  return {
    scriptHash: validator.script_hash,
    address: validator.address,
    refUtxo: manifestRefUtxoToDeployment(validator.ref_utxo),
  };
}

function deploymentVoucherPolicyRegistryToManifest(
  registry: DeploymentVoucherPolicyRegistry,
): BridgeManifestVoucherPolicyRegistry {
  return {
    active: {
      ...deploymentValidatorToManifest(registry.active),
      ...(registry.active.compatibility
        ? { compatibility: deploymentVoucherCompatibilityToManifest(registry.active.compatibility) }
        : {}),
    },
    legacy: registry.legacy.map((entry) => ({
      ...deploymentValidatorToManifest(entry),
      ...(entry.compatibility ? { compatibility: deploymentVoucherCompatibilityToManifest(entry.compatibility) } : {}),
    })),
  };
}

function manifestVoucherPolicyRegistryToDeployment(
  registry: BridgeManifestVoucherPolicyRegistry,
): DeploymentVoucherPolicyRegistry {
  return {
    active: {
      ...manifestValidatorToDeployment(registry.active),
      ...(registry.active.compatibility
        ? { compatibility: manifestVoucherCompatibilityToDeployment(registry.active.compatibility) }
        : {}),
    },
    legacy: registry.legacy.map((entry) => ({
      ...manifestValidatorToDeployment(entry),
      ...(entry.compatibility ? { compatibility: manifestVoucherCompatibilityToDeployment(entry.compatibility) } : {}),
    })),
  };
}

function deploymentVoucherMetadataToManifest(validator: DeploymentVoucherMetadata): BridgeManifestVoucherMetadata {
  return {
    address: validator.address,
  };
}

function manifestVoucherMetadataToDeployment(validator: BridgeManifestVoucherMetadata): DeploymentVoucherMetadata {
  return {
    address: validator.address,
  };
}

function deploymentRefValidatorToManifest(validator: DeploymentRefValidator): BridgeManifestRefValidator {
  return {
    script_hash: validator.scriptHash,
    ref_utxo: deploymentRefUtxoToManifest(validator.refUtxo),
  };
}

function manifestRefValidatorToDeployment(validator: BridgeManifestRefValidator): DeploymentRefValidator {
  return {
    scriptHash: validator.script_hash,
    refUtxo: manifestRefUtxoToDeployment(validator.ref_utxo),
  };
}

function deploymentTraceRegistryToManifest(traceRegistry: DeploymentTraceRegistry): BridgeManifestTraceRegistry {
  return {
    address: traceRegistry.address,
    shard_policy_id: traceRegistry.shardPolicyId,
    directory: {
      policy_id: traceRegistry.directory.policyId,
      token_name: traceRegistry.directory.name,
    },
  };
}

function manifestTraceRegistryToDeployment(traceRegistry: BridgeManifestTraceRegistry): DeploymentTraceRegistry {
  return {
    address: traceRegistry.address,
    shardPolicyId: traceRegistry.shard_policy_id,
    directory: {
      policyId: traceRegistry.directory.policy_id,
      name: traceRegistry.directory.token_name,
    },
  };
}

function deploymentBridgeRegistryToManifest(bridgeRegistry: DeploymentBridgeRegistry): BridgeManifestBridgeRegistry {
  return {
    policy_id: bridgeRegistry.policyId,
    token_name: bridgeRegistry.tokenName,
    address: bridgeRegistry.address,
    ref_utxo: deploymentRefUtxoToManifest(bridgeRegistry.refUtxo),
    governance_key_hash: bridgeRegistry.governanceKeyHash,
  };
}

function manifestBridgeRegistryToDeployment(bridgeRegistry: BridgeManifestBridgeRegistry): DeploymentBridgeRegistry {
  return {
    policyId: bridgeRegistry.policy_id,
    tokenName: bridgeRegistry.token_name,
    address: bridgeRegistry.address,
    refUtxo: manifestRefUtxoToDeployment(bridgeRegistry.ref_utxo),
    governanceKeyHash: bridgeRegistry.governance_key_hash,
  };
}

function deploymentTraceRegistryId(traceRegistry: DeploymentTraceRegistry): string {
  return [
    traceRegistry.address,
    traceRegistry.shardPolicyId,
    traceRegistry.directory.policyId,
    traceRegistry.directory.name,
  ].join(':');
}

function manifestTraceRegistryId(traceRegistry: BridgeManifestTraceRegistry): string {
  return [
    traceRegistry.address,
    traceRegistry.shard_policy_id,
    traceRegistry.directory.policy_id,
    traceRegistry.directory.token_name,
  ].join(':');
}

function expectedDeploymentVoucherCompatibilityProfile(
  deployment: Pick<DeploymentConfig, 'bridgeRegistry' | 'traceRegistry'>,
): DeploymentVoucherCompatibilityProfile {
  assert(deployment.bridgeRegistry, 'Invalid bridge config: legacy voucher policy support requires bridgeRegistry');
  assert(deployment.traceRegistry, 'Invalid bridge config: legacy voucher policy support requires traceRegistry');

  return {
    ...VOUCHER_COMPATIBILITY_PROTOCOL,
    bridgeRegistryToken: {
      policyId: deployment.bridgeRegistry.policyId,
      name: deployment.bridgeRegistry.tokenName,
    },
    traceRegistryId: deploymentTraceRegistryId(deployment.traceRegistry),
  };
}

function expectedManifestVoucherCompatibilityProfile(
  manifest: Pick<BridgeManifest, 'bridge_registry' | 'trace_registry'>,
): BridgeManifestVoucherCompatibilityProfile {
  assert(manifest.bridge_registry, 'Invalid bridge config: legacy voucher policy support requires bridge_registry');
  assert(manifest.trace_registry, 'Invalid bridge config: legacy voucher policy support requires trace_registry');

  return {
    compatible_bridge_version: VOUCHER_COMPATIBILITY_PROTOCOL.compatibleBridgeVersion,
    voucher_asset_name_version: VOUCHER_COMPATIBILITY_PROTOCOL.voucherAssetNameVersion,
    redeemer_version: VOUCHER_COMPATIBILITY_PROTOCOL.redeemerVersion,
    packet_data_encoding_version: VOUCHER_COMPATIBILITY_PROTOCOL.packetDataEncodingVersion,
    transfer_denom_logic_version: VOUCHER_COMPATIBILITY_PROTOCOL.transferDenomLogicVersion,
    channel_id_derivation_version: VOUCHER_COMPATIBILITY_PROTOCOL.channelIdDerivationVersion,
    host_state_channel_semantics_version: VOUCHER_COMPATIBILITY_PROTOCOL.hostStateChannelSemanticsVersion,
    trace_registry_semantics_version: VOUCHER_COMPATIBILITY_PROTOCOL.traceRegistrySemanticsVersion,
    metadata_format_version: VOUCHER_COMPATIBILITY_PROTOCOL.metadataFormatVersion,
    bridge_registry_token: {
      policy_id: manifest.bridge_registry.policy_id,
      token_name: manifest.bridge_registry.token_name,
    },
    trace_registry_id: manifestTraceRegistryId(manifest.trace_registry),
  };
}

function deploymentVoucherCompatibilityToManifest(
  profile: DeploymentVoucherCompatibilityProfile,
): BridgeManifestVoucherCompatibilityProfile {
  return {
    compatible_bridge_version: profile.compatibleBridgeVersion,
    voucher_asset_name_version: profile.voucherAssetNameVersion,
    redeemer_version: profile.redeemerVersion,
    packet_data_encoding_version: profile.packetDataEncodingVersion,
    transfer_denom_logic_version: profile.transferDenomLogicVersion,
    channel_id_derivation_version: profile.channelIdDerivationVersion,
    host_state_channel_semantics_version: profile.hostStateChannelSemanticsVersion,
    trace_registry_semantics_version: profile.traceRegistrySemanticsVersion,
    metadata_format_version: profile.metadataFormatVersion,
    bridge_registry_token: deploymentAuthTokenToManifest(profile.bridgeRegistryToken),
    trace_registry_id: profile.traceRegistryId,
  };
}

function manifestVoucherCompatibilityToDeployment(
  profile: BridgeManifestVoucherCompatibilityProfile,
): DeploymentVoucherCompatibilityProfile {
  return {
    compatibleBridgeVersion: profile.compatible_bridge_version,
    voucherAssetNameVersion: profile.voucher_asset_name_version,
    redeemerVersion: profile.redeemer_version,
    packetDataEncodingVersion: profile.packet_data_encoding_version,
    transferDenomLogicVersion: profile.transfer_denom_logic_version,
    channelIdDerivationVersion: profile.channel_id_derivation_version,
    hostStateChannelSemanticsVersion: profile.host_state_channel_semantics_version,
    traceRegistrySemanticsVersion: profile.trace_registry_semantics_version,
    metadataFormatVersion: profile.metadata_format_version,
    bridgeRegistryToken: manifestAuthTokenToDeployment(profile.bridge_registry_token),
    traceRegistryId: profile.trace_registry_id,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertJsonEqual(left: unknown, right: unknown, message: string): void {
  assert(stableJson(left) === stableJson(right), message);
}

function normalizeDeploymentVoucherPolicyRegistryCompatibility(deployment: DeploymentConfig): DeploymentConfig {
  const registry = deployment.voucherPolicyRegistry ?? {
    active: deployment.validators.mintVoucher as DeploymentVoucherPolicyRegistryEntry,
    legacy: [],
  };
  const expected = expectedDeploymentVoucherCompatibilityProfile(deployment);
  const activeCompatibility = registry.active.compatibility ?? expected;
  assertJsonEqual(
    activeCompatibility,
    expected,
    'Invalid bridge config: active voucher policy compatibility does not match this bridge deployment',
  );

  return {
    ...deployment,
    voucherPolicyRegistry: {
      active: { ...registry.active, compatibility: activeCompatibility },
      legacy: registry.legacy.map((entry, index) => {
        assert(
          entry.compatibility,
          `Invalid bridge config: "voucherPolicyRegistry.legacy[${index}].compatibility" is required`,
        );
        assertJsonEqual(
          entry.compatibility,
          expected,
          `Invalid bridge config: legacy voucher policy ${entry.scriptHash} is not compatible with this bridge deployment`,
        );
        return { ...entry, compatibility: entry.compatibility };
      }),
    },
  };
}

function normalizeManifestVoucherPolicyRegistryCompatibility(manifest: BridgeManifest): BridgeManifest {
  const registry = manifest.voucher_policy_registry ?? {
    active: manifest.validators.mint_voucher as BridgeManifestVoucherPolicyRegistryEntry,
    legacy: [],
  };
  const expected = expectedManifestVoucherCompatibilityProfile(manifest);
  const activeCompatibility = registry.active.compatibility ?? expected;
  assertJsonEqual(
    activeCompatibility,
    expected,
    'Invalid bridge config: active voucher policy compatibility does not match this bridge manifest',
  );

  return {
    ...manifest,
    voucher_policy_registry: {
      active: { ...registry.active, compatibility: activeCompatibility },
      legacy: registry.legacy.map((entry, index) => {
        assert(
          entry.compatibility,
          `Invalid bridge config: "voucher_policy_registry.legacy[${index}].compatibility" is required`,
        );
        assertJsonEqual(
          entry.compatibility,
          expected,
          `Invalid bridge config: legacy voucher policy ${entry.script_hash} is not compatible with this bridge manifest`,
        );
        return { ...entry, compatibility: entry.compatibility };
      }),
    },
  };
}

function deploymentSpendChannelToManifest(
  validator: DeploymentSpendChannelValidator,
): BridgeManifestSpendChannelValidator {
  return {
    ...deploymentValidatorToManifest(validator),
    ref_validator: {
      acknowledge_packet: deploymentRefValidatorToManifest(validator.refValidator.acknowledge_packet),
      chan_close_confirm: deploymentRefValidatorToManifest(validator.refValidator.chan_close_confirm),
      chan_close_init: deploymentRefValidatorToManifest(validator.refValidator.chan_close_init),
      chan_open_ack: deploymentRefValidatorToManifest(validator.refValidator.chan_open_ack),
      chan_open_confirm: deploymentRefValidatorToManifest(validator.refValidator.chan_open_confirm),
      recv_packet: deploymentRefValidatorToManifest(validator.refValidator.recv_packet),
      send_packet: deploymentRefValidatorToManifest(validator.refValidator.send_packet),
      timeout_packet: deploymentRefValidatorToManifest(validator.refValidator.timeout_packet),
    },
  };
}

function manifestSpendChannelToDeployment(
  validator: BridgeManifestSpendChannelValidator,
): DeploymentSpendChannelValidator {
  return {
    ...manifestValidatorToDeployment(validator),
    refValidator: {
      acknowledge_packet: manifestRefValidatorToDeployment(validator.ref_validator.acknowledge_packet),
      chan_close_confirm: manifestRefValidatorToDeployment(validator.ref_validator.chan_close_confirm),
      chan_close_init: manifestRefValidatorToDeployment(validator.ref_validator.chan_close_init),
      chan_open_ack: manifestRefValidatorToDeployment(validator.ref_validator.chan_open_ack),
      chan_open_confirm: manifestRefValidatorToDeployment(validator.ref_validator.chan_open_confirm),
      recv_packet: manifestRefValidatorToDeployment(validator.ref_validator.recv_packet),
      send_packet: manifestRefValidatorToDeployment(validator.ref_validator.send_packet),
      timeout_packet: manifestRefValidatorToDeployment(validator.ref_validator.timeout_packet),
    },
  };
}

export function requireSttDeploymentConfig(deployment: unknown): DeploymentConfig {
  const deploymentAny = requireObject(deployment, 'deployment');
  const validators = requireObject(deploymentAny.validators, 'validators');
  const modules = requireObject(deploymentAny.modules, 'modules');

  return {
    deployedAt: requireIsoTimestamp(deploymentAny.deployedAt, 'deployedAt'),
    hostStateNFT: requireAuthToken(deploymentAny.hostStateNFT, 'hostStateNFT'),
    validators: {
      hostStateStt: requireDeploymentValidator(validators.hostStateStt, 'validators.hostStateStt'),
      spendClient: requireDeploymentValidator(validators.spendClient, 'validators.spendClient'),
      spendConnection: requireDeploymentValidator(validators.spendConnection, 'validators.spendConnection'),
      spendChannel: requireDeploymentSpendChannelValidator(validators.spendChannel, 'validators.spendChannel'),
      ...(validators.spendMockModule
        ? { spendMockModule: requireDeploymentValidator(validators.spendMockModule, 'validators.spendMockModule') }
        : {}),
      ...(validators.bridgeRegistry
        ? { bridgeRegistry: requireDeploymentValidator(validators.bridgeRegistry, 'validators.bridgeRegistry') }
        : {}),
      ...(validators.spendTraceRegistry
        ? {
            spendTraceRegistry: requireDeploymentValidator(
              validators.spendTraceRegistry,
              'validators.spendTraceRegistry',
            ),
          }
        : {}),
      spendTransferModule: requireDeploymentValidator(validators.spendTransferModule, 'validators.spendTransferModule'),
      mintIdentifier: requireDeploymentValidator(validators.mintIdentifier, 'validators.mintIdentifier'),
      verifyProof: requireDeploymentValidator(validators.verifyProof, 'validators.verifyProof'),
      mintClientStt: requireDeploymentValidator(validators.mintClientStt, 'validators.mintClientStt'),
      mintConnectionStt: requireDeploymentValidator(validators.mintConnectionStt, 'validators.mintConnectionStt'),
      mintChannelStt: requireDeploymentValidator(validators.mintChannelStt, 'validators.mintChannelStt'),
      mintVoucher: requireDeploymentValidator(validators.mintVoucher, 'validators.mintVoucher'),
      mintTransferEscrowShard: requireDeploymentValidator(
        validators.mintTransferEscrowShard,
        'validators.mintTransferEscrowShard',
      ),
      mintPort: requireDeploymentValidator(validators.mintPort, 'validators.mintPort'),
      ...(validators.voucherMetadata
        ? {
            voucherMetadata: requireDeploymentVoucherMetadata(validators.voucherMetadata, 'validators.voucherMetadata'),
          }
        : {}),
    },
    modules: {
      transfer: requireDeploymentModule(modules.transfer, 'modules.transfer'),
      ...(modules.mock ? { mock: requireDeploymentModule(modules.mock, 'modules.mock') } : {}),
      ...(modules.icq ? { icq: requireDeploymentModule(modules.icq, 'modules.icq') } : {}),
    },
    ...(deploymentAny.traceRegistry
      ? { traceRegistry: requireDeploymentTraceRegistry(deploymentAny.traceRegistry, 'traceRegistry') }
      : {}),
    ...(deploymentAny.bridgeRegistry
      ? { bridgeRegistry: requireDeploymentBridgeRegistry(deploymentAny.bridgeRegistry, 'bridgeRegistry') }
      : {}),
    voucherPolicyRegistry: requireDeploymentVoucherPolicyRegistry(
      deploymentAny.voucherPolicyRegistry,
      requireDeploymentValidator(validators.mintVoucher, 'validators.mintVoucher'),
      'voucherPolicyRegistry',
    ),
  };
}

export function normalizeHandlerJsonDeploymentConfig(
  deployment: unknown,
  cardano: BridgeManifestCardanoIdentity,
): LoadedBridgeConfig {
  const normalizedDeployment = normalizeDeploymentVoucherPolicyRegistryCompatibility(
    requireSttDeploymentConfig(deployment),
  );
  const normalizedCardano = requireCardanoIdentity(cardano);

  // Normalize deployment JSON once so both startup sources feed the same public
  // manifest and internal deployment object into the rest of the Gateway.
  return {
    deployment: normalizedDeployment,
    bridgeManifest: {
      schema_version: 3,
      deployment_id: buildDeploymentId(normalizedCardano, normalizedDeployment.hostStateNFT),
      deployed_at: normalizedDeployment.deployedAt,
      cardano: normalizedCardano,
      host_state_nft: deploymentAuthTokenToManifest(normalizedDeployment.hostStateNFT),
      validators: {
        host_state_stt: deploymentValidatorToManifest(normalizedDeployment.validators.hostStateStt),
        spend_client: deploymentValidatorToManifest(normalizedDeployment.validators.spendClient),
        spend_connection: deploymentValidatorToManifest(normalizedDeployment.validators.spendConnection),
        spend_channel: deploymentSpendChannelToManifest(normalizedDeployment.validators.spendChannel),
        ...(normalizedDeployment.validators.spendMockModule
          ? { spend_mock_module: deploymentValidatorToManifest(normalizedDeployment.validators.spendMockModule) }
          : {}),
        ...(normalizedDeployment.validators.bridgeRegistry
          ? { bridge_registry: deploymentValidatorToManifest(normalizedDeployment.validators.bridgeRegistry) }
          : {}),
        ...(normalizedDeployment.validators.spendTraceRegistry
          ? {
              spend_trace_registry: deploymentValidatorToManifest(normalizedDeployment.validators.spendTraceRegistry),
            }
          : {}),
        spend_transfer_module: deploymentValidatorToManifest(normalizedDeployment.validators.spendTransferModule),
        mint_identifier: deploymentValidatorToManifest(normalizedDeployment.validators.mintIdentifier),
        verify_proof: deploymentValidatorToManifest(normalizedDeployment.validators.verifyProof),
        mint_client_stt: deploymentValidatorToManifest(normalizedDeployment.validators.mintClientStt),
        mint_connection_stt: deploymentValidatorToManifest(normalizedDeployment.validators.mintConnectionStt),
        mint_channel_stt: deploymentValidatorToManifest(normalizedDeployment.validators.mintChannelStt),
        mint_voucher: deploymentValidatorToManifest(normalizedDeployment.validators.mintVoucher),
        mint_transfer_escrow_shard: deploymentValidatorToManifest(
          normalizedDeployment.validators.mintTransferEscrowShard,
        ),
        mint_port: deploymentValidatorToManifest(normalizedDeployment.validators.mintPort),
        ...(normalizedDeployment.validators.voucherMetadata
          ? {
              voucher_metadata: deploymentVoucherMetadataToManifest(normalizedDeployment.validators.voucherMetadata),
            }
          : {}),
      },
      modules: {
        transfer: normalizedDeployment.modules.transfer,
        ...(normalizedDeployment.modules.mock ? { mock: normalizedDeployment.modules.mock } : {}),
        ...(normalizedDeployment.modules.icq ? { icq: normalizedDeployment.modules.icq } : {}),
      },
      ...(normalizedDeployment.traceRegistry
        ? { trace_registry: deploymentTraceRegistryToManifest(normalizedDeployment.traceRegistry) }
        : {}),
      ...(normalizedDeployment.bridgeRegistry
        ? { bridge_registry: deploymentBridgeRegistryToManifest(normalizedDeployment.bridgeRegistry) }
        : {}),
      voucher_policy_registry: deploymentVoucherPolicyRegistryToManifest(
        normalizedDeployment.voucherPolicyRegistry ?? {
          active: normalizedDeployment.validators.mintVoucher,
          legacy: [],
        },
      ),
    },
  };
}

export function normalizeBridgeManifestConfig(manifest: unknown): LoadedBridgeConfig {
  const manifestAny = requireObject(manifest, 'bridgeManifest');
  const validators = requireObject(manifestAny.validators, 'validators');
  const modules = requireObject(manifestAny.modules, 'modules');

  // Manifest startup is the inverse path: validate the public document, then
  // rebuild the internal deployment shape so downstream Gateway code stays
  // unaware of which bootstrap source was used.
  const mintVoucherManifest = requireManifestValidator(validators.mint_voucher, 'validators.mint_voucher');
  const parsedBridgeManifest: BridgeManifest = {
    schema_version: requireNonNegativeInteger(manifestAny.schema_version, 'schema_version'),
    deployment_id: requireNonEmptyString(manifestAny.deployment_id, 'deployment_id'),
    deployed_at: requireIsoTimestamp(manifestAny.deployed_at, 'deployed_at'),
    cardano: requireCardanoIdentity(
      requireObject(manifestAny.cardano, 'cardano') as unknown as BridgeManifestCardanoIdentity,
    ),
    host_state_nft: requireManifestAuthToken(manifestAny.host_state_nft, 'host_state_nft'),
    validators: {
      host_state_stt: requireManifestValidator(validators.host_state_stt, 'validators.host_state_stt'),
      spend_client: requireManifestValidator(validators.spend_client, 'validators.spend_client'),
      spend_connection: requireManifestValidator(validators.spend_connection, 'validators.spend_connection'),
      spend_channel: requireManifestSpendChannelValidator(validators.spend_channel, 'validators.spend_channel'),
      ...(validators.spend_mock_module
        ? { spend_mock_module: requireManifestValidator(validators.spend_mock_module, 'validators.spend_mock_module') }
        : {}),
      ...(validators.bridge_registry
        ? { bridge_registry: requireManifestValidator(validators.bridge_registry, 'validators.bridge_registry') }
        : {}),
      ...(validators.spend_trace_registry
        ? {
            spend_trace_registry: requireManifestValidator(
              validators.spend_trace_registry,
              'validators.spend_trace_registry',
            ),
          }
        : {}),
      spend_transfer_module: requireManifestValidator(
        validators.spend_transfer_module,
        'validators.spend_transfer_module',
      ),
      mint_identifier: requireManifestValidator(validators.mint_identifier, 'validators.mint_identifier'),
      verify_proof: requireManifestValidator(validators.verify_proof, 'validators.verify_proof'),
      mint_client_stt: requireManifestValidator(validators.mint_client_stt, 'validators.mint_client_stt'),
      mint_connection_stt: requireManifestValidator(validators.mint_connection_stt, 'validators.mint_connection_stt'),
      mint_channel_stt: requireManifestValidator(validators.mint_channel_stt, 'validators.mint_channel_stt'),
      mint_voucher: mintVoucherManifest,
      mint_transfer_escrow_shard: requireManifestValidator(
        validators.mint_transfer_escrow_shard,
        'validators.mint_transfer_escrow_shard',
      ),
      mint_port: requireManifestValidator(validators.mint_port, 'validators.mint_port'),
      ...(validators.voucher_metadata
        ? {
            voucher_metadata: requireManifestVoucherMetadata(
              validators.voucher_metadata,
              'validators.voucher_metadata',
            ),
          }
        : {}),
    },
    modules: {
      transfer: requireManifestModule(modules.transfer, 'modules.transfer'),
      ...(modules.mock ? { mock: requireManifestModule(modules.mock, 'modules.mock') } : {}),
      ...(modules.icq ? { icq: requireManifestModule(modules.icq, 'modules.icq') } : {}),
    },
    ...(manifestAny.trace_registry
      ? { trace_registry: requireManifestTraceRegistry(manifestAny.trace_registry, 'trace_registry') }
      : {}),
    ...(manifestAny.bridge_registry
      ? { bridge_registry: requireManifestBridgeRegistry(manifestAny.bridge_registry, 'bridge_registry') }
      : {}),
    voucher_policy_registry: requireManifestVoucherPolicyRegistry(
      manifestAny.voucher_policy_registry,
      mintVoucherManifest,
      'voucher_policy_registry',
    ),
  };

  assert(
    parsedBridgeManifest.schema_version === 2 || parsedBridgeManifest.schema_version === 3,
    'Invalid bridge config: "schema_version" must be 2 or 3',
  );

  const bridgeManifest = normalizeManifestVoucherPolicyRegistryCompatibility(parsedBridgeManifest);

  return {
    bridgeManifest,
    deployment: {
      deployedAt: bridgeManifest.deployed_at,
      hostStateNFT: manifestAuthTokenToDeployment(bridgeManifest.host_state_nft),
      validators: {
        hostStateStt: manifestValidatorToDeployment(bridgeManifest.validators.host_state_stt),
        spendClient: manifestValidatorToDeployment(bridgeManifest.validators.spend_client),
        spendConnection: manifestValidatorToDeployment(bridgeManifest.validators.spend_connection),
        spendChannel: manifestSpendChannelToDeployment(bridgeManifest.validators.spend_channel),
        ...(bridgeManifest.validators.spend_mock_module
          ? { spendMockModule: manifestValidatorToDeployment(bridgeManifest.validators.spend_mock_module) }
          : {}),
        ...(bridgeManifest.validators.bridge_registry
          ? { bridgeRegistry: manifestValidatorToDeployment(bridgeManifest.validators.bridge_registry) }
          : {}),
        ...(bridgeManifest.validators.spend_trace_registry
          ? {
              spendTraceRegistry: manifestValidatorToDeployment(bridgeManifest.validators.spend_trace_registry),
            }
          : {}),
        spendTransferModule: manifestValidatorToDeployment(bridgeManifest.validators.spend_transfer_module),
        mintIdentifier: manifestValidatorToDeployment(bridgeManifest.validators.mint_identifier),
        verifyProof: manifestValidatorToDeployment(bridgeManifest.validators.verify_proof),
        mintClientStt: manifestValidatorToDeployment(bridgeManifest.validators.mint_client_stt),
        mintConnectionStt: manifestValidatorToDeployment(bridgeManifest.validators.mint_connection_stt),
        mintChannelStt: manifestValidatorToDeployment(bridgeManifest.validators.mint_channel_stt),
        mintVoucher: manifestValidatorToDeployment(bridgeManifest.validators.mint_voucher),
        mintTransferEscrowShard: manifestValidatorToDeployment(bridgeManifest.validators.mint_transfer_escrow_shard),
        mintPort: manifestValidatorToDeployment(bridgeManifest.validators.mint_port),
        ...(bridgeManifest.validators.voucher_metadata
          ? {
              voucherMetadata: manifestVoucherMetadataToDeployment(bridgeManifest.validators.voucher_metadata),
            }
          : {}),
      },
      modules: {
        transfer: requireDeploymentModule(bridgeManifest.modules.transfer, 'modules.transfer'),
        ...(bridgeManifest.modules.mock
          ? { mock: requireDeploymentModule(bridgeManifest.modules.mock, 'modules.mock') }
          : {}),
        ...(bridgeManifest.modules.icq
          ? { icq: requireDeploymentModule(bridgeManifest.modules.icq, 'modules.icq') }
          : {}),
      },
      ...(bridgeManifest.trace_registry
        ? { traceRegistry: manifestTraceRegistryToDeployment(bridgeManifest.trace_registry) }
        : {}),
      ...(bridgeManifest.bridge_registry
        ? { bridgeRegistry: manifestBridgeRegistryToDeployment(bridgeManifest.bridge_registry) }
        : {}),
      voucherPolicyRegistry: manifestVoucherPolicyRegistryToDeployment(
        bridgeManifest.voucher_policy_registry ?? {
          active: bridgeManifest.validators.mint_voucher,
          legacy: [],
        },
      ),
    },
  };
}

export function bridgeManifestsEqual(left: BridgeManifest, right: BridgeManifest): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

type JsonFileReader = {
  readFileSync(path: string, encoding: string): string;
};

export function loadBridgeConfigFromEnv(
  env: Record<string, string | undefined>,
  fs: JsonFileReader,
): LoadedBridgeConfig {
  const bridgeManifestPath = env.BRIDGE_MANIFEST_PATH;
  const explicitHandlerPath = env.HANDLER_JSON_PATH;

  // Startup must have a single source of truth. If both are set, we stop early
  // instead of guessing which deployment description should win.
  if (bridgeManifestPath && explicitHandlerPath) {
    throw new Error('BRIDGE_MANIFEST_PATH and HANDLER_JSON_PATH are mutually exclusive; set only one startup source');
  }

  const cardanoNetworkMagic = Number(env.CARDANO_CHAIN_NETWORK_MAGIC || 42);
  const cardano = {
    chain_id: env.CARDANO_CHAIN_ID || 'cardano-devnet',
    network_magic: cardanoNetworkMagic,
    network: deriveCardanoNetwork(cardanoNetworkMagic),
  };

  if (bridgeManifestPath) {
    const manifestJson = JSON.parse(fs.readFileSync(bridgeManifestPath, 'utf8'));
    return normalizeBridgeManifestConfig(manifestJson);
  }

  // The deployment JSON remains the local/devnet default until manifest-based
  // startup becomes the universal operator path.
  const handlerJson = JSON.parse(fs.readFileSync(explicitHandlerPath || DEFAULT_HANDLER_JSON_PATH, 'utf8'));
  return normalizeHandlerJsonDeploymentConfig(handlerJson, cardano);
}
