"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTxBuilderRuntime = createTxBuilderRuntime;
const crypto_1 = __importDefault(require("crypto"));
const tx_builder_1 = require("@cardano-ibc/tx-builder");
const trace_registry_1 = require("@cardano-ibc/trace-registry");
const ws_1 = __importDefault(require("ws"));
const ibcStateRoot_1 = require("./ibcStateRoot");
const lucidIbcAdapter_1 = require("./lucidIbcAdapter");
const LOOKUP_RETRY_OPTIONS = {
    maxAttempts: 6,
    retryDelayMs: 1000,
};
const TRANSACTION_TIME_TO_LIVE = 120_000;
const TRANSACTION_SET_COLLATERAL = BigInt(20_000_000);
const MAX_SAFE_COST_MODEL_VALUE = Number.MAX_SAFE_INTEGER;
const PROTOCOL_PARAMETERS_MAX_ATTEMPTS = 5;
const PROTOCOL_PARAMETERS_BASE_DELAY_MS = 1000;
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
function defaultLogger(scope) {
    return {
        log: (...args) => console.log(`[${scope}]`, ...args),
        warn: (...args) => console.warn(`[${scope}]`, ...args),
        error: (...args) => console.error(`[${scope}]`, ...args),
    };
}
function mapRefUtxo(refUtxo) {
    return {
        txHash: refUtxo.tx_hash,
        outputIndex: refUtxo.output_index,
    };
}
function mapValidator(validator) {
    return {
        scriptHash: validator.script_hash,
        address: validator.address,
        refUtxo: mapRefUtxo(validator.ref_utxo),
    };
}
function normalizeBridgeManifest(manifest) {
    return {
        bridgeManifest: manifest,
        deployment: {
            deployedAt: manifest.deployed_at,
            hostStateNFT: {
                policyId: manifest.host_state_nft.policy_id,
                name: manifest.host_state_nft.token_name,
            },
            handlerAuthToken: {
                policyId: manifest.handler_auth_token.policy_id,
                name: manifest.handler_auth_token.token_name,
            },
            validators: {
                hostStateStt: mapValidator(manifest.validators.host_state_stt),
                spendHandler: mapValidator(manifest.validators.spend_handler),
                spendClient: mapValidator(manifest.validators.spend_client),
                spendConnection: mapValidator(manifest.validators.spend_connection),
                spendChannel: {
                    ...mapValidator(manifest.validators.spend_channel),
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
                ...(manifest.validators.spend_trace_registry
                    ? {
                        spendTraceRegistry: mapValidator(manifest.validators.spend_trace_registry),
                    }
                    : {}),
                spendTransferModule: mapValidator(manifest.validators.spend_transfer_module),
                mintIdentifier: mapValidator(manifest.validators.mint_identifier),
                verifyProof: mapValidator(manifest.validators.verify_proof),
                mintClientStt: mapValidator(manifest.validators.mint_client_stt),
                mintConnectionStt: mapValidator(manifest.validators.mint_connection_stt),
                mintChannelStt: mapValidator(manifest.validators.mint_channel_stt),
                mintVoucher: mapValidator(manifest.validators.mint_voucher),
            },
            modules: {
                handler: manifest.modules.handler,
                transfer: manifest.modules.transfer,
                ...(manifest.modules.mock ? { mock: manifest.modules.mock } : {}),
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
        },
    };
}
function splitKupmiosUrl(kupmiosUrl) {
    const [kupoEndpoint, ogmiosEndpoint] = kupmiosUrl.split(',').map((value) => value.trim());
    if (!kupoEndpoint || !ogmiosEndpoint) {
        throw new Error('kupmiosUrl must be "<kupoEndpoint>,<ogmiosEndpoint>"');
    }
    return { kupoEndpoint, ogmiosEndpoint };
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
function ogmiosRequest(ogmiosUrl, methodName, args) {
    return new Promise(async (resolve, reject) => {
        const client = new ws_1.default(ogmiosUrl);
        const cleanup = () => {
            if (client.readyState === ws_1.default.OPEN || client.readyState === ws_1.default.CONNECTING) {
                client.close();
            }
        };
        client.once('open', () => {
            client.send(JSON.stringify({
                jsonrpc: '2.0',
                method: methodName,
                params: args,
            }));
        });
        client.once('message', (rawMessage) => {
            try {
                const payload = JSON.parse(rawMessage.toString());
                if (payload?.error) {
                    reject(new Error(payload.error.message ?? JSON.stringify(payload.error)));
                    return;
                }
                resolve(payload.result);
            }
            catch (error) {
                reject(error);
            }
            finally {
                cleanup();
            }
        });
        client.once('error', (error) => {
            cleanup();
            reject(error);
        });
    });
}
async function querySystemStart(ogmiosUrl) {
    const systemStart = await ogmiosRequest(ogmiosUrl, 'queryNetwork/startTime', {});
    return Date.parse(systemStart);
}
async function queryNetworkTipPoint(ogmiosUrl) {
    const result = await ogmiosRequest(ogmiosUrl, 'queryNetwork/tip', {});
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
function sanitizeProtocolParameters(protocolParameters) {
    if (!protocolParameters?.costModels) {
        return protocolParameters;
    }
    const sanitizedCostModels = {};
    for (const [version, model] of Object.entries(protocolParameters.costModels)) {
        const sanitizedModel = {};
        for (const [index, value] of Object.entries(model ?? {})) {
            sanitizedModel[index] = toSafeCostModelInteger(value);
        }
        sanitizedCostModels[version] = sanitizedModel;
    }
    return {
        ...protocolParameters,
        costModels: sanitizedCostModels,
    };
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
            visit(record.cause, depth + 1);
            visit(record.error, depth + 1);
            visit(record.originalError, depth + 1);
        }
    };
    visit(error, 0);
    return signals;
}
function isTransientStartupError(error) {
    const normalizedSignals = collectErrorSignals(error).map((signal) => signal.toLowerCase());
    return normalizedSignals.some((signal) => TRANSIENT_STARTUP_ERROR_MARKERS.some((marker) => signal.includes(marker)));
}
function computeJitteredBackoffDelayMs(failedAttempt) {
    const backoffDelay = PROTOCOL_PARAMETERS_BASE_DELAY_MS * 2 ** Math.max(0, failedAttempt - 1);
    const jitterMultiplier = 0.8 + Math.random() * 0.4;
    return Math.round(backoffDelay * jitterMultiplier);
}
async function retryWithBackoff(operation) {
    for (let attempt = 1; attempt <= PROTOCOL_PARAMETERS_MAX_ATTEMPTS; attempt += 1) {
        try {
            return await operation();
        }
        catch (error) {
            if (!isTransientStartupError(error) || attempt >= PROTOCOL_PARAMETERS_MAX_ATTEMPTS) {
                throw error;
            }
            const retryDelayMs = computeJitteredBackoffDelayMs(attempt);
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
    }
    throw new Error('Kupmios protocol parameters fetch failed');
}
async function createLucidRuntime(kupoEndpoint, ogmiosEndpoint, cardanoNetwork) {
    const Lucid = await eval(`import('@lucid-evolution/lucid')`);
    const provider = new Lucid.Kupmios(kupoEndpoint, ogmiosEndpoint);
    const protocolParameters = sanitizeProtocolParameters(await retryWithBackoff(() => provider.getProtocolParameters()));
    const lucid = await Lucid.Lucid(provider, cardanoNetwork, {
        presetProtocolParameters: protocolParameters,
    });
    const chainZeroTime = await querySystemStart(ogmiosEndpoint);
    Lucid.SLOT_CONFIG_NETWORK[cardanoNetwork].zeroTime = chainZeroTime;
    Lucid.SLOT_CONFIG_NETWORK[cardanoNetwork].slotLength = 1000;
    return {
        lucidImporter: Lucid,
        lucid,
    };
}
class RuntimeKupoService {
    lucidService;
    clientTokenPrefix;
    connectionTokenPrefix;
    channelTokenPrefix;
    clientAddress;
    connectionAddress;
    channelAddress;
    constructor(lucidService, deployment) {
        this.lucidService = lucidService;
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
        catch {
            return [];
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
}
function dedupeUtxos(utxos) {
    const seen = new Map();
    const orderedKeys = [];
    for (const utxo of utxos) {
        const key = `${utxo.txHash}#${utxo.outputIndex}`;
        if (!seen.has(key)) {
            orderedKeys.push(key);
        }
        seen.set(key, utxo);
    }
    return orderedKeys.map((key) => seen.get(key)).filter(Boolean);
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
    const tip = await queryNetworkTipPoint(context.ogmiosEndpoint);
    const currentSlot = tip === 'origin' ? 0 : tip.slot;
    const ttlSlots = Math.max(1, Math.ceil(TRANSACTION_TIME_TO_LIVE / 1000));
    const validToSlot = currentSlot + ttlSlots;
    const slotConfig = context.lucidService.LucidImporter.SLOT_CONFIG_NETWORK?.[context.cardanoNetwork];
    if (!slotConfig || slotConfig.slotLength <= 0) {
        throw new Error(`Invalid Cardano slot configuration for network ${context.cardanoNetwork}`);
    }
    const validToTime = slotConfig.zeroTime + (validToSlot + 1 - slotConfig.zeroSlot) * slotConfig.slotLength - 1;
    return {
        currentSlot,
        validToSlot,
        validToTime,
    };
}
function createTxBuilderRuntime(config) {
    const logger = config.logger ?? defaultLogger('txBuilderRuntime');
    let cachedContextPromise = null;
    const traceRegistryClient = (0, trace_registry_1.createTraceRegistryClient)({
        bridgeManifestUrl: config.bridgeManifestUrl,
        kupmiosUrl: config.kupmiosUrl,
        fetchImpl: config.fetchImpl,
    });
    async function getBridgeManifest() {
        const fetchImpl = config.fetchImpl ?? fetch;
        const response = await fetchImpl(config.bridgeManifestUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Failed to load bridge manifest from ${config.bridgeManifestUrl}: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
    async function createContext() {
        const manifest = await getBridgeManifest();
        const { deployment, bridgeManifest } = normalizeBridgeManifest(manifest);
        const { kupoEndpoint, ogmiosEndpoint } = splitKupmiosUrl(config.kupmiosUrl);
        const cardanoNetwork = bridgeManifest.cardano.network;
        const { lucidImporter, lucid } = await createLucidRuntime(kupoEndpoint, ogmiosEndpoint, cardanoNetwork);
        const lucidService = new lucidIbcAdapter_1.LucidIbcAdapter(lucidImporter, lucid, deployment);
        await lucidService.onModuleInit();
        const kupoService = new RuntimeKupoService(lucidService, deployment);
        (0, ibcStateRoot_1.initTreeServices)(kupoService, lucidService);
        await (0, ibcStateRoot_1.rebuildTreeFromChain)(kupoService, lucidService);
        logger.log('Initialized shared Cardano tx-builder runtime context');
        return {
            deployment,
            lucidService,
            logger,
            cardanoNetwork,
            ogmiosEndpoint,
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
        const context = await getContext();
        const sendPacketOperator = parseSendPacketOperator(body);
        const initialWalletUtxos = await context.lucidService.tryFindUtxosAt(sendPacketOperator.sender, LOOKUP_RETRY_OPTIONS);
        if (initialWalletUtxos.length === 0) {
            throw new Error(`sendPacketBuilder failed: no spendable UTxOs found for ${sendPacketOperator.sender}`);
        }
        context.lucidService.selectWalletFromAddress(sendPacketOperator.sender, initialWalletUtxos);
        const { unsignedTx, walletOverride } = await (0, tx_builder_1.buildUnsignedSendPacketTx)(sendPacketOperator, {
            loadContext: async (operator) => {
                const channelSequence = operator.sourceChannel.replace('channel-', '');
                const [mintChannelPolicyId, channelTokenName] = context.lucidService.getChannelTokenUnit(BigInt(channelSequence));
                const channelTokenUnit = mintChannelPolicyId + channelTokenName;
                const channelUtxo = await context.lucidService.findUtxoByUnit(channelTokenUnit);
                const channelDatum = await context.lucidService.decodeDatum(channelUtxo.datum, 'channel');
                const [mintConnectionPolicyId, connectionTokenName] = context.lucidService.getConnectionTokenUnit(parseConnectionSequence(convertHex2String(channelDatum.state.channel.connection_hops[0])));
                const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
                const connectionUtxo = await context.lucidService.findUtxoByUnit(connectionTokenUnit);
                const connectionDatum = await context.lucidService.decodeDatum(connectionUtxo.datum, 'connection');
                const clientTokenUnit = context.lucidService.getClientTokenUnit(parseClientSequence(convertHex2String(connectionDatum.state.client_id)).toString());
                const clientUtxo = await context.lucidService.findUtxoByUnit(clientTokenUnit);
                const transferModuleIdentifier = context.deployment.modules.transfer.identifier;
                const transferModuleUtxo = await context.lucidService.findUtxoByUnit(transferModuleIdentifier);
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
                    transferModuleUtxo,
                    channelTokenUnit,
                    channelToken: {
                        policyId: mintChannelPolicyId,
                        name: channelTokenName,
                    },
                    deployment: {
                        sendPacketPolicyId: deployment.validators.spendChannel.refValidator.send_packet.scriptHash,
                        mintVoucherScriptHash: deployment.validators.mintVoucher.scriptHash,
                        spendChannelAddress,
                        transferModuleAddress: deployment.modules.transfer.address,
                    },
                };
            },
            buildHostStateUpdate: (inputChannelDatum, outputChannelDatum, channelIdForRoot) => buildHostStateUpdateForHandlePacket(context, inputChannelDatum, outputChannelDatum, channelIdForRoot),
            resolveIbcDenomHash: async (denomHash) => {
                const match = await context.traceRegistryClient.lookupIbcDenomTrace(denomHash);
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
            findUtxoAtWithUnit: (address, unit) => context.lucidService.findUtxoAtWithUnit(address, unit),
            tryFindUtxosAt: (address, options) => context.lucidService.tryFindUtxosAt(address, options),
            createUnsignedSendPacketBurnTx: (dto) => context.lucidService.createUnsignedSendPacketBurnTx(dto),
            createUnsignedSendPacketEscrowTx: (dto) => context.lucidService.createUnsignedSendPacketEscrowTx(dto),
            invalidArgument: (message) => new Error(message),
            internalError: (message) => new Error(message),
        });
        if (!walletOverride) {
            throw new Error('sendPacket failed: wallet override context was not produced');
        }
        const { currentSlot, validToSlot, validToTime } = await computeTxValidityWindow(context);
        if (currentSlot > validToSlot) {
            throw new Error('sendPacket failed: tx time invalid');
        }
        const walletScopeId = context.lucidService.beginWalletSelectionScope();
        try {
            const refreshedUtxos = await context.lucidService.tryFindUtxosAt(walletOverride.address, LOOKUP_RETRY_OPTIONS);
            const mergedUtxos = dedupeUtxos([...(walletOverride.utxos ?? []), ...refreshedUtxos]);
            const utxosToUse = mergedUtxos.length > 0 ? mergedUtxos : walletOverride.utxos;
            context.lucidService.selectWalletFromAddress(walletOverride.address, utxosToUse);
            context.lucidService.assertWalletSelectionScopeSatisfied(walletScopeId, 'sendPacket');
            const completedUnsignedTx = await unsignedTx.validTo(validToTime).complete({
                localUPLCEval: false,
                setCollateral: TRANSACTION_SET_COLLATERAL,
            });
            const unsignedTxCbor = completedUnsignedTx.toCBOR();
            const unsignedTxBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
            return {
                result: 0,
                unsignedTx: {
                    type_url: '',
                    value: Buffer.from(unsignedTxBytes).toString('base64'),
                },
            };
        }
        finally {
            context.lucidService.endWalletSelectionScope(walletScopeId);
        }
    }
    return {
        buildUnsignedTransfer,
    };
}
