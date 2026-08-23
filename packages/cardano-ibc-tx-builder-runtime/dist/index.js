"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OGMIOS_WEBSOCKET_REQUEST_TIMEOUT_MS = exports.OGMIOS_PROTOCOL_PARAMETERS_REQUEST_TIMEOUT_MS = exports.computeRootWithOrderedUpdates = exports.transferEscrowShardTokenName = exports.transferEscrowShardCountValue = exports.transferEscrowShardChannelLiveCountKey = exports.proveTransferChannelHasNoLiveShards = exports.prepareTransferEscrowShardRetirement = exports.TRANSFER_ESCROW_SHARD_RETIRED_VALUE = exports.TRANSFER_ESCROW_SHARD_LIVE_VALUE = exports.AsyncMutex = void 0;
exports.computeReferenceScriptInventoryRoot = computeReferenceScriptInventoryRoot;
exports.withKupoStringQuantityHeader = withKupoStringQuantityHeader;
exports.normalizeBridgeManifest = normalizeBridgeManifest;
exports.ogmiosRequest = ogmiosRequest;
exports.mapOgmiosProtocolParameters = mapOgmiosProtocolParameters;
exports.queryProtocolParametersCompat = queryProtocolParametersCompat;
exports.retryWithBackoff = retryWithBackoff;
exports.createTxBuilderRuntime = createTxBuilderRuntime;
const crypto_1 = __importDefault(require("crypto"));
const lucid_1 = require("@lucid-evolution/lucid");
const blake2b_1 = require("@noble/hashes/blake2b");
const tx_builder_1 = require("@cardano-ibc/tx-builder");
const trace_registry_1 = require("@cardano-ibc/trace-registry");
const ws_1 = __importDefault(require("ws"));
const asyncMutex_1 = require("./asyncMutex");
const ibcStateRoot_1 = require("./ibcStateRoot");
const lucidIbcAdapter_1 = require("./lucidIbcAdapter");
const kupoHistory_1 = require("./kupoHistory");
const transferEscrowShard_1 = require("./transferEscrowShard");
var asyncMutex_2 = require("./asyncMutex");
Object.defineProperty(exports, "AsyncMutex", { enumerable: true, get: function () { return asyncMutex_2.AsyncMutex; } });
var transferEscrowShard_2 = require("./transferEscrowShard");
Object.defineProperty(exports, "TRANSFER_ESCROW_SHARD_LIVE_VALUE", { enumerable: true, get: function () { return transferEscrowShard_2.TRANSFER_ESCROW_SHARD_LIVE_VALUE; } });
Object.defineProperty(exports, "TRANSFER_ESCROW_SHARD_RETIRED_VALUE", { enumerable: true, get: function () { return transferEscrowShard_2.TRANSFER_ESCROW_SHARD_RETIRED_VALUE; } });
Object.defineProperty(exports, "prepareTransferEscrowShardRetirement", { enumerable: true, get: function () { return transferEscrowShard_2.prepareTransferEscrowShardRetirement; } });
Object.defineProperty(exports, "proveTransferChannelHasNoLiveShards", { enumerable: true, get: function () { return transferEscrowShard_2.proveTransferChannelHasNoLiveShards; } });
Object.defineProperty(exports, "transferEscrowShardChannelLiveCountKey", { enumerable: true, get: function () { return transferEscrowShard_2.transferEscrowShardChannelLiveCountKey; } });
Object.defineProperty(exports, "transferEscrowShardCountValue", { enumerable: true, get: function () { return transferEscrowShard_2.transferEscrowShardCountValue; } });
Object.defineProperty(exports, "transferEscrowShardTokenName", { enumerable: true, get: function () { return transferEscrowShard_2.transferEscrowShardTokenName; } });
var ibcStateRoot_2 = require("./ibcStateRoot");
Object.defineProperty(exports, "computeRootWithOrderedUpdates", { enumerable: true, get: function () { return ibcStateRoot_2.computeRootWithOrderedUpdates; } });
const LOOKUP_RETRY_OPTIONS = {
    maxAttempts: 6,
    retryDelayMs: 1000,
};
const TRANSACTION_TIME_TO_LIVE = 10 * 60 * 1000;
// Browser wallets should not need the gateway relayer's conservative 20 ADA floor.
// Lucid still raises this when protocol collateral requirements exceed the floor.
const TRANSACTION_SET_COLLATERAL = BigInt(5_000_000);
const MAX_SAFE_COST_MODEL_VALUE = Number.MAX_SAFE_INTEGER;
exports.OGMIOS_PROTOCOL_PARAMETERS_REQUEST_TIMEOUT_MS = 10_000;
exports.OGMIOS_WEBSOCKET_REQUEST_TIMEOUT_MS = 10_000;
const PROTOCOL_PARAMETERS_MAX_ATTEMPTS = 5;
const PROTOCOL_PARAMETERS_BASE_DELAY_MS = 1000;
// Respect provider rate limits without allowing one response to stall startup indefinitely.
const PROTOCOL_PARAMETERS_RETRY_AFTER_MAX_MS = 60_000;
const TRANSIENT_STARTUP_ERROR_MARKERS = [
    'timeoutexception',
    'timeout',
    'timed out',
    'etimedout',
    'econnreset',
    'econnrefused',
    'requesterror',
    'request error',
    'transport error',
    'kupmioserror',
    'socket hang up',
    'network error',
    'fetch failed',
];
const EMPTY_REFERENCE_SCRIPT_INVENTORY_ROOT = '00'.repeat(32);
const REFERENCE_SCRIPT_INVENTORY_DOMAIN = (0, lucid_1.fromText)('ibc-reference-script-v1');
const MAX_REFERENCE_SCRIPT_INVENTORY_SIZE = 128;
const ReferenceScriptIdentitySchema = lucid_1.Data.Object({
    output_reference: lucid_1.Data.Object({
        transaction_id: lucid_1.Data.Bytes(),
        output_index: lucid_1.Data.Integer(),
    }),
    reference_script_hash: lucid_1.Data.Bytes(),
});
function compareReferenceScriptEntries(left, right) {
    if (left.txHash < right.txHash)
        return -1;
    if (left.txHash > right.txHash)
        return 1;
    return left.outputIndex - right.outputIndex;
}
function computeReferenceScriptInventoryRoot(references) {
    let root = EMPTY_REFERENCE_SCRIPT_INVENTORY_ROOT;
    for (const [index, reference] of references.entries()) {
        if (!/^[0-9a-f]{64}$/.test(reference.txHash)) {
            throw new Error(`Invalid bridge manifest: reference_out_refs[${index}].tx_hash must be 32-byte lowercase hex`);
        }
        if (!/^[0-9a-f]{56}$/.test(reference.scriptHash ?? '')) {
            throw new Error(`Invalid bridge manifest: reference_out_refs[${index}].script_hash must be 28-byte lowercase hex`);
        }
        // Match Aiken's deterministic `cbor.serialise` representation, whose
        // constructor field arrays are indefinite-length.
        const identityCbor = lucid_1.Data.to({
            output_reference: {
                transaction_id: reference.txHash,
                output_index: BigInt(reference.outputIndex),
            },
            reference_script_hash: reference.scriptHash,
        }, ReferenceScriptIdentitySchema, { canonical: false });
        root = (0, lucid_1.toHex)((0, blake2b_1.blake2b)((0, lucid_1.fromHex)(REFERENCE_SCRIPT_INVENTORY_DOMAIN + root + identityCbor), {
            dkLen: 32,
        }));
    }
    return root;
}
function withKupoStringQuantityHeader(headers) {
    const kupoHeader = Object.fromEntries(Object.entries(headers?.kupoHeader ?? {}).filter(([name]) => name.toLowerCase() !== 'accept'));
    kupoHeader.accept = 'application/json;asset-quantity=string';
    return {
        ...(headers ?? {}),
        kupoHeader,
    };
}
const LUCID_NETWORKS = ['Mainnet', 'Preprod', 'Preview', 'Custom'];
function defaultLogger(scope) {
    return {
        log: (...args) => console.log(`[${scope}]`, ...args),
        warn: (...args) => console.warn(`[${scope}]`, ...args),
        error: (...args) => console.error(`[${scope}]`, ...args),
    };
}
function startTimer() {
    return process.hrtime.bigint();
}
function elapsedMs(start) {
    const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
    return `${Math.round(elapsed)}ms`;
}
function normalizeCardanoNetwork(network) {
    const normalized = network.trim().toLowerCase();
    switch (normalized) {
        case 'mainnet':
            return 'Mainnet';
        case 'preprod':
            return 'Preprod';
        case 'preview':
            return 'Preview';
        case 'custom':
        case 'devnet':
        case 'cardano-devnet':
            return 'Custom';
        default:
            throw new Error(`Unsupported Cardano network "${network}" in bridge manifest. Expected one of ${LUCID_NETWORKS.join(', ')}.`);
    }
}
async function timed(logger, scope, label, operation) {
    const startedAt = startTimer();
    try {
        const result = await operation();
        logger.log(`${scope} ${label} completed in ${elapsedMs(startedAt)}`);
        return result;
    }
    catch (error) {
        logger.error(`${scope} ${label} failed in ${elapsedMs(startedAt)}`, error);
        throw error;
    }
}
function describeFetchFailure(error) {
    const cause = error instanceof Error ? error.cause : undefined;
    const causeRecord = typeof cause === 'object' && cause !== null ? cause : undefined;
    const code = typeof causeRecord?.code === 'string' ? causeRecord.code : undefined;
    const address = typeof causeRecord?.address === 'string' ? causeRecord.address : undefined;
    const port = typeof causeRecord?.port === 'string' || typeof causeRecord?.port === 'number' ? String(causeRecord.port) : undefined;
    const causeMessage = cause instanceof Error ? cause.message : undefined;
    if (code && address && port) {
        return `${code} while connecting to ${address}:${port}`;
    }
    if (code) {
        return causeMessage ? `${code}: ${causeMessage}` : code;
    }
    if (causeMessage) {
        return causeMessage;
    }
    if (error instanceof Error && error.message.trim()) {
        return error.message;
    }
    return String(error);
}
function mapRefUtxo(refUtxo) {
    const outputIndex = Number(refUtxo.output_index);
    if (!Number.isSafeInteger(outputIndex) || outputIndex < 0) {
        throw new Error('Invalid bridge manifest: ref_utxo.output_index must be a non-negative integer');
    }
    return {
        txHash: refUtxo.tx_hash,
        outputIndex,
        ...(refUtxo.script_hash === undefined ? {} : { scriptHash: refUtxo.script_hash }),
    };
}
function mapReferenceOutRefs(references) {
    if (!Array.isArray(references) || references.length === 0) {
        throw new Error('Invalid bridge manifest: reference_out_refs must be a non-empty array');
    }
    if (references.length > MAX_REFERENCE_SCRIPT_INVENTORY_SIZE) {
        throw new Error(`Invalid bridge manifest: reference_out_refs cannot contain more than ${MAX_REFERENCE_SCRIPT_INVENTORY_SIZE} outputs`);
    }
    const seen = new Set();
    return references.map((reference) => {
        const mapped = mapRefUtxo(reference);
        if (typeof mapped.scriptHash !== 'string' || mapped.scriptHash.length === 0) {
            throw new Error('Invalid bridge manifest: reference_out_refs[].script_hash is required');
        }
        const key = `${mapped.txHash}#${mapped.outputIndex}`;
        if (seen.has(key)) {
            throw new Error(`Invalid bridge manifest: reference_out_refs contains duplicate output ${key}`);
        }
        seen.add(key);
        return mapped;
    });
}
function mapReferenceValidator(validator) {
    if (!validator || typeof validator !== 'object') {
        throw new Error('Invalid bridge manifest: reference_validator is required');
    }
    if (typeof validator.script !== 'string' || validator.script.length === 0) {
        throw new Error('Invalid bridge manifest: reference_validator.script is required');
    }
    if (typeof validator.script_hash !== 'string' || validator.script_hash.length === 0) {
        throw new Error('Invalid bridge manifest: reference_validator.script_hash is required');
    }
    if (typeof validator.address !== 'string' || validator.address.length === 0) {
        throw new Error('Invalid bridge manifest: reference_validator.address is required');
    }
    let computedScriptHash;
    try {
        computedScriptHash = (0, lucid_1.validatorToScriptHash)({ type: 'PlutusV3', script: validator.script });
    }
    catch {
        throw new Error('Invalid bridge manifest: reference_validator.script must be a serialized Plutus V3 script');
    }
    if (computedScriptHash !== validator.script_hash) {
        throw new Error('Invalid bridge manifest: reference_validator.script_hash does not match its script');
    }
    let paymentCredential;
    try {
        paymentCredential = (0, lucid_1.getAddressDetails)(validator.address).paymentCredential;
    }
    catch {
        throw new Error('Invalid bridge manifest: reference_validator.address must be a valid Cardano address');
    }
    if (paymentCredential?.type !== 'Script' || paymentCredential.hash !== validator.script_hash) {
        throw new Error('Invalid bridge manifest: reference_validator.address does not match its script hash');
    }
    return {
        script: validator.script,
        scriptHash: validator.script_hash,
        address: validator.address,
    };
}
function assertManifestReferenceInventory(referenceOutRefs, validators) {
    const inventory = new Map(referenceOutRefs.map((ref) => [`${ref.txHash}#${ref.outputIndex}`, ref.scriptHash]));
    const discovered = new Set();
    const scriptByReference = new Map();
    const referenceByScript = new Map();
    const visit = (value) => {
        if (!value || typeof value !== 'object')
            return;
        const record = value;
        if (record.ref_utxo && typeof record.script_hash === 'string') {
            const ref = mapRefUtxo(record.ref_utxo);
            const key = `${ref.txHash}#${ref.outputIndex}`;
            const existingScript = scriptByReference.get(key);
            const existingReference = referenceByScript.get(record.script_hash);
            if (existingScript !== undefined && existingScript !== record.script_hash) {
                throw new Error(`Invalid bridge manifest: reference output ${key} has distinct script hashes`);
            }
            if (existingReference !== undefined && existingReference !== key) {
                throw new Error(`Invalid bridge manifest: script hash has distinct reference outputs`);
            }
            scriptByReference.set(key, record.script_hash);
            referenceByScript.set(record.script_hash, key);
            discovered.add(key);
        }
        Object.values(record).forEach(visit);
    };
    visit(validators);
    const omitted = [...discovered].filter((key) => !inventory.has(key));
    const unbound = [...inventory.keys()].filter((key) => !discovered.has(key));
    const mismatched = [...scriptByReference].filter(([key, scriptHash]) => inventory.get(key) !== scriptHash);
    if (omitted.length > 0 || unbound.length > 0 || mismatched.length > 0) {
        throw new Error(`Invalid bridge manifest: reference inventory does not exactly match validator references ` +
            `(omitted=${omitted.join(',') || 'none'}, unbound=${unbound.join(',') || 'none'}, ` +
            `script-mismatch=${mismatched.map(([key]) => key).join(',') || 'none'})`);
    }
    const validatorRecord = validators;
    const hostState = validatorRecord.host_state_stt;
    const hostReference = hostState?.ref_utxo ? mapRefUtxo(hostState.ref_utxo) : undefined;
    const firstReference = referenceOutRefs[0];
    if (!hostReference ||
        firstReference.txHash !== hostReference.txHash ||
        firstReference.outputIndex !== hostReference.outputIndex ||
        firstReference.scriptHash !== hostState?.script_hash) {
        throw new Error('Invalid bridge manifest: reference_out_refs[0] must be the HostState reference script');
    }
    for (let index = 2; index < referenceOutRefs.length; index += 1) {
        if (compareReferenceScriptEntries(referenceOutRefs[index - 1], referenceOutRefs[index]) >= 0) {
            throw new Error('Invalid bridge manifest: non-HostState reference_out_refs must be in canonical output-reference order');
        }
    }
}
function mapValidator(validator, label, requiredAddress) {
    if (!validator) {
        throw new Error(`Invalid bridge manifest: ${label} is required`);
    }
    const address = typeof validator.address === 'string' ? validator.address : '';
    if (requiredAddress && address.length === 0) {
        throw new Error(`Invalid bridge manifest: ${label}.address is required`);
    }
    if (address.length > 0) {
        let paymentCredential;
        try {
            paymentCredential = (0, lucid_1.getAddressDetails)(address).paymentCredential;
        }
        catch {
            throw new Error(`Invalid bridge manifest: ${label}.address must be a valid Cardano address`);
        }
        if (paymentCredential?.type !== 'Script' || paymentCredential.hash !== validator.script_hash) {
            throw new Error(`Invalid bridge manifest: ${label}.address does not match its script hash`);
        }
    }
    return {
        scriptHash: validator.script_hash,
        address,
        refUtxo: mapRefUtxo(validator.ref_utxo),
    };
}
function assertDeploymentAddressBindings(deployment) {
    const assertModuleBinding = (moduleAddress, validator, modulePath, validatorPath) => {
        if (!validator) {
            throw new Error(`Invalid bridge manifest: ${validatorPath} is required when ${modulePath} is present`);
        }
        if (moduleAddress !== validator.address) {
            throw new Error(`Invalid bridge manifest: ${modulePath}.address does not match ${validatorPath}.address`);
        }
    };
    assertModuleBinding(deployment.modules.transfer.address, deployment.validators.spendTransferModule, 'modules.transfer', 'validators.spend_transfer_module');
    if (deployment.modules.mock) {
        assertModuleBinding(deployment.modules.mock.address, deployment.validators.spendMockModule, 'modules.mock', 'validators.spend_mock_module');
    }
    if (deployment.modules.icq) {
        assertModuleBinding(deployment.modules.icq.address, deployment.validators.spendMockModule, 'modules.icq', 'validators.spend_mock_module');
    }
    if (deployment.traceRegistry) {
        assertModuleBinding(deployment.traceRegistry.address, deployment.validators.spendTraceRegistry, 'trace_registry', 'validators.spend_trace_registry');
    }
}
function normalizeBridgeManifest(manifest) {
    if (manifest.schema_version !== 6) {
        throw new Error('Unsupported bridge manifest schema_version: expected 6');
    }
    if (typeof manifest.host_state_nft?.script !== 'string' ||
        manifest.host_state_nft.script.length === 0) {
        throw new Error('Invalid bridge manifest: host_state_nft.script is required');
    }
    let computedHostStatePolicyId;
    try {
        computedHostStatePolicyId = (0, lucid_1.validatorToScriptHash)({
            type: 'PlutusV3',
            script: manifest.host_state_nft.script,
        });
    }
    catch {
        throw new Error('Invalid bridge manifest: host_state_nft.script must be a serialized Plutus V3 script');
    }
    if (computedHostStatePolicyId !== manifest.host_state_nft.policy_id) {
        throw new Error('Invalid bridge manifest: host_state_nft.policy_id does not match its script');
    }
    const referenceOutRefs = mapReferenceOutRefs(manifest.reference_out_refs);
    const referenceValidator = mapReferenceValidator(manifest.reference_validator);
    if (typeof manifest.reference_script_inventory_root !== 'string' ||
        !/^[0-9a-f]{64}$/.test(manifest.reference_script_inventory_root)) {
        throw new Error('Invalid bridge manifest: reference_script_inventory_root must be 32-byte lowercase hex');
    }
    assertManifestReferenceInventory(referenceOutRefs, manifest.validators);
    const computedInventoryRoot = computeReferenceScriptInventoryRoot(referenceOutRefs);
    if (computedInventoryRoot !== manifest.reference_script_inventory_root) {
        throw new Error('Invalid bridge manifest: reference_script_inventory_root does not match reference_out_refs');
    }
    const deployment = {
        deployedAt: manifest.deployed_at,
        referenceOutRefs,
        referenceScriptInventoryRoot: manifest.reference_script_inventory_root,
        referenceValidator,
        hostStateNFT: {
            policyId: manifest.host_state_nft.policy_id,
            name: manifest.host_state_nft.token_name,
            script: manifest.host_state_nft.script,
        },
        validators: {
            hostStateStt: mapValidator(manifest.validators.host_state_stt, 'validators.host_state_stt', true),
            spendClient: mapValidator(manifest.validators.spend_client, 'validators.spend_client', true),
            spendConnection: mapValidator(manifest.validators.spend_connection, 'validators.spend_connection', true),
            spendChannel: {
                ...mapValidator(manifest.validators.spend_channel, 'validators.spend_channel', true),
                refValidator: {
                    acknowledge_packet: {
                        scriptHash: manifest.validators.spend_channel.ref_validator.acknowledge_packet.script_hash,
                        refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.acknowledge_packet.ref_utxo),
                    },
                    chan_close_confirm: {
                        scriptHash: manifest.validators.spend_channel.ref_validator.chan_close_confirm.script_hash,
                        refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.chan_close_confirm.ref_utxo),
                    },
                    chan_close_init: {
                        scriptHash: manifest.validators.spend_channel.ref_validator.chan_close_init.script_hash,
                        refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.chan_close_init.ref_utxo),
                    },
                    chan_open_ack: {
                        scriptHash: manifest.validators.spend_channel.ref_validator.chan_open_ack.script_hash,
                        refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.chan_open_ack.ref_utxo),
                    },
                    chan_open_confirm: {
                        scriptHash: manifest.validators.spend_channel.ref_validator.chan_open_confirm.script_hash,
                        refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.chan_open_confirm.ref_utxo),
                    },
                    recv_packet: {
                        scriptHash: manifest.validators.spend_channel.ref_validator.recv_packet.script_hash,
                        refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.recv_packet.ref_utxo),
                    },
                    prune_packet_history: {
                        scriptHash: manifest.validators.spend_channel.ref_validator.prune_packet_history.script_hash,
                        refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.prune_packet_history.ref_utxo),
                    },
                    send_packet: {
                        scriptHash: manifest.validators.spend_channel.ref_validator.send_packet.script_hash,
                        refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.send_packet.ref_utxo),
                    },
                    timeout_packet: {
                        scriptHash: manifest.validators.spend_channel.ref_validator.timeout_packet.script_hash,
                        refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.timeout_packet.ref_utxo),
                    },
                },
            },
            ...(manifest.validators.spend_mock_module
                ? {
                    spendMockModule: mapValidator(manifest.validators.spend_mock_module, 'validators.spend_mock_module', true),
                }
                : {}),
            ...(manifest.validators.spend_trace_registry
                ? {
                    spendTraceRegistry: mapValidator(manifest.validators.spend_trace_registry, 'validators.spend_trace_registry', true),
                }
                : {}),
            spendTransferModule: mapValidator(manifest.validators.spend_transfer_module, 'validators.spend_transfer_module', true),
            mintIdentifier: mapValidator(manifest.validators.mint_identifier, 'validators.mint_identifier', false),
            verifyProof: mapValidator(manifest.validators.verify_proof, 'validators.verify_proof', false),
            mintClientStt: mapValidator(manifest.validators.mint_client_stt, 'validators.mint_client_stt', false),
            mintConnectionStt: mapValidator(manifest.validators.mint_connection_stt, 'validators.mint_connection_stt', false),
            mintChannelStt: mapValidator(manifest.validators.mint_channel_stt, 'validators.mint_channel_stt', false),
            mintLifecycleCreationMarker: mapValidator(manifest.validators.mint_lifecycle_creation_marker, 'validators.mint_lifecycle_creation_marker', false),
            mintLifecycleReclamationMarker: mapValidator(manifest.validators.mint_lifecycle_reclamation_marker, 'validators.mint_lifecycle_reclamation_marker', false),
            mintLifecycleOperationalMarker: mapValidator(manifest.validators.mint_lifecycle_operational_marker, 'validators.mint_lifecycle_operational_marker', false),
            mintLifecyclePacketMarker: mapValidator(manifest.validators.mint_lifecycle_packet_marker, 'validators.mint_lifecycle_packet_marker', false),
            mintVoucher: mapValidator(manifest.validators.mint_voucher, 'validators.mint_voucher', false),
            mintTransferEscrowShard: mapValidator(manifest.validators.mint_transfer_escrow_shard, 'validators.mint_transfer_escrow_shard', false),
            mintPort: mapValidator(manifest.validators.mint_port, 'validators.mint_port', false),
            ...(manifest.validators.mint_trace_registry_benchmark_voucher
                ? {
                    mintTraceRegistryBenchmarkVoucher: mapValidator(manifest.validators.mint_trace_registry_benchmark_voucher, 'validators.mint_trace_registry_benchmark_voucher', false),
                }
                : {}),
            ...(manifest.validators.voucher_metadata
                ? { voucherMetadata: { address: manifest.validators.voucher_metadata.address } }
                : {}),
        },
        modules: {
            transfer: manifest.modules.transfer,
            ...(manifest.modules.mock ? { mock: manifest.modules.mock } : {}),
            ...(manifest.modules.icq ? { icq: manifest.modules.icq } : {}),
        },
        ...(manifest.trace_registry
            ? {
                traceRegistry: {
                    address: manifest.trace_registry.address,
                    shardPolicyId: manifest.trace_registry.shard_policy_id,
                    directory: {
                        policyId: manifest.trace_registry.directory.policy_id,
                        name: manifest.trace_registry.directory.token_name,
                    },
                },
            }
            : {}),
    };
    assertDeploymentAddressBindings(deployment);
    return {
        bridgeManifest: manifest,
        deployment,
    };
}
function splitKupmiosUrl(kupmiosUrl) {
    const [kupoEndpoint, ogmiosEndpoint] = kupmiosUrl.split(',').map((value) => value.trim());
    if (!kupoEndpoint || !ogmiosEndpoint) {
        throw new Error('kupmiosUrl must be "<kupoEndpoint>,<ogmiosEndpoint>"');
    }
    return { kupoEndpoint, ogmiosEndpoint };
}
function isDemeterHost(hostname) {
    return hostname.endsWith('.dmtr.host') || hostname.endsWith('.demeter.run');
}
function normalizeDemeterOgmiosEndpoint(ogmiosEndpoint, headers) {
    const apiKey = headers?.ogmiosHeader?.['dmtr-api-key']?.trim();
    try {
        const parsed = new URL(ogmiosEndpoint);
        if (parsed.protocol === 'wss:') {
            parsed.protocol = 'https:';
        }
        else if (parsed.protocol === 'ws:') {
            parsed.protocol = 'http:';
        }
        if (!apiKey || !isDemeterHost(parsed.hostname)) {
            return { ogmiosEndpoint: parsed.toString().replace(/\/$/, ''), headers };
        }
        if (!parsed.host.startsWith(`${apiKey}.`)) {
            parsed.host = `${apiKey}.${parsed.host}`;
        }
        const nextHeaders = { ...headers };
        // Demeter Ogmios uses host-based auth for HTTP JSON-RPC; the same key as a
        // header can leave POST requests waiting until the provider timeout.
        delete nextHeaders.ogmiosHeader;
        return {
            ogmiosEndpoint: parsed.toString().replace(/\/$/, ''),
            headers: nextHeaders.kupoHeader || nextHeaders.ogmiosHeader
                ? nextHeaders
                : undefined,
        };
    }
    catch {
        return { ogmiosEndpoint, headers };
    }
}
function parseRequiredString(value, fieldName) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`Invalid argument: "${fieldName}" is required`);
    }
    return value.trim();
}
function parseBigIntValue(value, fieldName) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
        throw new Error(`Invalid argument: "${fieldName}" must be a bigint-compatible value`);
    }
    try {
        return BigInt(value);
    }
    catch {
        throw new Error(`Invalid argument: "${fieldName}" must be a bigint-compatible value`);
    }
}
function parseSendPacketOperator(body) {
    const sourcePort = parseRequiredString(body.source_port, 'source_port');
    const sourceChannel = parseRequiredString(body.source_channel, 'source_channel');
    if (!sourceChannel.startsWith('channel-')) {
        throw new Error('Invalid argument: "source_channel" must start with "channel-"');
    }
    return {
        sourcePort,
        sourceChannel,
        token: {
            denom: parseRequiredString(body.token?.denom, 'token.denom'),
            amount: parseBigIntValue(body.token?.amount, 'token.amount'),
        },
        sender: parseRequiredString(body.sender, 'sender'),
        receiver: parseRequiredString(body.receiver, 'receiver'),
        signer: parseRequiredString(body.signer, 'signer'),
        timeoutHeight: {
            revisionNumber: parseBigIntValue(body.timeout_height?.revision_number ?? '0', 'timeout_height.revision_number'),
            revisionHeight: parseBigIntValue(body.timeout_height?.revision_height ?? '0', 'timeout_height.revision_height'),
        },
        timeoutTimestamp: parseBigIntValue(body.timeout_timestamp ?? '0', 'timeout_timestamp'),
        memo: body.memo ?? '',
    };
}
function parseOptionalString(value, fieldName) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new Error(`Invalid argument: "${fieldName}" must be a string`);
    }
    return value;
}
function parseWalletUtxoAssets(value, fieldName) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Invalid argument: "${fieldName}" must be an asset map`);
    }
    const assets = {};
    for (const [unit, quantity] of Object.entries(value)) {
        assets[unit] = parseBigIntValue(quantity, `${fieldName}.${unit}`);
    }
    return assets;
}
function parseWalletUtxos(value) {
    if (value === undefined || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error('Invalid argument: "wallet_utxos" must be an array');
    }
    return value.map((utxo, index) => {
        if (typeof utxo !== 'object' || utxo === null || Array.isArray(utxo)) {
            throw new Error(`Invalid argument: "wallet_utxos[${index}]" must be an object`);
        }
        const item = utxo;
        const txHash = parseRequiredString(item.txHash, `wallet_utxos[${index}].txHash`);
        const outputIndex = Number(item.outputIndex);
        if (!Number.isInteger(outputIndex) || outputIndex < 0) {
            throw new Error(`Invalid argument: "wallet_utxos[${index}].outputIndex" must be a non-negative integer`);
        }
        return {
            txHash,
            outputIndex,
            address: parseRequiredString(item.address, `wallet_utxos[${index}].address`),
            assets: parseWalletUtxoAssets(item.assets, `wallet_utxos[${index}].assets`),
            datumHash: parseOptionalString(item.datumHash, `wallet_utxos[${index}].datumHash`),
            datum: parseOptionalString(item.datum, `wallet_utxos[${index}].datum`),
        };
    });
}
function convertHex2String(value) {
    if (!value) {
        return '';
    }
    return Buffer.from(value, 'hex').toString();
}
function parseConnectionSequence(connectionId) {
    const match = /^connection-(\d+)$/.exec(connectionId);
    if (!match) {
        throw new Error(`Invalid connection id: ${connectionId}`);
    }
    return BigInt(match[1]);
}
function parseClientSequence(clientId) {
    const match = /^07-tendermint-(\d+)$/.exec(clientId);
    if (!match) {
        throw new Error(`Invalid client id: ${clientId}`);
    }
    return BigInt(match[1]);
}
function commitPacket(packet) {
    let buffer = uint64ToBigEndian(packet.timeout_timestamp);
    buffer = appendBuffer(buffer, uint64ToBigEndian(packet.timeout_height.revisionNumber));
    buffer = appendBuffer(buffer, uint64ToBigEndian(packet.timeout_height.revisionHeight));
    const dataHash = crypto_1.default.createHash('sha256').update(Buffer.from(packet.data, 'hex')).digest('hex');
    return crypto_1.default
        .createHash('sha256')
        .update(Buffer.from(`${Buffer.from(buffer).toString('hex')}${dataHash}`, 'hex'))
        .digest('hex');
}
function uint64ToBigEndian(value) {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setBigUint64(0, value);
    return new Uint8Array(buffer);
}
function appendBuffer(left, right) {
    const result = new Uint8Array(left.length + right.length);
    result.set(left, 0);
    result.set(right, left.length);
    return result;
}
function ogmiosRequest(ogmiosUrl, methodName, args, headers, timeoutMs = exports.OGMIOS_WEBSOCKET_REQUEST_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        let client;
        try {
            client = new ws_1.default(ogmiosUrl, headers ? { headers } : undefined);
        }
        catch (error) {
            reject(error);
            return;
        }
        let requestSent = false;
        let settled = false;
        let timeout;
        const removeRequestListeners = () => {
            client.off('open', handleOpen);
            client.off('message', handleMessage);
            client.off('error', handleError);
            client.off('close', handleClose);
        };
        const destroyClient = () => {
            if (client.readyState === ws_1.default.CLOSED) {
                return;
            }
            // `ws` emits an error when a connecting socket is terminated. Keep a
            // temporary listener until close so cleanup cannot create an unhandled error.
            const ignoreCleanupError = () => undefined;
            const removeCleanupErrorListener = () => client.off('error', ignoreCleanupError);
            client.once('error', ignoreCleanupError);
            client.once('close', removeCleanupErrorListener);
            try {
                client.terminate();
            }
            catch {
                client.off('error', ignoreCleanupError);
                client.off('close', removeCleanupErrorListener);
            }
        };
        const settle = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            if (timeout !== undefined) {
                clearTimeout(timeout);
            }
            removeRequestListeners();
            destroyClient();
            if ('error' in result) {
                reject(result.error);
            }
            else {
                resolve(result.value);
            }
        };
        const handleOpen = () => {
            requestSent = true;
            try {
                client.send(JSON.stringify({
                    jsonrpc: '2.0',
                    method: methodName,
                    params: args,
                }), (error) => {
                    if (error) {
                        settle({ error });
                    }
                });
            }
            catch (error) {
                settle({ error });
            }
        };
        const handleMessage = (rawMessage) => {
            try {
                const payload = JSON.parse(rawMessage.toString());
                if (payload?.error) {
                    settle({ error: new Error(payload.error.message ?? JSON.stringify(payload.error)) });
                    return;
                }
                settle({ value: payload.result });
            }
            catch (error) {
                settle({ error });
            }
        };
        const handleError = (error) => settle({ error });
        const handleClose = (code, reason) => {
            const reasonText = reason.length > 0 ? `: ${reason.toString()}` : '';
            settle({
                error: new Error(`Ogmios ${methodName} WebSocket closed before a response was received (code ${code}${reasonText})`),
            });
        };
        client.once('open', handleOpen);
        client.once('message', handleMessage);
        client.once('error', handleError);
        client.once('close', handleClose);
        timeout = setTimeout(() => {
            const phase = requestSent ? 'waiting for a response' : 'opening the WebSocket';
            settle({
                error: new Error(`Ogmios ${methodName} request timed out after ${timeoutMs}ms while ${phase}`),
            });
        }, timeoutMs);
    });
}
async function querySystemStart(ogmiosUrl, headers) {
    const systemStart = await ogmiosRequest(ogmiosUrl, 'queryNetwork/startTime', {}, headers);
    return Date.parse(systemStart);
}
async function queryNetworkTipPoint(ogmiosUrl, headers) {
    const result = await ogmiosRequest(ogmiosUrl, 'queryNetwork/tip', {}, headers);
    if (result === 'origin') {
        return 'origin';
    }
    if (typeof result?.slot !== 'number' || typeof result?.id !== 'string') {
        throw new Error('Ogmios queryNetwork/tip returned an invalid point');
    }
    return {
        slot: result.slot,
        id: result.id,
    };
}
async function submitSignedTxCbor(ogmiosUrl, signedTxCbor, headers, fetchImpl) {
    const response = await fetchImpl(ogmiosUrl, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(headers ?? {}),
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'submitTransaction',
            params: {
                transaction: { cbor: signedTxCbor },
            },
            id: null,
        }),
    });
    const responseText = await response.text();
    let payload;
    try {
        payload = responseText ? JSON.parse(responseText) : null;
    }
    catch {
        payload = null;
    }
    if (!response.ok) {
        throw new Error(`Ogmios submitTransaction failed (${response.status} ${response.statusText}): ${responseText.slice(0, 1000)}`);
    }
    if (payload?.error) {
        throw new Error(`Ogmios submitTransaction rejected: ${payload.error.message ?? JSON.stringify(payload.error)}`);
    }
    const txHash = payload?.result?.transaction?.id;
    if (typeof txHash !== 'string' || txHash.trim().length === 0) {
        throw new Error(`Ogmios submitTransaction returned an invalid response: ${responseText.slice(0, 1000)}`);
    }
    return txHash;
}
function toSafeCostModelInteger(value) {
    let parsedValue;
    if (typeof value === 'number') {
        parsedValue = value;
    }
    else if (typeof value === 'bigint') {
        parsedValue = Number(value);
    }
    else if (typeof value === 'string') {
        parsedValue = Number(value);
    }
    else {
        throw new Error(`Unsupported cost model value type: ${typeof value}`);
    }
    if (!Number.isFinite(parsedValue)) {
        throw new Error(`Invalid non-finite cost model value: ${String(value)}`);
    }
    if (!Number.isInteger(parsedValue)) {
        parsedValue = Math.trunc(parsedValue);
    }
    if (!Number.isSafeInteger(parsedValue)) {
        return parsedValue > 0 ? MAX_SAFE_COST_MODEL_VALUE : -MAX_SAFE_COST_MODEL_VALUE;
    }
    return parsedValue;
}
function costModelRecordEntries(values) {
    const entries = Object.entries(values);
    const hasOnlyNumericIndexes = entries.every(([index]) => /^\d+$/.test(index));
    return hasOnlyNumericIndexes
        ? entries.sort(([left], [right]) => Number(left) - Number(right))
        : entries;
}
function toCostModelArray(values) {
    if (!values) {
        return [];
    }
    const rawValues = Array.isArray(values)
        ? values
        : costModelRecordEntries(values).map(([, value]) => value);
    return rawValues.map((value) => toSafeCostModelInteger(value));
}
function mapOgmiosCostModels(plutusCostModels) {
    // Lucid's cost-model constructor iterates all three language keys
    // unconditionally. Keep unavailable models empty so the object has the
    // shape Lucid requires without copying another language's parameters.
    const mappedModels = {
        PlutusV1: [],
        PlutusV2: [],
        PlutusV3: [],
    };
    if (plutusCostModels !== undefined &&
        plutusCostModels !== null &&
        (typeof plutusCostModels !== 'object' || Array.isArray(plutusCostModels))) {
        throw new Error('Ogmios protocol parameters response contains invalid plutusCostModels');
    }
    const rawModels = (plutusCostModels ?? {});
    const modelNames = [
        ['plutus:v1', 'PlutusV1'],
        ['plutus:v2', 'PlutusV2'],
        ['plutus:v3', 'PlutusV3'],
    ];
    for (const [ogmiosName, lucidName] of modelNames) {
        const rawModel = rawModels[ogmiosName];
        if (rawModel === undefined || rawModel === null) {
            continue;
        }
        if (!Array.isArray(rawModel) && typeof rawModel !== 'object') {
            throw new Error(`Ogmios protocol parameters response contains invalid ${ogmiosName} cost model`);
        }
        mappedModels[lucidName] = toCostModelArray(rawModel);
    }
    for (const [ogmiosName, lucidName] of modelNames.slice(0, 2)) {
        if (mappedModels[lucidName].length === 0) {
            throw new Error(`Ogmios protocol parameters response is missing a non-empty ${ogmiosName} cost model`);
        }
    }
    return mappedModels;
}
function sanitizeProtocolParameters(protocolParameters) {
    if (!protocolParameters?.costModels) {
        return protocolParameters;
    }
    const sanitizedCostModels = {};
    for (const [version, model] of Object.entries(protocolParameters.costModels)) {
        if (Array.isArray(model) || (typeof model === 'object' && model !== null)) {
            sanitizedCostModels[version] = toCostModelArray(model);
        }
    }
    return {
        ...protocolParameters,
        costModels: sanitizedCostModels,
    };
}
function parseOgmiosRatio(value, label) {
    if (Array.isArray(value) && value.length >= 2) {
        const numerator = Number(value[0]);
        const denominator = Number(value[1]);
        if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
            return numerator / denominator;
        }
    }
    if (typeof value === 'string') {
        const [rawNumerator, rawDenominator] = value.includes('/') ? value.split('/') : [value, '1'];
        const numerator = Number(rawNumerator);
        const denominator = Number(rawDenominator);
        if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
            return numerator / denominator;
        }
    }
    if (typeof value === 'object' && value !== null) {
        const record = value;
        const numerator = Number(record.numerator ?? record.num ?? record[0]);
        const denominator = Number(record.denominator ?? record.den ?? record[1]);
        if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
            return numerator / denominator;
        }
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    throw new Error(`Invalid Ogmios ratio for ${label}: ${JSON.stringify(value)}`);
}
function parseRetryAfterMs(headers) {
    const retryAfter = headers?.get?.('retry-after')?.trim();
    if (!retryAfter) {
        return undefined;
    }
    if (/^\d+$/.test(retryAfter)) {
        return Number(retryAfter) * 1_000;
    }
    const retryAt = Date.parse(retryAfter);
    if (!Number.isFinite(retryAt)) {
        return undefined;
    }
    return Math.max(0, retryAt - Date.now());
}
function lovelaceValue(value, fallback = 0n) {
    const raw = value?.ada?.lovelace ?? value?.lovelace ?? value;
    if (raw === undefined || raw === null || raw === '') {
        return fallback;
    }
    return BigInt(raw);
}
function mapOgmiosProtocolParameters(result) {
    if (!result) {
        throw new Error('Ogmios protocol parameters response is missing result');
    }
    const coinsPerUtxoByte = result.utxoCostPerByte ?? result.minUtxoDepositCoefficient;
    if (coinsPerUtxoByte === undefined || coinsPerUtxoByte === null) {
        throw new Error('Ogmios protocol parameters response is missing utxoCostPerByte/minUtxoDepositCoefficient');
    }
    const costModels = mapOgmiosCostModels(result.plutusCostModels);
    return {
        minFeeA: result.minFeeCoefficient,
        minFeeB: Number(lovelaceValue(result.minFeeConstant)),
        maxTxSize: result.maxTransactionSize?.bytes,
        maxValSize: result.maxValueSize?.bytes,
        keyDeposit: lovelaceValue(result.stakeCredentialDeposit),
        poolDeposit: lovelaceValue(result.stakePoolDeposit),
        drepDeposit: lovelaceValue(result.delegateRepresentativeDeposit),
        govActionDeposit: lovelaceValue(result.governanceActionDeposit),
        priceMem: parseOgmiosRatio(result.scriptExecutionPrices?.memory, 'scriptExecutionPrices.memory'),
        priceStep: parseOgmiosRatio(result.scriptExecutionPrices?.cpu, 'scriptExecutionPrices.cpu'),
        maxTxExMem: BigInt(result.maxExecutionUnitsPerTransaction?.memory ?? 0),
        maxTxExSteps: BigInt(result.maxExecutionUnitsPerTransaction?.cpu ?? 0),
        coinsPerUtxoByte: BigInt(coinsPerUtxoByte),
        collateralPercentage: result.collateralPercentage,
        maxCollateralInputs: result.maxCollateralInputs,
        minFeeRefScriptCostPerByte: result.minFeeReferenceScripts?.base ?? 0,
        costModels,
    };
}
async function queryProtocolParametersCompat(ogmiosEndpoint, headers, fetchImpl = fetch, timeoutMs = exports.OGMIOS_PROTOCOL_PARAMETERS_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    let timeout;
    const timeoutError = new Error(`Ogmios protocol parameters query timed out after ${timeoutMs}ms`);
    timeoutError.name = 'TimeoutError';
    try {
        return await Promise.race([
            (async () => {
                const response = await fetchImpl(ogmiosEndpoint, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        ...(headers ?? {}),
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'queryLedgerState/protocolParameters',
                        params: {},
                        id: 'tx-builder-runtime-protocol-parameters',
                    }),
                    signal: controller.signal,
                });
                const text = await response.text();
                if (!response.ok) {
                    const error = new Error(`Ogmios protocol parameters query failed with HTTP ${response.status}: ${text}`);
                    Object.assign(error, {
                        status: response.status,
                        retryAfterMs: parseRetryAfterMs(response.headers),
                    });
                    throw error;
                }
                let payload;
                try {
                    payload = JSON.parse(text);
                }
                catch (error) {
                    throw new Error('Ogmios protocol parameters query returned invalid JSON', { cause: error });
                }
                if (payload.error) {
                    throw new Error(`Ogmios protocol parameters query failed: ${JSON.stringify(payload.error)}`);
                }
                return mapOgmiosProtocolParameters(payload.result);
            })(),
            new Promise((_resolve, reject) => {
                timeout = setTimeout(() => {
                    controller.abort(timeoutError);
                    reject(timeoutError);
                }, timeoutMs);
            }),
        ]);
    }
    finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
    }
}
function collectErrorSignals(error) {
    const signals = [];
    const visited = new Set();
    const pushSignal = (value) => {
        if (typeof value !== 'string') {
            return;
        }
        const normalized = value.trim();
        if (normalized.length > 0) {
            signals.push(normalized);
        }
    };
    const visit = (value, depth) => {
        if (value == null || depth > 3 || visited.has(value)) {
            return;
        }
        visited.add(value);
        if (typeof value === 'string') {
            pushSignal(value);
            return;
        }
        if (value instanceof Error) {
            pushSignal(value.name);
            pushSignal(value.message);
            if (typeof value.stack === 'string') {
                pushSignal(value.stack.split('\n')[0]?.trim());
            }
        }
        if (typeof value === 'object') {
            const record = value;
            pushSignal(record.message);
            pushSignal(record.name);
            pushSignal(record.code);
            pushSignal(record.reason);
            pushSignal(record.details);
            pushSignal(record.type);
            pushSignal(record.statusText);
            if (typeof record.status === 'number') {
                pushSignal(`HTTP ${record.status}`);
            }
            visit(record.cause, depth + 1);
            visit(record.error, depth + 1);
            visit(record.originalError, depth + 1);
        }
    };
    visit(error, 0);
    return signals;
}
function hasTransientHttpStatus(normalizedSignals) {
    return normalizedSignals.some((signal) => {
        const statusMatches = [
            ...signal.matchAll(/\bhttp\s+(\d{3})\b/g),
            ...signal.matchAll(/\bstatus(?:code)?\s*[:=]?\s*(\d{3})\b/g),
            ...signal.matchAll(/\((\d{3})\s+(?:get|post|put|delete|patch)\b/g),
        ];
        return statusMatches.some((match) => {
            const status = Number(match[1]);
            return status === 429 || (status >= 500 && status <= 599);
        });
    });
}
function isTransientStartupError(error) {
    const normalizedSignals = collectErrorSignals(error).map((signal) => signal.toLowerCase());
    return (hasTransientHttpStatus(normalizedSignals) ||
        normalizedSignals.some((signal) => TRANSIENT_STARTUP_ERROR_MARKERS.some((marker) => signal.includes(marker))));
}
function computeJitteredBackoffDelayMs(failedAttempt) {
    const backoffDelay = PROTOCOL_PARAMETERS_BASE_DELAY_MS * 2 ** Math.max(0, failedAttempt - 1);
    const jitterMultiplier = 0.8 + Math.random() * 0.4;
    return Math.round(backoffDelay * jitterMultiplier);
}
function computeProtocolParametersRetryDelayMs(failedAttempt, error) {
    const backoffDelayMs = computeJitteredBackoffDelayMs(failedAttempt);
    if (typeof error !== 'object' || error === null) {
        return backoffDelayMs;
    }
    const retryAfterMs = error.retryAfterMs;
    if (typeof retryAfterMs !== 'number' ||
        !Number.isFinite(retryAfterMs) ||
        retryAfterMs < 0) {
        return backoffDelayMs;
    }
    return Math.max(backoffDelayMs, Math.min(retryAfterMs, PROTOCOL_PARAMETERS_RETRY_AFTER_MAX_MS));
}
async function retryWithBackoff(operation, wait = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs))) {
    for (let attempt = 1; attempt <= PROTOCOL_PARAMETERS_MAX_ATTEMPTS; attempt += 1) {
        try {
            return await operation();
        }
        catch (error) {
            if (!isTransientStartupError(error) || attempt >= PROTOCOL_PARAMETERS_MAX_ATTEMPTS) {
                throw error;
            }
            const retryDelayMs = computeProtocolParametersRetryDelayMs(attempt, error);
            await wait(retryDelayMs);
        }
    }
    throw new Error('Kupmios protocol parameters fetch failed');
}
async function createLucidRuntime(kupoEndpoint, ogmiosEndpoint, cardanoNetwork, logger, headers, fetchImpl = fetch) {
    const Lucid = await timed(logger, '[context]', 'import lucid', () => eval(`import('@lucid-evolution/lucid')`));
    const provider = new Lucid.Kupmios(kupoEndpoint, ogmiosEndpoint, withKupoStringQuantityHeader(headers));
    const protocolParameters = sanitizeProtocolParameters(await timed(logger, '[context]', 'fetch protocol parameters', () => retryWithBackoff(() => queryProtocolParametersCompat(ogmiosEndpoint, headers?.ogmiosHeader, fetchImpl))));
    const lucid = await timed(logger, '[context]', 'create lucid runtime', () => Lucid.Lucid(provider, cardanoNetwork, {
        presetProtocolParameters: protocolParameters,
    }));
    const chainZeroTime = await timed(logger, '[context]', 'query system start', () => querySystemStart(ogmiosEndpoint, headers?.ogmiosHeader));
    const slotConfig = Lucid.SLOT_CONFIG_NETWORK?.[cardanoNetwork];
    if (!slotConfig) {
        throw new Error(`Lucid does not expose a slot configuration for Cardano network ${cardanoNetwork}`);
    }
    slotConfig.zeroTime = chainZeroTime;
    slotConfig.slotLength = 1000;
    return {
        lucidImporter: Lucid,
        lucid,
    };
}
class RuntimeKupoService {
    lucidService;
    kupoEndpoint;
    headers;
    fetchImpl;
    clientTokenPrefix;
    connectionTokenPrefix;
    channelTokenPrefix;
    clientAddress;
    connectionAddress;
    channelAddress;
    constructor(lucidService, deployment, kupoEndpoint, headers, fetchImpl) {
        this.lucidService = lucidService;
        this.kupoEndpoint = kupoEndpoint;
        this.headers = headers;
        this.fetchImpl = fetchImpl;
        this.clientTokenPrefix = deployment.validators.mintClientStt.scriptHash;
        this.connectionTokenPrefix = deployment.validators.mintConnectionStt.scriptHash;
        this.channelTokenPrefix = deployment.validators.mintChannelStt.scriptHash;
        this.clientAddress = deployment.validators.spendClient.address ?? '';
        this.connectionAddress = deployment.validators.spendConnection.address ?? '';
        this.channelAddress = deployment.validators.spendChannel.address ?? '';
    }
    getMatchingAssetNames(utxo, policyId) {
        return Object.keys(utxo.assets)
            .filter((assetId) => assetId !== 'lovelace')
            .filter((assetId) => assetId.startsWith(policyId))
            .map((assetId) => assetId.slice(policyId.length));
    }
    async queryUtxosAtAddressByPolicy(address, policyId) {
        try {
            const utxos = await this.lucidService.findUtxoAt(address);
            return utxos.filter((utxo) => this.getMatchingAssetNames(utxo, policyId).length > 0);
        }
        catch (error) {
            if (error instanceof Error &&
                error.message === `Unable to find UTxO at ${address}`) {
                return [];
            }
            throw error;
        }
    }
    async queryAllClientUtxos() {
        return this.queryUtxosAtAddressByPolicy(this.clientAddress, this.clientTokenPrefix);
    }
    async queryAllConnectionUtxos() {
        return this.queryUtxosAtAddressByPolicy(this.connectionAddress, this.connectionTokenPrefix);
    }
    async queryAllChannelUtxos() {
        return this.queryUtxosAtAddressByPolicy(this.channelAddress, this.channelTokenPrefix);
    }
    async queryLatestChannelUtxosFromHistory() {
        const outputs = await (0, kupoHistory_1.fetchLatestTransferEscrowShardHistory)({
            kupoEndpoint: this.kupoEndpoint,
            address: this.channelAddress,
            policyId: this.channelTokenPrefix,
            headers: this.headers,
            fetchImpl: this.fetchImpl,
        });
        return outputs.map((output) => ({
            ...output,
            spentAt: output.spent ? {} : null,
            authToken: { unit: output.shardTokenUnit },
        }));
    }
}
function dedupeUtxos(utxos) {
    const seen = new Map();
    const orderedKeys = [];
    for (const utxo of utxos) {
        const key = utxoRef(utxo);
        if (!seen.has(key)) {
            orderedKeys.push(key);
        }
        seen.set(key, utxo);
    }
    return orderedKeys.map((key) => seen.get(key)).filter(Boolean);
}
function utxoRef(utxo) {
    return `${utxo.txHash}#${utxo.outputIndex}`;
}
async function findTransferEscrowShard(context, channelId, packetDenom, denomToken, principalDelta) {
    const deployment = context.deployment;
    return (0, transferEscrowShard_1.findTransferEscrowShard)({
        transferModuleAddress: deployment.modules.transfer.address,
        transferModuleIdentifier: deployment.modules.transfer.identifier,
        shardPolicyId: deployment.validators.mintTransferEscrowShard.scriptHash,
        findUtxosAt: (address) => context.lucidService.findUtxoAt(address),
        findLatestShardHistory: (address, policyId) => (0, kupoHistory_1.fetchLatestTransferEscrowShardHistory)({
            kupoEndpoint: context.kupoEndpoint,
            address,
            policyId,
            headers: context.kupmiosHeaders?.kupoHeader,
            fetchImpl: context.fetchImpl,
        }),
        encodeTransferEscrowDatum: (datum) => context.lucidService.encode(datum, 'transferEscrow'),
        decodeTransferEscrowDatum: (encodedDatum) => context.lucidService.decodeDatum(encodedDatum, 'transferEscrow'),
        encodeTransferModuleDatum: (datum) => context.lucidService.encode(datum, 'transferModule'),
        decodeTransferModuleDatum: (encodedDatum) => context.lucidService.decodeDatum(encodedDatum, 'transferModule'),
    }, channelId, packetDenom, denomToken, principalDelta);
}
async function ensureTreeAlignedForRoot(context, onChainRoot) {
    if (!(0, ibcStateRoot_1.isTreeAligned)(onChainRoot)) {
        context.logger.warn(`IBC tree root mismatch for local tx builder runtime, aligning to ${onChainRoot.slice(0, 16)}...`);
        await (0, ibcStateRoot_1.alignTreeWithChain)();
    }
}
async function buildHostStateUpdateForHandlePacket(context, inputChannelDatum, outputChannelDatum, channelIdForRoot) {
    const hostStateUtxo = await context.lucidService.findUtxoAtHostStateNFT();
    if (!hostStateUtxo.datum) {
        throw new Error('HostState UTXO has no datum');
    }
    const hostStateDatum = await context.lucidService.decodeDatum(hostStateUtxo.datum, 'host_state');
    await ensureTreeAlignedForRoot(context, hostStateDatum.state.ibc_state_root);
    const portId = convertHex2String(inputChannelDatum.port);
    const { newRoot, channelSiblings, nextSequenceSendSiblings, nextSequenceRecvSiblings, nextSequenceAckSiblings, packetCommitmentSiblings, packetReceiptSiblings, packetAcknowledgementSiblings, commit, } = await (0, ibcStateRoot_1.computeRootWithHandlePacketUpdate)(hostStateDatum.state.ibc_state_root, portId, channelIdForRoot, inputChannelDatum, outputChannelDatum, context.lucidService.LucidImporter);
    const updatedHostStateDatum = {
        ...hostStateDatum,
        state: {
            ...hostStateDatum.state,
            version: hostStateDatum.state.version + 1n,
            ibc_state_root: newRoot,
            last_update_time: BigInt(Date.now()),
        },
    };
    const hostStateRedeemer = {
        HandlePacket: {
            channel_siblings: channelSiblings,
            next_sequence_send_siblings: nextSequenceSendSiblings,
            next_sequence_recv_siblings: nextSequenceRecvSiblings,
            next_sequence_ack_siblings: nextSequenceAckSiblings,
            packet_commitment_siblings: packetCommitmentSiblings,
            packet_receipt_siblings: packetReceiptSiblings,
            packet_acknowledgement_siblings: packetAcknowledgementSiblings,
        },
    };
    return {
        hostStateUtxo,
        encodedHostStateRedeemer: await context.lucidService.encode(hostStateRedeemer, 'host_state_redeemer'),
        encodedUpdatedHostStateDatum: await context.lucidService.encode(updatedHostStateDatum, 'host_state'),
        newRoot,
        commit,
    };
}
async function computeTxValidityWindow(context) {
    const tip = await queryNetworkTipPoint(context.ogmiosEndpoint, context.kupmiosHeaders?.ogmiosHeader);
    const currentSlot = tip === 'origin' ? 0 : tip.slot;
    const ttlSlots = Math.max(1, Math.ceil(TRANSACTION_TIME_TO_LIVE / 1000));
    const validToSlot = currentSlot + ttlSlots;
    const slotConfig = context.lucidService.LucidImporter.SLOT_CONFIG_NETWORK?.[context.cardanoNetwork];
    if (!slotConfig || slotConfig.slotLength <= 0) {
        throw new Error(`Invalid Cardano slot configuration for network ${context.cardanoNetwork}`);
    }
    const currentLedgerTime = slotConfig.zeroTime + (currentSlot - slotConfig.zeroSlot) * slotConfig.slotLength;
    const validToTime = slotConfig.zeroTime + (validToSlot + 1 - slotConfig.zeroSlot) * slotConfig.slotLength - 1;
    const validFromTime = Math.max(slotConfig.zeroTime, currentLedgerTime);
    return {
        currentSlot,
        validFromTime,
        validToSlot,
        validToTime,
    };
}
function createTxBuilderRuntime(config) {
    const logger = config.logger ?? defaultLogger('txBuilderRuntime');
    let cachedContextPromise = null;
    const transferBuildQueue = new asyncMutex_1.AsyncMutex();
    let transferBuildCounter = 0;
    const traceRegistryClient = (0, trace_registry_1.createTraceRegistryClient)({
        bridgeManifestUrl: config.bridgeManifestUrl,
        kupmiosUrl: config.kupmiosUrl,
        kupmiosHeaders: withKupoStringQuantityHeader(config.kupmiosHeaders),
        fetchImpl: config.fetchImpl,
    });
    async function getBridgeManifest() {
        const fetchImpl = config.fetchImpl ?? fetch;
        let response;
        try {
            response = await fetchImpl(config.bridgeManifestUrl, {
                cache: 'no-store',
            });
        }
        catch (error) {
            throw new Error(`Failed to load bridge manifest from ${config.bridgeManifestUrl}: ${describeFetchFailure(error)}`, { cause: error });
        }
        if (!response.ok) {
            throw new Error(`Failed to load bridge manifest from ${config.bridgeManifestUrl}: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
    async function createContext() {
        const contextStartedAt = startTimer();
        logger.log('[context] initializing shared Cardano tx-builder runtime context');
        const manifest = await timed(logger, '[context]', 'load bridge manifest', getBridgeManifest);
        const { deployment, bridgeManifest } = normalizeBridgeManifest(manifest);
        const { kupoEndpoint, ogmiosEndpoint: rawOgmiosEndpoint } = splitKupmiosUrl(config.kupmiosUrl);
        const { ogmiosEndpoint, headers: normalizedKupmiosHeaders } = normalizeDemeterOgmiosEndpoint(rawOgmiosEndpoint, config.kupmiosHeaders);
        const kupmiosHeaders = withKupoStringQuantityHeader(normalizedKupmiosHeaders);
        const cardanoNetwork = normalizeCardanoNetwork(bridgeManifest.cardano.network);
        const { lucidImporter, lucid } = await createLucidRuntime(kupoEndpoint, ogmiosEndpoint, cardanoNetwork, logger, kupmiosHeaders, config.fetchImpl ?? fetch);
        const lucidService = new lucidIbcAdapter_1.LucidIbcAdapter(lucidImporter, lucid, deployment);
        await timed(logger, '[context]', 'initialize lucid adapter', () => lucidService.onModuleInit());
        const kupoService = new RuntimeKupoService(lucidService, deployment, kupoEndpoint, kupmiosHeaders?.kupoHeader, config.fetchImpl ?? fetch);
        (0, ibcStateRoot_1.initTreeServices)(kupoService, lucidService);
        await timed(logger, '[context]', 'rebuild IBC state tree', () => (0, ibcStateRoot_1.rebuildTreeFromChain)(kupoService, lucidService));
        logger.log(`[context] initialized shared Cardano tx-builder runtime context in ${elapsedMs(contextStartedAt)}`);
        return {
            deployment,
            lucidService,
            logger,
            cardanoNetwork,
            ogmiosEndpoint,
            kupoEndpoint,
            kupmiosHeaders,
            fetchImpl: config.fetchImpl ?? fetch,
            traceRegistryClient,
        };
    }
    async function getContext() {
        if (!cachedContextPromise) {
            cachedContextPromise = createContext().catch((error) => {
                cachedContextPromise = null;
                throw error;
            });
        }
        return cachedContextPromise;
    }
    async function buildUnsignedTransfer(body) {
        // Lucid wallet selection and IBC tree state are shared by the runtime context.
        const buildId = ++transferBuildCounter;
        const scope = `[transfer:${buildId}]`;
        return transferBuildQueue.runExclusive(() => buildUnsignedTransferUnsafe(body, scope));
    }
    async function buildUnsignedTransferUnsafe(body, scope) {
        const buildStartedAt = startTimer();
        logger.log(`${scope} preparing unsigned Cardano transfer`);
        const context = await timed(logger, scope, 'get runtime context', getContext);
        const sendPacketOperator = parseSendPacketOperator(body);
        const providedWalletUtxos = parseWalletUtxos(body.wallet_utxos);
        logger.log(`${scope} parsed request for ${sendPacketOperator.signer}; provided wallet UTxOs=${providedWalletUtxos.length}`);
        const getWalletUtxos = async (address, options) => {
            const providedWalletUtxosForAddress = dedupeUtxos(providedWalletUtxos.filter((utxo) => utxo.address === address));
            const providerWalletUtxos = await timed(logger, scope, `provider wallet UTxO lookup for ${address}`, () => context.lucidService.tryFindUtxosAt(address, options));
            if (providedWalletUtxosForAddress.length > 0) {
                const providerRefs = new Set(providerWalletUtxos.map(utxoRef));
                // Browser wallet UTxOs are hints; keep only refs still live according to the node.
                const liveProvidedWalletUtxos = providedWalletUtxosForAddress.filter((utxo) => providerRefs.has(utxoRef(utxo)));
                const staleProvidedCount = providedWalletUtxosForAddress.length - liveProvidedWalletUtxos.length;
                const mergedWalletUtxos = dedupeUtxos([...liveProvidedWalletUtxos, ...providerWalletUtxos]);
                logger.log(`${scope} wallet UTxO live validation for ${address}: provided=${providedWalletUtxosForAddress.length}, stale_provided=${staleProvidedCount}, provider=${providerWalletUtxos.length}, merged=${mergedWalletUtxos.length}`);
                return mergedWalletUtxos;
            }
            logger.log(`${scope} wallet UTxO lookup for ${address}: provider=${providerWalletUtxos.length}`);
            return providerWalletUtxos;
        };
        const findWalletUtxoAtWithUnit = async (address, unit) => {
            const liveWalletUtxos = await getWalletUtxos(address, LOOKUP_RETRY_OPTIONS);
            const liveMatch = liveWalletUtxos.find((utxo) => Object.prototype.hasOwnProperty.call(utxo.assets, unit));
            if (liveMatch) {
                return liveMatch;
            }
            return context.lucidService.findUtxoAtWithUnit(address, unit);
        };
        const initialWalletUtxos = await timed(logger, scope, 'load initial wallet UTxOs', () => getWalletUtxos(sendPacketOperator.signer, LOOKUP_RETRY_OPTIONS));
        if (initialWalletUtxos.length === 0) {
            throw new Error(`sendPacketBuilder failed: no spendable UTxOs found for ${sendPacketOperator.signer}`);
        }
        logger.log(`${scope} initial wallet UTxOs selected=${initialWalletUtxos.length}`);
        context.lucidService.selectWalletFromAddress(sendPacketOperator.signer, initialWalletUtxos);
        const { unsignedTx, walletOverride } = await timed(logger, scope, 'build send_packet tx skeleton', () => (0, tx_builder_1.buildUnsignedSendPacketTx)(sendPacketOperator, {
            loadContext: async (operator) => {
                const loadContextStartedAt = startTimer();
                try {
                    const channelSequence = operator.sourceChannel.replace('channel-', '');
                    const [mintChannelPolicyId, channelTokenName] = context.lucidService.getChannelTokenUnit(BigInt(channelSequence));
                    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
                    const channelUtxo = await timed(logger, scope, 'load channel UTxO', () => context.lucidService.findUtxoByUnit(channelTokenUnit));
                    const channelDatum = await timed(logger, scope, 'decode channel datum', () => context.lucidService.decodeDatum(channelUtxo.datum, 'channel'));
                    const [mintConnectionPolicyId, connectionTokenName] = context.lucidService.getConnectionTokenUnit(parseConnectionSequence(convertHex2String(channelDatum.state.channel.connection_hops[0])));
                    const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
                    const connectionUtxo = await timed(logger, scope, 'load connection UTxO', () => context.lucidService.findUtxoByUnit(connectionTokenUnit));
                    const connectionDatum = await timed(logger, scope, 'decode connection datum', () => context.lucidService.decodeDatum(connectionUtxo.datum, 'connection'));
                    const clientTokenUnit = context.lucidService.getClientTokenUnit(parseClientSequence(convertHex2String(connectionDatum.state.client_id)).toString());
                    const clientUtxo = await timed(logger, scope, 'load client UTxO', () => context.lucidService.findUtxoByUnit(clientTokenUnit));
                    const transferModuleIdentifier = context.deployment.modules.transfer.identifier;
                    const transferModuleReferenceUtxo = await timed(logger, scope, 'load transfer module reference UTxO', () => context.lucidService.findUtxoByUnit(transferModuleIdentifier));
                    const deployment = context.deployment;
                    const spendChannelAddress = deployment.validators.spendChannel.address;
                    if (!spendChannelAddress) {
                        throw new Error('Spend channel script address is missing from deployment config');
                    }
                    return {
                        channelUtxo,
                        channelDatum,
                        connectionUtxo,
                        connectionDatum,
                        clientUtxo,
                        transferModuleReferenceUtxo,
                        channelTokenUnit,
                        channelToken: {
                            policyId: mintChannelPolicyId,
                            name: channelTokenName,
                        },
                        deployment: {
                            sendPacketPolicyId: deployment.validators.spendChannel.refValidator.send_packet.scriptHash,
                            mintVoucherScriptHash: deployment.validators.mintVoucher.scriptHash,
                            transferEscrowShardPolicyId: deployment.validators.mintTransferEscrowShard.scriptHash,
                            spendChannelAddress,
                            transferModuleAddress: deployment.modules.transfer.address,
                            transferModuleIdentifier: deployment.modules.transfer.identifier,
                        },
                    };
                }
                finally {
                    logger.log(`${scope} load builder context completed in ${elapsedMs(loadContextStartedAt)}`);
                }
            },
            buildHostStateUpdate: (inputChannelDatum, outputChannelDatum, channelIdForRoot) => timed(logger, scope, 'build host-state update', () => buildHostStateUpdateForHandlePacket(context, inputChannelDatum, outputChannelDatum, channelIdForRoot)),
            resolveIbcDenomHash: async (denomHash) => {
                const match = await timed(logger, scope, `resolve denom hash ${denomHash}`, () => context.traceRegistryClient.lookupIbcDenomTrace(denomHash));
                if (!match) {
                    return null;
                }
                return {
                    path: match.path,
                    baseDenom: match.baseDenom,
                };
            },
            commitPacket: (packet) => commitPacket(packet),
            encode: (value, kind) => context.lucidService.encode(value, kind),
            findUtxoAtWithUnit: findWalletUtxoAtWithUnit,
            tryFindUtxosAt: getWalletUtxos,
            buildTransferModuleVoucherSupplyUpdate: async (moduleUtxo, voucherDelta) => {
                if (!moduleUtxo.datum) {
                    throw new Error('Transfer module datum is required for voucher supply accounting');
                }
                const datum = await context.lucidService.decodeDatum(moduleUtxo.datum, 'transferModule');
                const voucherSupply = datum.voucher_supply + voucherDelta;
                if (voucherSupply < 0n) {
                    throw new Error('Voucher supply update would become negative');
                }
                return context.lucidService.encode({ ...datum, voucher_supply: voucherSupply }, 'transferModule');
            },
            findTransferEscrowShard: (channelId, packetDenom, denomToken, principalDelta) => timed(logger, scope, 'find transfer escrow shard', () => findTransferEscrowShard(context, channelId, packetDenom, denomToken, principalDelta)),
            createUnsignedSendPacketBurnTx: (dto) => context.lucidService.createUnsignedSendPacketBurnTx(dto),
            createUnsignedSendPacketEscrowTx: (dto) => context.lucidService.createUnsignedSendPacketEscrowTx(dto),
            invalidArgument: (message) => new Error(message),
            internalError: (message) => new Error(message),
        }));
        if (!walletOverride) {
            throw new Error('sendPacket failed: wallet override context was not produced');
        }
        const { currentSlot, validFromTime, validToSlot, validToTime } = await timed(logger, scope, 'compute validity window', () => computeTxValidityWindow(context));
        if (currentSlot > validToSlot) {
            throw new Error('sendPacket failed: tx time invalid');
        }
        const walletScopeId = context.lucidService.beginWalletSelectionScope();
        try {
            const refreshedUtxos = await timed(logger, scope, 'refresh wallet UTxOs before completion', () => getWalletUtxos(walletOverride.address, LOOKUP_RETRY_OPTIONS));
            const overrideUtxos = walletOverride.utxos ?? [];
            const mergedUtxos = dedupeUtxos([...overrideUtxos, ...refreshedUtxos]);
            const utxosToUse = mergedUtxos.length > 0 ? mergedUtxos : overrideUtxos;
            logger.log(`${scope} completion wallet UTxOs: override=${overrideUtxos.length}, refreshed=${refreshedUtxos.length}, using=${utxosToUse.length}`);
            context.lucidService.selectWalletFromAddress(walletOverride.address, utxosToUse);
            context.lucidService.assertWalletSelectionScopeSatisfied(walletScopeId, 'sendPacket');
            const completedUnsignedTx = await timed(logger, scope, 'complete unsigned tx', () => unsignedTx.validFrom(validFromTime).validTo(validToTime).complete({
                localUPLCEval: true,
                setCollateral: TRANSACTION_SET_COLLATERAL,
            }));
            const unsignedTxCbor = completedUnsignedTx.toCBOR();
            const feeLovelace = completedUnsignedTx.toTransaction().body().fee().toString();
            logger.log(`${scope} prepared unsigned Cardano transfer in ${elapsedMs(buildStartedAt)}`);
            return {
                result: 0,
                unsignedTx: {
                    type_url: '',
                    unsignedTxCborHex: unsignedTxCbor,
                },
                feeLovelace,
            };
        }
        finally {
            context.lucidService.endWalletSelectionScope(walletScopeId);
        }
    }
    async function submitSignedTransaction(body) {
        const submitId = ++transferBuildCounter;
        const scope = `[submit:${submitId}]`;
        const submitStartedAt = startTimer();
        const signedTxCbor = parseRequiredString(body.signed_tx_cbor, 'signed_tx_cbor');
        const description = typeof body.description === 'string' && body.description.trim()
            ? body.description.trim()
            : 'Cardano signed transaction';
        if (!/^[0-9a-f]+$/i.test(signedTxCbor) || signedTxCbor.length % 2 !== 0) {
            throw new Error('Invalid argument: "signed_tx_cbor" must be even-length hex CBOR');
        }
        logger.log(`${scope} submitting ${description}; signedTxLength=${signedTxCbor.length}`);
        const context = await timed(logger, scope, 'get runtime context', getContext);
        const txHash = await timed(logger, scope, 'submit signed transaction via Ogmios', () => submitSignedTxCbor(context.ogmiosEndpoint, signedTxCbor, context.kupmiosHeaders?.ogmiosHeader, config.fetchImpl ?? fetch));
        logger.log(`${scope} submitted signed Cardano transaction ${txHash} in ${elapsedMs(submitStartedAt)}`);
        return { txHash };
    }
    return {
        buildUnsignedTransfer,
        submitSignedTransaction,
    };
}
