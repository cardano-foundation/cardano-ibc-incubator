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
  index: number;
  policyId: string;
  name: string;
};

type DeploymentTraceRegistry = {
  address: string;
  shardPolicyId: string;
  shards: DeploymentTraceRegistryShard[];
};

// The rest of the Gateway still consumes the historic camelCase deployment shape
// loaded from handler.json. We keep that internal model intact and translate it
// to/from the public manifest shape at the config boundary.
export type DeploymentConfig = {
  hostStateNFT: AuthToken;
  handlerAuthToken: AuthToken;
  validators: {
    hostStateStt: DeploymentValidator;
    spendHandler: DeploymentValidator;
    spendClient: DeploymentValidator;
    spendConnection: DeploymentValidator;
    spendChannel: DeploymentSpendChannelValidator;
    spendTraceRegistry?: DeploymentValidator;
    spendTransferModule: DeploymentValidator;
    verifyProof: DeploymentValidator;
    mintClientStt: DeploymentValidator;
    mintConnectionStt: DeploymentValidator;
    mintChannelStt: DeploymentValidator;
    mintVoucher: DeploymentValidator;
  };
  modules: {
    handler: DeploymentModule;
    transfer: DeploymentModule;
    mock?: DeploymentModule;
  };
  traceRegistry?: DeploymentTraceRegistry;
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
  index: number;
  policy_id: string;
  token_name: string;
};

type BridgeManifestTraceRegistry = {
  address: string;
  shard_policy_id: string;
  shards: BridgeManifestTraceRegistryShard[];
};

// The manifest is the public, deployment-stable bootstrap document we expose to
// external operators. It intentionally uses snake_case and only includes the
// on-chain facts another Gateway/relayer stack needs to reconnect to this bridge.
export type BridgeManifest = {
  schema_version: number;
  deployment_id: string;
  cardano: {
    chain_id: string;
    network_magic: number;
    network: string;
  };
  host_state_nft: BridgeManifestAuthToken;
  handler_auth_token: BridgeManifestAuthToken;
  validators: {
    host_state_stt: BridgeManifestValidator;
    spend_handler: BridgeManifestValidator;
    spend_client: BridgeManifestValidator;
    spend_connection: BridgeManifestValidator;
    spend_channel: BridgeManifestSpendChannelValidator;
    spend_trace_registry?: BridgeManifestValidator;
    spend_transfer_module: BridgeManifestValidator;
    verify_proof: BridgeManifestValidator;
    mint_client_stt: BridgeManifestValidator;
    mint_connection_stt: BridgeManifestValidator;
    mint_channel_stt: BridgeManifestValidator;
    mint_voucher: BridgeManifestValidator;
  };
  modules: {
    handler: BridgeManifestModule;
    transfer: BridgeManifestModule;
    mock?: BridgeManifestModule;
  };
  trace_registry?: BridgeManifestTraceRegistry;
};

export type BridgeManifestCardanoIdentity = BridgeManifest['cardano'];

export type LoadedBridgeConfig = {
  deployment: DeploymentConfig;
  bridgeManifest: BridgeManifest;
};

export const DEFAULT_HANDLER_JSON_PATH = '../deployment/offchain/handler.json';

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
      chan_close_init: requireDeploymentRefValidator(refValidator.chan_close_init, `${path}.refValidator.chan_close_init`),
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
      chan_close_init: requireManifestRefValidator(refValidator.chan_close_init, `${path}.ref_validator.chan_close_init`),
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
  const shards = traceRegistry.shards;
  assert(Array.isArray(shards), `Invalid bridge config: "${path}.shards" must be an array`);

  return {
    address: requireNonEmptyString(traceRegistry.address, `${path}.address`),
    shardPolicyId: requireNonEmptyString(traceRegistry.shardPolicyId, `${path}.shardPolicyId`),
    shards: shards.map((shard, index) => {
      const shardObject = requireObject(shard, `${path}.shards[${index}]`);
      return {
        index: requireNonNegativeInteger(shardObject.index, `${path}.shards[${index}].index`),
        policyId: requireNonEmptyString(shardObject.policyId, `${path}.shards[${index}].policyId`),
        name: requireNonEmptyString(shardObject.name, `${path}.shards[${index}].name`),
      };
    }),
  };
}

function requireManifestTraceRegistry(value: unknown, path: string): BridgeManifestTraceRegistry {
  const traceRegistry = requireObject(value, path);
  const shards = traceRegistry.shards;
  assert(Array.isArray(shards), `Invalid bridge config: "${path}.shards" must be an array`);

  return {
    address: requireNonEmptyString(traceRegistry.address, `${path}.address`),
    shard_policy_id: requireNonEmptyString(traceRegistry.shard_policy_id, `${path}.shard_policy_id`),
    shards: shards.map((shard, index) => {
      const shardObject = requireObject(shard, `${path}.shards[${index}]`);
      return {
        index: requireNonNegativeInteger(shardObject.index, `${path}.shards[${index}].index`),
        policy_id: requireNonEmptyString(shardObject.policy_id, `${path}.shards[${index}].policy_id`),
        token_name: requireNonEmptyString(shardObject.token_name, `${path}.shards[${index}].token_name`),
      };
    }),
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
    shards: traceRegistry.shards.map((shard) => ({
      index: shard.index,
      policy_id: shard.policyId,
      token_name: shard.name,
    })),
  };
}

function manifestTraceRegistryToDeployment(traceRegistry: BridgeManifestTraceRegistry): DeploymentTraceRegistry {
  return {
    address: traceRegistry.address,
    shardPolicyId: traceRegistry.shard_policy_id,
    shards: traceRegistry.shards.map((shard) => ({
      index: shard.index,
      policyId: shard.policy_id,
      name: shard.token_name,
    })),
  };
}

function deploymentSpendChannelToManifest(validator: DeploymentSpendChannelValidator): BridgeManifestSpendChannelValidator {
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

function manifestSpendChannelToDeployment(validator: BridgeManifestSpendChannelValidator): DeploymentSpendChannelValidator {
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
    hostStateNFT: requireAuthToken(deploymentAny.hostStateNFT, 'hostStateNFT'),
    handlerAuthToken: requireAuthToken(deploymentAny.handlerAuthToken, 'handlerAuthToken'),
    validators: {
      hostStateStt: requireDeploymentValidator(validators.hostStateStt, 'validators.hostStateStt'),
      spendHandler: requireDeploymentValidator(validators.spendHandler, 'validators.spendHandler'),
      spendClient: requireDeploymentValidator(validators.spendClient, 'validators.spendClient'),
      spendConnection: requireDeploymentValidator(validators.spendConnection, 'validators.spendConnection'),
      spendChannel: requireDeploymentSpendChannelValidator(validators.spendChannel, 'validators.spendChannel'),
      ...(validators.spendTraceRegistry
        ? { spendTraceRegistry: requireDeploymentValidator(validators.spendTraceRegistry, 'validators.spendTraceRegistry') }
        : {}),
      spendTransferModule: requireDeploymentValidator(validators.spendTransferModule, 'validators.spendTransferModule'),
      verifyProof: requireDeploymentValidator(validators.verifyProof, 'validators.verifyProof'),
      mintClientStt: requireDeploymentValidator(validators.mintClientStt, 'validators.mintClientStt'),
      mintConnectionStt: requireDeploymentValidator(validators.mintConnectionStt, 'validators.mintConnectionStt'),
      mintChannelStt: requireDeploymentValidator(validators.mintChannelStt, 'validators.mintChannelStt'),
      mintVoucher: requireDeploymentValidator(validators.mintVoucher, 'validators.mintVoucher'),
    },
    modules: {
      handler: requireDeploymentModule(modules.handler, 'modules.handler'),
      transfer: requireDeploymentModule(modules.transfer, 'modules.transfer'),
      ...(modules.mock ? { mock: requireDeploymentModule(modules.mock, 'modules.mock') } : {}),
    },
    ...(deploymentAny.traceRegistry
      ? { traceRegistry: requireDeploymentTraceRegistry(deploymentAny.traceRegistry, 'traceRegistry') }
      : {}),
  };
}

export function normalizeHandlerJsonDeploymentConfig(
  deployment: unknown,
  cardano: BridgeManifestCardanoIdentity,
): LoadedBridgeConfig {
  const normalizedDeployment = requireSttDeploymentConfig(deployment);
  const normalizedCardano = requireCardanoIdentity(cardano);

  // handler.json is the current internal deploy output today. We normalize
  // it once here so both startup sources feed the same public manifest and the
  // same internal deployment object into the rest of the Gateway.
  return {
    deployment: normalizedDeployment,
    bridgeManifest: {
      schema_version: 1,
      deployment_id: buildDeploymentId(normalizedCardano, normalizedDeployment.hostStateNFT),
      cardano: normalizedCardano,
      host_state_nft: deploymentAuthTokenToManifest(normalizedDeployment.hostStateNFT),
      handler_auth_token: deploymentAuthTokenToManifest(normalizedDeployment.handlerAuthToken),
      validators: {
        host_state_stt: deploymentValidatorToManifest(normalizedDeployment.validators.hostStateStt),
        spend_handler: deploymentValidatorToManifest(normalizedDeployment.validators.spendHandler),
        spend_client: deploymentValidatorToManifest(normalizedDeployment.validators.spendClient),
        spend_connection: deploymentValidatorToManifest(normalizedDeployment.validators.spendConnection),
        spend_channel: deploymentSpendChannelToManifest(normalizedDeployment.validators.spendChannel),
        ...(normalizedDeployment.validators.spendTraceRegistry
          ? {
              spend_trace_registry: deploymentValidatorToManifest(normalizedDeployment.validators.spendTraceRegistry),
            }
          : {}),
        spend_transfer_module: deploymentValidatorToManifest(normalizedDeployment.validators.spendTransferModule),
        verify_proof: deploymentValidatorToManifest(normalizedDeployment.validators.verifyProof),
        mint_client_stt: deploymentValidatorToManifest(normalizedDeployment.validators.mintClientStt),
        mint_connection_stt: deploymentValidatorToManifest(normalizedDeployment.validators.mintConnectionStt),
        mint_channel_stt: deploymentValidatorToManifest(normalizedDeployment.validators.mintChannelStt),
        mint_voucher: deploymentValidatorToManifest(normalizedDeployment.validators.mintVoucher),
      },
      modules: {
        handler: normalizedDeployment.modules.handler,
        transfer: normalizedDeployment.modules.transfer,
        ...(normalizedDeployment.modules.mock ? { mock: normalizedDeployment.modules.mock } : {}),
      },
      ...(normalizedDeployment.traceRegistry
        ? { trace_registry: deploymentTraceRegistryToManifest(normalizedDeployment.traceRegistry) }
        : {}),
    },
  };
}

export function normalizeBridgeManifestConfig(manifest: unknown): LoadedBridgeConfig {
  const manifestAny = requireObject(manifest, 'bridgeManifest');
  const validators = requireObject(manifestAny.validators, 'validators');
  const modules = requireObject(manifestAny.modules, 'modules');

  // Manifest startup is the inverse path: validate the public document, then
  // rebuild the internal deployment shape so downstream Gateway code stays
  // unaware of whether startup came from handler.json or a manifest file.
  const bridgeManifest: BridgeManifest = {
    schema_version: requireNonNegativeInteger(manifestAny.schema_version, 'schema_version'),
    deployment_id: requireNonEmptyString(manifestAny.deployment_id, 'deployment_id'),
    cardano: requireCardanoIdentity(requireObject(manifestAny.cardano, 'cardano') as unknown as BridgeManifestCardanoIdentity),
    host_state_nft: requireManifestAuthToken(manifestAny.host_state_nft, 'host_state_nft'),
    handler_auth_token: requireManifestAuthToken(manifestAny.handler_auth_token, 'handler_auth_token'),
    validators: {
      host_state_stt: requireManifestValidator(validators.host_state_stt, 'validators.host_state_stt'),
      spend_handler: requireManifestValidator(validators.spend_handler, 'validators.spend_handler'),
      spend_client: requireManifestValidator(validators.spend_client, 'validators.spend_client'),
      spend_connection: requireManifestValidator(validators.spend_connection, 'validators.spend_connection'),
      spend_channel: requireManifestSpendChannelValidator(validators.spend_channel, 'validators.spend_channel'),
      ...(validators.spend_trace_registry
        ? {
            spend_trace_registry: requireManifestValidator(
              validators.spend_trace_registry,
              'validators.spend_trace_registry',
            ),
          }
        : {}),
      spend_transfer_module: requireManifestValidator(validators.spend_transfer_module, 'validators.spend_transfer_module'),
      verify_proof: requireManifestValidator(validators.verify_proof, 'validators.verify_proof'),
      mint_client_stt: requireManifestValidator(validators.mint_client_stt, 'validators.mint_client_stt'),
      mint_connection_stt: requireManifestValidator(validators.mint_connection_stt, 'validators.mint_connection_stt'),
      mint_channel_stt: requireManifestValidator(validators.mint_channel_stt, 'validators.mint_channel_stt'),
      mint_voucher: requireManifestValidator(validators.mint_voucher, 'validators.mint_voucher'),
    },
    modules: {
      handler: requireManifestModule(modules.handler, 'modules.handler'),
      transfer: requireManifestModule(modules.transfer, 'modules.transfer'),
      ...(modules.mock ? { mock: requireManifestModule(modules.mock, 'modules.mock') } : {}),
    },
    ...(manifestAny.trace_registry
      ? { trace_registry: requireManifestTraceRegistry(manifestAny.trace_registry, 'trace_registry') }
      : {}),
  };

  assert(bridgeManifest.schema_version === 1, 'Invalid bridge config: "schema_version" must be 1');

  return {
    bridgeManifest,
    deployment: {
      hostStateNFT: manifestAuthTokenToDeployment(bridgeManifest.host_state_nft),
      handlerAuthToken: manifestAuthTokenToDeployment(bridgeManifest.handler_auth_token),
      validators: {
        hostStateStt: manifestValidatorToDeployment(bridgeManifest.validators.host_state_stt),
        spendHandler: manifestValidatorToDeployment(bridgeManifest.validators.spend_handler),
        spendClient: manifestValidatorToDeployment(bridgeManifest.validators.spend_client),
        spendConnection: manifestValidatorToDeployment(bridgeManifest.validators.spend_connection),
        spendChannel: manifestSpendChannelToDeployment(bridgeManifest.validators.spend_channel),
        ...(bridgeManifest.validators.spend_trace_registry
          ? {
              spendTraceRegistry: manifestValidatorToDeployment(bridgeManifest.validators.spend_trace_registry),
            }
          : {}),
        spendTransferModule: manifestValidatorToDeployment(bridgeManifest.validators.spend_transfer_module),
        verifyProof: manifestValidatorToDeployment(bridgeManifest.validators.verify_proof),
        mintClientStt: manifestValidatorToDeployment(bridgeManifest.validators.mint_client_stt),
        mintConnectionStt: manifestValidatorToDeployment(bridgeManifest.validators.mint_connection_stt),
        mintChannelStt: manifestValidatorToDeployment(bridgeManifest.validators.mint_channel_stt),
        mintVoucher: manifestValidatorToDeployment(bridgeManifest.validators.mint_voucher),
      },
      modules: {
        handler: requireDeploymentModule(bridgeManifest.modules.handler, 'modules.handler'),
        transfer: requireDeploymentModule(bridgeManifest.modules.transfer, 'modules.transfer'),
        ...(bridgeManifest.modules.mock ? { mock: requireDeploymentModule(bridgeManifest.modules.mock, 'modules.mock') } : {}),
      },
      ...(bridgeManifest.trace_registry
        ? { traceRegistry: manifestTraceRegistryToDeployment(bridgeManifest.trace_registry) }
        : {}),
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
    throw new Error(
      'BRIDGE_MANIFEST_PATH and HANDLER_JSON_PATH are mutually exclusive; set only one startup source',
    );
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

  // handler.json remains the default so existing local/devnet flows keep
  // working until manifest-based startup becomes the universal operator path.
  const handlerJson = JSON.parse(fs.readFileSync(explicitHandlerPath || DEFAULT_HANDLER_JSON_PATH, 'utf8'));
  return normalizeHandlerJsonDeploymentConfig(handlerJson, cardano);
}
