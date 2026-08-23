import { blake2b } from '@noble/hashes/blake2b';
import { Data, fromHex, fromText, getAddressDetails, toHex, validatorToScriptHash } from '@lucid-evolution/lucid';

type RefUtxo = {
  txHash: string;
  outputIndex: number;
  scriptHash?: string;
};

const EMPTY_REFERENCE_SCRIPT_INVENTORY_ROOT = '00'.repeat(32);
const REFERENCE_SCRIPT_INVENTORY_DOMAIN = fromText('ibc-reference-script-v1');
const MAX_REFERENCE_SCRIPT_INVENTORY_SIZE = 128;
const ReferenceScriptIdentitySchema = Data.Object({
  output_reference: Data.Object({
    transaction_id: Data.Bytes(),
    output_index: Data.Integer(),
  }),
  reference_script_hash: Data.Bytes(),
});

function compareReferenceScriptEntries(left: RefUtxo, right: RefUtxo): number {
  if (left.txHash < right.txHash) return -1;
  if (left.txHash > right.txHash) return 1;
  return left.outputIndex - right.outputIndex;
}

export function computeReferenceScriptInventoryRoot(references: RefUtxo[]): string {
  let root = EMPTY_REFERENCE_SCRIPT_INVENTORY_ROOT;
  for (const [index, reference] of references.entries()) {
    assert(
      /^[0-9a-f]{64}$/.test(reference.txHash),
      `Invalid bridge config: "referenceOutRefs[${index}].txHash" must be 32-byte lowercase hex`,
    );
    assert(
      /^[0-9a-f]{56}$/.test(reference.scriptHash ?? ''),
      `Invalid bridge config: "referenceOutRefs[${index}].scriptHash" must be 28-byte lowercase hex`,
    );
    // Aiken's on-chain `cbor.serialise` uses indefinite constructor arrays.
    // Lucid's non-canonical mode emits that exact deterministic PlutusData form.
    const identityCbor = Data.to(
      {
        output_reference: {
          transaction_id: reference.txHash,
          output_index: BigInt(reference.outputIndex),
        },
        reference_script_hash: reference.scriptHash,
      },
      ReferenceScriptIdentitySchema as any,
      { canonical: false },
    );
    root = toHex(
      blake2b(fromHex(REFERENCE_SCRIPT_INVENTORY_DOMAIN + root + identityCbor), {
        dkLen: 32,
      }),
    );
  }
  return root;
}

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

type DeploymentReferenceValidator = {
  script: string;
  scriptHash: string;
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
    prune_packet_history: DeploymentRefValidator;
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

export type DeploymentConfig = {
  schemaVersion: 6;
  deployedAt: string;
  referenceOutRefs: RefUtxo[];
  referenceScriptInventoryRoot: string;
  referenceValidator: DeploymentReferenceValidator;
  hostStateNFT: AuthToken & { script: string };
  validators: {
    hostStateStt: DeploymentValidator;
    spendClient: DeploymentValidator;
    spendConnection: DeploymentValidator;
    spendChannel: DeploymentSpendChannelValidator;
    spendMockModule?: DeploymentValidator;
    spendTraceRegistry?: DeploymentValidator;
    spendTransferModule: DeploymentValidator;
    mintIdentifier: DeploymentValidator;
    verifyProof: DeploymentValidator;
    mintClientStt: DeploymentValidator;
    mintConnectionStt: DeploymentValidator;
    mintChannelStt: DeploymentValidator;
    mintLifecycleCreationMarker: DeploymentValidator;
    mintLifecycleReclamationMarker: DeploymentValidator;
    mintLifecycleOperationalMarker: DeploymentValidator;
    mintLifecyclePacketMarker: DeploymentValidator;
    mintVoucher: DeploymentValidator;
    mintTransferEscrowShard: DeploymentValidator;
    mintPort: DeploymentValidator;
    mintTraceRegistryBenchmarkVoucher?: DeploymentValidator;
    voucherMetadata?: DeploymentVoucherMetadata;
  };
  modules: {
    transfer: DeploymentModule;
    mock?: DeploymentModule;
    icq?: DeploymentModule;
  };
  traceRegistry?: DeploymentTraceRegistry;
};

type BridgeManifestRefUtxo = {
  tx_hash: string;
  output_index: number;
  script_hash?: string;
};

type BridgeManifestAuthToken = {
  policy_id: string;
  token_name: string;
  script: string;
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

type BridgeManifestReferenceValidator = {
  script: string;
  script_hash: string;
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
    prune_packet_history: BridgeManifestRefValidator;
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
  reference_out_refs: BridgeManifestRefUtxo[];
  reference_script_inventory_root: string;
  reference_validator: BridgeManifestReferenceValidator;
  validators: {
    host_state_stt: BridgeManifestValidator;
    spend_client: BridgeManifestValidator;
    spend_connection: BridgeManifestValidator;
    spend_channel: BridgeManifestSpendChannelValidator;
    spend_mock_module?: BridgeManifestValidator;
    spend_trace_registry?: BridgeManifestValidator;
    spend_transfer_module: BridgeManifestValidator;
    mint_identifier: BridgeManifestValidator;
    verify_proof: BridgeManifestValidator;
    mint_client_stt: BridgeManifestValidator;
    mint_connection_stt: BridgeManifestValidator;
    mint_channel_stt: BridgeManifestValidator;
    mint_lifecycle_creation_marker: BridgeManifestValidator;
    mint_lifecycle_reclamation_marker: BridgeManifestValidator;
    mint_lifecycle_operational_marker: BridgeManifestValidator;
    mint_lifecycle_packet_marker: BridgeManifestValidator;
    mint_voucher: BridgeManifestValidator;
    mint_transfer_escrow_shard: BridgeManifestValidator;
    mint_port: BridgeManifestValidator;
    mint_trace_registry_benchmark_voucher?: BridgeManifestValidator;
    // The runtime only needs the target script address for the immutable
    // CIP-68 metadata output. We intentionally do not expose ref_utxo or
    // script_hash here because they are not consumed after deployment.
    voucher_metadata?: BridgeManifestVoucherMetadata;
  };
  modules: {
    transfer: BridgeManifestModule;
    mock?: BridgeManifestModule;
    icq?: BridgeManifestModule;
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
  // JSON manifests use numbers, while generated protobuf decoders expose uint64 as bigint/string.
  let normalized: number | undefined;
  if (typeof value === 'number') {
    normalized = value;
  } else if (typeof value === 'bigint') {
    normalized = Number(value);
  } else if (typeof value === 'string' && /^\d+$/.test(value)) {
    normalized = Number(value);
  }
  assert(
    normalized !== undefined && Number.isSafeInteger(normalized) && normalized >= 0,
    `Invalid bridge config: "${path}" must be a non-negative integer`,
  );
  return normalized;
}

function requireIsoTimestamp(value: unknown, path: string): string {
  const timestamp = requireNonEmptyString(value, path);
  assert(!Number.isNaN(Date.parse(timestamp)), `Invalid bridge config: "${path}" must be an ISO-8601 timestamp`);
  return timestamp;
}

function requireInventoryRoot(value: unknown, path: string): string {
  const root = requireNonEmptyString(value, path);
  assert(/^[0-9a-f]{64}$/.test(root), `Invalid bridge config: "${path}" must be 32-byte lowercase hex`);
  return root;
}

function assertReferenceValidatorArtifact(
  artifact: DeploymentReferenceValidator,
  path: string,
): DeploymentReferenceValidator {
  let computedScriptHash: string;
  try {
    computedScriptHash = validatorToScriptHash({ type: 'PlutusV3', script: artifact.script });
  } catch {
    throw new Error(`Invalid bridge config: "${path}.script" must be a serialized Plutus V3 script`);
  }
  assert(
    computedScriptHash === artifact.scriptHash,
    `Invalid bridge config: "${path}.scriptHash" does not match its script`,
  );

  let paymentCredential;
  try {
    paymentCredential = getAddressDetails(artifact.address).paymentCredential;
  } catch {
    throw new Error(`Invalid bridge config: "${path}.address" must be a valid Cardano address`);
  }
  assert(
    paymentCredential?.type === 'Script' && paymentCredential.hash === artifact.scriptHash,
    `Invalid bridge config: "${path}.address" does not match its script hash`,
  );
  return artifact;
}

function requireDeploymentReferenceValidator(value: unknown, path: string): DeploymentReferenceValidator {
  const validator = requireObject(value, path);
  return assertReferenceValidatorArtifact(
    {
      script: requireNonEmptyString(validator.script, `${path}.script`),
      scriptHash: requireNonEmptyString(validator.scriptHash, `${path}.scriptHash`),
      address: requireNonEmptyString(validator.address, `${path}.address`),
    },
    path,
  );
}

function requireManifestReferenceValidator(value: unknown, path: string): BridgeManifestReferenceValidator {
  const validator = requireObject(value, path);
  const normalized = assertReferenceValidatorArtifact(
    {
      script: requireNonEmptyString(validator.script, `${path}.script`),
      scriptHash: requireNonEmptyString(validator.script_hash, `${path}.script_hash`),
      address: requireNonEmptyString(validator.address, `${path}.address`),
    },
    path,
  );
  return {
    script: normalized.script,
    script_hash: normalized.scriptHash,
    address: normalized.address,
  };
}

function requireRefUtxo(value: unknown, path: string): RefUtxo {
  const refUtxo = requireObject(value, path);
  return {
    txHash: requireNonEmptyString(refUtxo.txHash, `${path}.txHash`),
    outputIndex: requireNonNegativeInteger(refUtxo.outputIndex, `${path}.outputIndex`),
    ...(refUtxo.scriptHash === undefined
      ? {}
      : { scriptHash: requireNonEmptyString(refUtxo.scriptHash, `${path}.scriptHash`) }),
  };
}

function requireManifestRefUtxo(value: unknown, path: string): BridgeManifestRefUtxo {
  const refUtxo = requireObject(value, path);
  return {
    tx_hash: requireNonEmptyString(refUtxo.tx_hash, `${path}.tx_hash`),
    output_index: requireNonNegativeInteger(refUtxo.output_index, `${path}.output_index`),
    ...(refUtxo.script_hash === undefined
      ? {}
      : { script_hash: requireNonEmptyString(refUtxo.script_hash, `${path}.script_hash`) }),
  };
}

function requireReferenceOutRefs(value: unknown, path: string): RefUtxo[] {
  assert(Array.isArray(value) && value.length > 0, `Invalid bridge config: "${path}" must be a non-empty array`);
  assert(
    value.length <= MAX_REFERENCE_SCRIPT_INVENTORY_SIZE,
    `Invalid bridge config: "${path}" cannot contain more than ${MAX_REFERENCE_SCRIPT_INVENTORY_SIZE} outputs`,
  );
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const refUtxo = requireRefUtxo(entry, `${path}[${index}]`);
    assert(
      refUtxo.scriptHash !== undefined,
      `Invalid bridge config: "${path}[${index}].scriptHash" must be a non-empty string`,
    );
    const key = `${refUtxo.txHash}#${refUtxo.outputIndex}`;
    assert(!seen.has(key), `Invalid bridge config: "${path}" contains duplicate output ${key}`);
    seen.add(key);
    return refUtxo;
  });
}

function requireManifestReferenceOutRefs(value: unknown, path: string): BridgeManifestRefUtxo[] {
  assert(Array.isArray(value) && value.length > 0, `Invalid bridge config: "${path}" must be a non-empty array`);
  assert(
    value.length <= MAX_REFERENCE_SCRIPT_INVENTORY_SIZE,
    `Invalid bridge config: "${path}" cannot contain more than ${MAX_REFERENCE_SCRIPT_INVENTORY_SIZE} outputs`,
  );
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const refUtxo = requireManifestRefUtxo(entry, `${path}[${index}]`);
    assert(
      refUtxo.script_hash !== undefined,
      `Invalid bridge config: "${path}[${index}].script_hash" must be a non-empty string`,
    );
    const key = `${refUtxo.tx_hash}#${refUtxo.output_index}`;
    assert(!seen.has(key), `Invalid bridge config: "${path}" contains duplicate output ${key}`);
    seen.add(key);
    return refUtxo;
  });
}

function assertDeploymentReferenceInventory(deployment: DeploymentConfig): void {
  const inventory = new Map(
    deployment.referenceOutRefs.map((ref) => [`${ref.txHash}#${ref.outputIndex}`, ref.scriptHash]),
  );
  const discovered = new Set<string>();
  const scriptByReference = new Map<string, string>();
  const referenceByScript = new Map<string, string>();

  const visit = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.refUtxo && typeof record.scriptHash === 'string') {
      const refUtxo = record.refUtxo as RefUtxo;
      const key = `${refUtxo.txHash}#${refUtxo.outputIndex}`;
      const existingScript = scriptByReference.get(key);
      const existingReference = referenceByScript.get(record.scriptHash);
      assert(
        existingScript === undefined || existingScript === record.scriptHash,
        `Invalid bridge config: reference output ${key} is assigned to distinct script hashes`,
      );
      assert(
        existingReference === undefined || existingReference === key,
        `Invalid bridge config: script hash at "${path}" is assigned to distinct reference outputs`,
      );
      scriptByReference.set(key, record.scriptHash);
      referenceByScript.set(record.scriptHash, key);
      discovered.add(key);
    }
    Object.entries(record).forEach(([name, child]) => visit(child, `${path}.${name}`));
  };
  visit(deployment.validators, 'validators');

  const omitted = [...discovered].filter((key) => !inventory.has(key));
  const unbound = [...inventory.keys()].filter((key) => !discovered.has(key));
  const mismatched = [...scriptByReference].filter(([key, scriptHash]) => inventory.get(key) !== scriptHash);
  assert(
    omitted.length === 0 && unbound.length === 0 && mismatched.length === 0,
    `Invalid bridge config: reference inventory does not exactly match validator references ` +
      `(omitted=${omitted.join(',') || 'none'}, unbound=${unbound.join(',') || 'none'}, ` +
      `script-mismatch=${mismatched.map(([key]) => key).join(',') || 'none'})`,
  );
  const hostReference = deployment.validators.hostStateStt.refUtxo;
  const firstReference = deployment.referenceOutRefs[0];
  assert(
    firstReference.txHash === hostReference.txHash &&
      firstReference.outputIndex === hostReference.outputIndex &&
      firstReference.scriptHash === deployment.validators.hostStateStt.scriptHash,
    'Invalid bridge config: "referenceOutRefs[0]" must be the HostState reference script',
  );
  for (let index = 2; index < deployment.referenceOutRefs.length; index += 1) {
    assert(
      compareReferenceScriptEntries(deployment.referenceOutRefs[index - 1], deployment.referenceOutRefs[index]) < 0,
      'Invalid bridge config: non-HostState "referenceOutRefs" must be in canonical output-reference order',
    );
  }
  assert(
    computeReferenceScriptInventoryRoot(deployment.referenceOutRefs) === deployment.referenceScriptInventoryRoot,
    'Invalid bridge config: referenceScriptInventoryRoot does not match referenceOutRefs',
  );
}

function requireAuthToken(value: unknown, path: string): AuthToken {
  const authToken = requireObject(value, path);
  return {
    policyId: requireNonEmptyString(authToken.policyId, `${path}.policyId`),
    name: requireNonEmptyString(authToken.name, `${path}.name`),
  };
}

function requireHostStateNft(value: unknown, path: string): AuthToken & { script: string } {
  const authToken = requireObject(value, path);
  const normalized = {
    ...requireAuthToken(value, path),
    script: requireNonEmptyString(authToken.script, `${path}.script`),
  };
  let computedPolicyId: string;
  try {
    computedPolicyId = validatorToScriptHash({ type: 'PlutusV3', script: normalized.script });
  } catch {
    throw new Error(`Invalid bridge config: "${path}.script" must be a serialized Plutus V3 script`);
  }
  assert(
    computedPolicyId === normalized.policyId,
    `Invalid bridge config: "${path}.policyId" does not match its script`,
  );
  return normalized;
}

function requireManifestAuthToken(value: unknown, path: string): BridgeManifestAuthToken {
  const authToken = requireObject(value, path);
  const normalized = {
    policy_id: requireNonEmptyString(authToken.policy_id, `${path}.policy_id`),
    token_name: requireNonEmptyString(authToken.token_name, `${path}.token_name`),
    script: requireNonEmptyString(authToken.script, `${path}.script`),
  };
  let computedPolicyId: string;
  try {
    computedPolicyId = validatorToScriptHash({ type: 'PlutusV3', script: normalized.script });
  } catch {
    throw new Error(`Invalid bridge config: "${path}.script" must be a serialized Plutus V3 script`);
  }
  assert(
    computedPolicyId === normalized.policy_id,
    `Invalid bridge config: "${path}.policy_id" does not match its script`,
  );
  return normalized;
}

function assertValidatorAddressMatchesScriptHash(address: string, scriptHash: string, path: string): string {
  if (address.length === 0) {
    return address;
  }

  let paymentCredential;
  try {
    paymentCredential = getAddressDetails(address).paymentCredential;
  } catch {
    throw new Error(`Invalid bridge config: "${path}.address" must be a valid Cardano address`);
  }
  assert(
    paymentCredential?.type === 'Script' && paymentCredential.hash === scriptHash,
    `Invalid bridge config: "${path}.address" does not match its script hash`,
  );
  return address;
}

function requireDeploymentValidator(value: unknown, path: string, requiredAddress: boolean): DeploymentValidator {
  const validator = requireObject(value, path);
  const scriptHash = requireNonEmptyString(validator.scriptHash, `${path}.scriptHash`);
  const address = requiredAddress
    ? requireNonEmptyString(validator.address, `${path}.address`)
    : typeof validator.address === 'string'
      ? validator.address
      : '';
  return {
    scriptHash,
    address: assertValidatorAddressMatchesScriptHash(address, scriptHash, path),
    refUtxo: requireRefUtxo(validator.refUtxo, `${path}.refUtxo`),
  };
}

function requireManifestValidator(value: unknown, path: string, requiredAddress: boolean): BridgeManifestValidator {
  const validator = requireObject(value, path);
  const scriptHash = requireNonEmptyString(validator.script_hash, `${path}.script_hash`);
  const address = requiredAddress
    ? requireNonEmptyString(validator.address, `${path}.address`)
    : typeof validator.address === 'string'
      ? validator.address
      : '';
  return {
    script_hash: scriptHash,
    address: assertValidatorAddressMatchesScriptHash(address, scriptHash, path),
    ref_utxo: requireManifestRefUtxo(validator.ref_utxo, `${path}.ref_utxo`),
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
    ...requireDeploymentValidator(validator, path, true),
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
      prune_packet_history: requireDeploymentRefValidator(
        refValidator.prune_packet_history,
        `${path}.refValidator.prune_packet_history`,
      ),
      send_packet: requireDeploymentRefValidator(refValidator.send_packet, `${path}.refValidator.send_packet`),
      timeout_packet: requireDeploymentRefValidator(refValidator.timeout_packet, `${path}.refValidator.timeout_packet`),
    },
  };
}

function requireManifestSpendChannelValidator(value: unknown, path: string): BridgeManifestSpendChannelValidator {
  const validator = requireObject(value, path);
  const refValidator = requireObject(validator.ref_validator, `${path}.ref_validator`);

  return {
    ...requireManifestValidator(validator, path, true),
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
      prune_packet_history: requireManifestRefValidator(
        refValidator.prune_packet_history,
        `${path}.ref_validator.prune_packet_history`,
      ),
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

function assertDeploymentAddressBindings(deployment: DeploymentConfig): void {
  const assertModuleBinding = (
    moduleAddress: string,
    validator: DeploymentValidator | undefined,
    modulePath: string,
    validatorPath: string,
  ) => {
    assert(validator, `Invalid bridge config: "${validatorPath}" is required when "${modulePath}" is present`);
    assert(
      moduleAddress === validator.address,
      `Invalid bridge config: "${modulePath}.address" does not match "${validatorPath}.address"`,
    );
  };

  assertModuleBinding(
    deployment.modules.transfer.address,
    deployment.validators.spendTransferModule,
    'modules.transfer',
    'validators.spendTransferModule',
  );
  if (deployment.modules.mock) {
    assertModuleBinding(
      deployment.modules.mock.address,
      deployment.validators.spendMockModule,
      'modules.mock',
      'validators.spendMockModule',
    );
  }
  if (deployment.modules.icq) {
    assertModuleBinding(
      deployment.modules.icq.address,
      deployment.validators.spendMockModule,
      'modules.icq',
      'validators.spendMockModule',
    );
  }
  if (deployment.traceRegistry) {
    assertModuleBinding(
      deployment.traceRegistry.address,
      deployment.validators.spendTraceRegistry,
      'traceRegistry',
      'validators.spendTraceRegistry',
    );
  }
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

function deploymentAuthTokenToManifest(authToken: AuthToken & { script: string }): BridgeManifestAuthToken {
  return {
    policy_id: authToken.policyId,
    token_name: authToken.name,
    script: authToken.script,
  };
}

function manifestAuthTokenToDeployment(authToken: BridgeManifestAuthToken): AuthToken & { script: string } {
  return {
    policyId: authToken.policy_id,
    name: authToken.token_name,
    script: authToken.script,
  };
}

function deploymentRefUtxoToManifest(refUtxo: RefUtxo): BridgeManifestRefUtxo {
  return {
    tx_hash: refUtxo.txHash,
    output_index: refUtxo.outputIndex,
    ...(refUtxo.scriptHash === undefined ? {} : { script_hash: refUtxo.scriptHash }),
  };
}

function manifestRefUtxoToDeployment(refUtxo: BridgeManifestRefUtxo): RefUtxo {
  return {
    txHash: refUtxo.tx_hash,
    outputIndex: refUtxo.output_index,
    ...(refUtxo.script_hash === undefined ? {} : { scriptHash: refUtxo.script_hash }),
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

function deploymentReferenceValidatorToManifest(
  validator: DeploymentReferenceValidator,
): BridgeManifestReferenceValidator {
  return {
    script: validator.script,
    script_hash: validator.scriptHash,
    address: validator.address,
  };
}

function manifestReferenceValidatorToDeployment(
  validator: BridgeManifestReferenceValidator,
): DeploymentReferenceValidator {
  return {
    script: validator.script,
    scriptHash: validator.script_hash,
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
      prune_packet_history: deploymentRefValidatorToManifest(validator.refValidator.prune_packet_history),
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
      prune_packet_history: manifestRefValidatorToDeployment(validator.ref_validator.prune_packet_history),
      send_packet: manifestRefValidatorToDeployment(validator.ref_validator.send_packet),
      timeout_packet: manifestRefValidatorToDeployment(validator.ref_validator.timeout_packet),
    },
  };
}

export function requireSttDeploymentConfig(deployment: unknown): DeploymentConfig {
  const deploymentAny = requireObject(deployment, 'deployment');
  const validators = requireObject(deploymentAny.validators, 'validators');
  const modules = requireObject(deploymentAny.modules, 'modules');

  const normalized: DeploymentConfig = {
    schemaVersion: requireNonNegativeInteger(deploymentAny.schemaVersion, 'schemaVersion') as 6,
    deployedAt: requireIsoTimestamp(deploymentAny.deployedAt, 'deployedAt'),
    referenceOutRefs: requireReferenceOutRefs(deploymentAny.referenceOutRefs, 'referenceOutRefs'),
    referenceScriptInventoryRoot: requireInventoryRoot(
      deploymentAny.referenceScriptInventoryRoot,
      'referenceScriptInventoryRoot',
    ),
    referenceValidator: requireDeploymentReferenceValidator(deploymentAny.referenceValidator, 'referenceValidator'),
    hostStateNFT: requireHostStateNft(deploymentAny.hostStateNFT, 'hostStateNFT'),
    validators: {
      hostStateStt: requireDeploymentValidator(validators.hostStateStt, 'validators.hostStateStt', true),
      spendClient: requireDeploymentValidator(validators.spendClient, 'validators.spendClient', true),
      spendConnection: requireDeploymentValidator(validators.spendConnection, 'validators.spendConnection', true),
      spendChannel: requireDeploymentSpendChannelValidator(validators.spendChannel, 'validators.spendChannel'),
      ...(validators.spendMockModule
        ? {
            spendMockModule: requireDeploymentValidator(validators.spendMockModule, 'validators.spendMockModule', true),
          }
        : {}),
      ...(validators.spendTraceRegistry
        ? {
            spendTraceRegistry: requireDeploymentValidator(
              validators.spendTraceRegistry,
              'validators.spendTraceRegistry',
              true,
            ),
          }
        : {}),
      spendTransferModule: requireDeploymentValidator(
        validators.spendTransferModule,
        'validators.spendTransferModule',
        true,
      ),
      mintIdentifier: requireDeploymentValidator(validators.mintIdentifier, 'validators.mintIdentifier', false),
      verifyProof: requireDeploymentValidator(validators.verifyProof, 'validators.verifyProof', false),
      mintClientStt: requireDeploymentValidator(validators.mintClientStt, 'validators.mintClientStt', false),
      mintConnectionStt: requireDeploymentValidator(
        validators.mintConnectionStt,
        'validators.mintConnectionStt',
        false,
      ),
      mintChannelStt: requireDeploymentValidator(validators.mintChannelStt, 'validators.mintChannelStt', false),
      mintLifecycleCreationMarker: requireDeploymentValidator(
        validators.mintLifecycleCreationMarker,
        'validators.mintLifecycleCreationMarker',
        false,
      ),
      mintLifecycleReclamationMarker: requireDeploymentValidator(
        validators.mintLifecycleReclamationMarker,
        'validators.mintLifecycleReclamationMarker',
        false,
      ),
      mintLifecycleOperationalMarker: requireDeploymentValidator(
        validators.mintLifecycleOperationalMarker,
        'validators.mintLifecycleOperationalMarker',
        false,
      ),
      mintLifecyclePacketMarker: requireDeploymentValidator(
        validators.mintLifecyclePacketMarker,
        'validators.mintLifecyclePacketMarker',
        false,
      ),
      mintVoucher: requireDeploymentValidator(validators.mintVoucher, 'validators.mintVoucher', false),
      mintTransferEscrowShard: requireDeploymentValidator(
        validators.mintTransferEscrowShard,
        'validators.mintTransferEscrowShard',
        false,
      ),
      mintPort: requireDeploymentValidator(validators.mintPort, 'validators.mintPort', false),
      ...(validators.mintTraceRegistryBenchmarkVoucher
        ? {
            mintTraceRegistryBenchmarkVoucher: requireDeploymentValidator(
              validators.mintTraceRegistryBenchmarkVoucher,
              'validators.mintTraceRegistryBenchmarkVoucher',
              false,
            ),
          }
        : {}),
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
  };
  assertDeploymentAddressBindings(normalized);
  assertDeploymentReferenceInventory(normalized);
  return normalized;
}

export function normalizeHandlerJsonDeploymentConfig(
  deployment: unknown,
  cardano: BridgeManifestCardanoIdentity,
): LoadedBridgeConfig {
  const normalizedDeployment = requireSttDeploymentConfig(deployment);
  assert(normalizedDeployment.schemaVersion === 6, 'Invalid bridge config: "schemaVersion" must be 6');
  const normalizedCardano = requireCardanoIdentity(cardano);

  // Normalize deployment JSON once so both startup sources feed the same public
  // manifest and internal deployment object into the rest of the Gateway.
  return {
    deployment: normalizedDeployment,
    bridgeManifest: {
      schema_version: 6,
      deployment_id: buildDeploymentId(normalizedCardano, normalizedDeployment.hostStateNFT),
      deployed_at: normalizedDeployment.deployedAt,
      cardano: normalizedCardano,
      host_state_nft: deploymentAuthTokenToManifest(normalizedDeployment.hostStateNFT),
      reference_out_refs: normalizedDeployment.referenceOutRefs.map(deploymentRefUtxoToManifest),
      reference_script_inventory_root: normalizedDeployment.referenceScriptInventoryRoot,
      reference_validator: deploymentReferenceValidatorToManifest(normalizedDeployment.referenceValidator),
      validators: {
        host_state_stt: deploymentValidatorToManifest(normalizedDeployment.validators.hostStateStt),
        spend_client: deploymentValidatorToManifest(normalizedDeployment.validators.spendClient),
        spend_connection: deploymentValidatorToManifest(normalizedDeployment.validators.spendConnection),
        spend_channel: deploymentSpendChannelToManifest(normalizedDeployment.validators.spendChannel),
        ...(normalizedDeployment.validators.spendMockModule
          ? { spend_mock_module: deploymentValidatorToManifest(normalizedDeployment.validators.spendMockModule) }
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
        mint_lifecycle_creation_marker: deploymentValidatorToManifest(
          normalizedDeployment.validators.mintLifecycleCreationMarker,
        ),
        mint_lifecycle_reclamation_marker: deploymentValidatorToManifest(
          normalizedDeployment.validators.mintLifecycleReclamationMarker,
        ),
        mint_lifecycle_operational_marker: deploymentValidatorToManifest(
          normalizedDeployment.validators.mintLifecycleOperationalMarker,
        ),
        mint_lifecycle_packet_marker: deploymentValidatorToManifest(
          normalizedDeployment.validators.mintLifecyclePacketMarker,
        ),
        mint_voucher: deploymentValidatorToManifest(normalizedDeployment.validators.mintVoucher),
        mint_transfer_escrow_shard: deploymentValidatorToManifest(
          normalizedDeployment.validators.mintTransferEscrowShard,
        ),
        mint_port: deploymentValidatorToManifest(normalizedDeployment.validators.mintPort),
        ...(normalizedDeployment.validators.mintTraceRegistryBenchmarkVoucher
          ? {
              mint_trace_registry_benchmark_voucher: deploymentValidatorToManifest(
                normalizedDeployment.validators.mintTraceRegistryBenchmarkVoucher,
              ),
            }
          : {}),
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
  const bridgeManifest: BridgeManifest = {
    schema_version: requireNonNegativeInteger(manifestAny.schema_version, 'schema_version'),
    deployment_id: requireNonEmptyString(manifestAny.deployment_id, 'deployment_id'),
    deployed_at: requireIsoTimestamp(manifestAny.deployed_at, 'deployed_at'),
    cardano: requireCardanoIdentity(
      requireObject(manifestAny.cardano, 'cardano') as unknown as BridgeManifestCardanoIdentity,
    ),
    host_state_nft: requireManifestAuthToken(manifestAny.host_state_nft, 'host_state_nft'),
    reference_out_refs: requireManifestReferenceOutRefs(manifestAny.reference_out_refs, 'reference_out_refs'),
    reference_script_inventory_root: requireInventoryRoot(
      manifestAny.reference_script_inventory_root,
      'reference_script_inventory_root',
    ),
    reference_validator: requireManifestReferenceValidator(manifestAny.reference_validator, 'reference_validator'),
    validators: {
      host_state_stt: requireManifestValidator(validators.host_state_stt, 'validators.host_state_stt', true),
      spend_client: requireManifestValidator(validators.spend_client, 'validators.spend_client', true),
      spend_connection: requireManifestValidator(validators.spend_connection, 'validators.spend_connection', true),
      spend_channel: requireManifestSpendChannelValidator(validators.spend_channel, 'validators.spend_channel'),
      ...(validators.spend_mock_module
        ? {
            spend_mock_module: requireManifestValidator(
              validators.spend_mock_module,
              'validators.spend_mock_module',
              true,
            ),
          }
        : {}),
      ...(validators.spend_trace_registry
        ? {
            spend_trace_registry: requireManifestValidator(
              validators.spend_trace_registry,
              'validators.spend_trace_registry',
              true,
            ),
          }
        : {}),
      spend_transfer_module: requireManifestValidator(
        validators.spend_transfer_module,
        'validators.spend_transfer_module',
        true,
      ),
      mint_identifier: requireManifestValidator(validators.mint_identifier, 'validators.mint_identifier', false),
      verify_proof: requireManifestValidator(validators.verify_proof, 'validators.verify_proof', false),
      mint_client_stt: requireManifestValidator(validators.mint_client_stt, 'validators.mint_client_stt', false),
      mint_connection_stt: requireManifestValidator(
        validators.mint_connection_stt,
        'validators.mint_connection_stt',
        false,
      ),
      mint_channel_stt: requireManifestValidator(validators.mint_channel_stt, 'validators.mint_channel_stt', false),
      mint_lifecycle_creation_marker: requireManifestValidator(
        validators.mint_lifecycle_creation_marker,
        'validators.mint_lifecycle_creation_marker',
        false,
      ),
      mint_lifecycle_reclamation_marker: requireManifestValidator(
        validators.mint_lifecycle_reclamation_marker,
        'validators.mint_lifecycle_reclamation_marker',
        false,
      ),
      mint_lifecycle_operational_marker: requireManifestValidator(
        validators.mint_lifecycle_operational_marker,
        'validators.mint_lifecycle_operational_marker',
        false,
      ),
      mint_lifecycle_packet_marker: requireManifestValidator(
        validators.mint_lifecycle_packet_marker,
        'validators.mint_lifecycle_packet_marker',
        false,
      ),
      mint_voucher: requireManifestValidator(validators.mint_voucher, 'validators.mint_voucher', false),
      mint_transfer_escrow_shard: requireManifestValidator(
        validators.mint_transfer_escrow_shard,
        'validators.mint_transfer_escrow_shard',
        false,
      ),
      mint_port: requireManifestValidator(validators.mint_port, 'validators.mint_port', false),
      ...(validators.mint_trace_registry_benchmark_voucher
        ? {
            mint_trace_registry_benchmark_voucher: requireManifestValidator(
              validators.mint_trace_registry_benchmark_voucher,
              'validators.mint_trace_registry_benchmark_voucher',
              false,
            ),
          }
        : {}),
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
  };

  assert(bridgeManifest.schema_version === 6, 'Invalid bridge config: "schema_version" must be 6');

  const deployment: DeploymentConfig = {
    schemaVersion: 6,
    deployedAt: bridgeManifest.deployed_at,
    referenceOutRefs: bridgeManifest.reference_out_refs.map(manifestRefUtxoToDeployment),
    referenceScriptInventoryRoot: bridgeManifest.reference_script_inventory_root,
    referenceValidator: manifestReferenceValidatorToDeployment(bridgeManifest.reference_validator),
    hostStateNFT: manifestAuthTokenToDeployment(bridgeManifest.host_state_nft),
    validators: {
      hostStateStt: manifestValidatorToDeployment(bridgeManifest.validators.host_state_stt),
      spendClient: manifestValidatorToDeployment(bridgeManifest.validators.spend_client),
      spendConnection: manifestValidatorToDeployment(bridgeManifest.validators.spend_connection),
      spendChannel: manifestSpendChannelToDeployment(bridgeManifest.validators.spend_channel),
      ...(bridgeManifest.validators.spend_mock_module
        ? { spendMockModule: manifestValidatorToDeployment(bridgeManifest.validators.spend_mock_module) }
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
      mintLifecycleCreationMarker: manifestValidatorToDeployment(
        bridgeManifest.validators.mint_lifecycle_creation_marker,
      ),
      mintLifecycleReclamationMarker: manifestValidatorToDeployment(
        bridgeManifest.validators.mint_lifecycle_reclamation_marker,
      ),
      mintLifecycleOperationalMarker: manifestValidatorToDeployment(
        bridgeManifest.validators.mint_lifecycle_operational_marker,
      ),
      mintLifecyclePacketMarker: manifestValidatorToDeployment(bridgeManifest.validators.mint_lifecycle_packet_marker),
      mintVoucher: manifestValidatorToDeployment(bridgeManifest.validators.mint_voucher),
      mintTransferEscrowShard: manifestValidatorToDeployment(bridgeManifest.validators.mint_transfer_escrow_shard),
      mintPort: manifestValidatorToDeployment(bridgeManifest.validators.mint_port),
      ...(bridgeManifest.validators.mint_trace_registry_benchmark_voucher
        ? {
            mintTraceRegistryBenchmarkVoucher: manifestValidatorToDeployment(
              bridgeManifest.validators.mint_trace_registry_benchmark_voucher,
            ),
          }
        : {}),
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
  };
  assertDeploymentAddressBindings(deployment);
  assertDeploymentReferenceInventory(deployment);
  return {
    bridgeManifest,
    deployment,
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
