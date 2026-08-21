"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initTreeServices = initTreeServices;
exports.isTreeAligned = isTreeAligned;
exports.alignTreeWithChain = alignTreeWithChain;
exports.computeRootWithOrderedUpdates = computeRootWithOrderedUpdates;
exports.computeRootWithHandlePacketUpdate = computeRootWithHandlePacketUpdate;
exports.committedModulePortIdHex = committedModulePortIdHex;
exports.rebuildTreeFromChain = rebuildTreeFromChain;
const ics23MerkleTree_1 = require("./ics23MerkleTree");
let currentTree = new ics23MerkleTree_1.ICS23MerkleTree();
let cachedKupoService = null;
let cachedLucidService = null;
function initTreeServices(kupoService, lucidService) {
    cachedKupoService = kupoService;
    cachedLucidService = lucidService;
}
function isTreeAligned(onChainRoot) {
    if (onChainRoot === "0".repeat(64)) {
        return currentTree.getRoot() === onChainRoot;
    }
    return currentTree.getRoot() === onChainRoot;
}
async function alignTreeWithChain() {
    if (!cachedKupoService || !cachedLucidService) {
        throw new Error("Tree services not initialized. Call initTreeServices() first.");
    }
    const result = await rebuildTreeFromChain(cachedKupoService, cachedLucidService);
    return { root: result.root };
}
function getClonedTreeFromRoot(rootHash) {
    if (rootHash === "0".repeat(64)) {
        return new ics23MerkleTree_1.ICS23MerkleTree();
    }
    const currentRoot = currentTree.getRoot();
    if (currentRoot === rootHash) {
        return currentTree.clone();
    }
    throw new Error(`Tree out of sync with on-chain state. Expected root ${rootHash.substring(0, 16)}..., but in-memory root is ${currentRoot.substring(0, 16)}...`);
}
/**
 * Apply an ordered batch of HostState commitment updates atomically. This is
 * intentionally generic so lifecycle builders can compose the exact leaf
 * deletions and dependency-count updates required by their on-chain witnesses.
 */
function computeRootWithOrderedUpdates(oldRoot, updates) {
    const speculativeTree = getClonedTreeFromRoot(oldRoot);
    const siblings = [];
    for (const update of updates) {
        siblings.push(speculativeTree
            .getSiblings(update.path)
            .map((hash) => hash.toString("hex")));
        speculativeTree.set(update.path, update.newValue);
    }
    return {
        newRoot: speculativeTree.getRoot(),
        siblings,
        commit: () => {
            currentTree = speculativeTree;
        },
    };
}
async function encodeClientStateValue(clientState, Lucid) {
    const { Data } = Lucid;
    const RationalSchema = Data.Object({
        numerator: Data.Integer(),
        denominator: Data.Integer(),
    });
    const HeightSchema = Data.Object({
        revisionNumber: Data.Integer(),
        revisionHeight: Data.Integer(),
    });
    const LeafOpSchema = Data.Object({
        hash: Data.Integer(),
        prehash_key: Data.Integer(),
        prehash_value: Data.Integer(),
        length: Data.Integer(),
        prefix: Data.Bytes(),
    });
    const InnerSpecSchema = Data.Object({
        child_order: Data.Array(Data.Integer()),
        child_size: Data.Integer(),
        min_prefix_length: Data.Integer(),
        max_prefix_length: Data.Integer(),
        empty_child: Data.Bytes(),
        hash: Data.Integer(),
    });
    const ProofSpecSchema = Data.Object({
        leaf_spec: LeafOpSchema,
        inner_spec: InnerSpecSchema,
        max_depth: Data.Integer(),
        min_depth: Data.Integer(),
        prehash_key_before_comparison: Data.Boolean(),
    });
    const ClientStateSchema = Data.Object({
        chainId: Data.Bytes(),
        trustLevel: RationalSchema,
        trustingPeriod: Data.Integer(),
        unbondingPeriod: Data.Integer(),
        maxClockDrift: Data.Integer(),
        frozenHeight: HeightSchema,
        latestHeight: HeightSchema,
        proofSpecs: Data.Array(ProofSpecSchema),
    });
    return Data.to(clientState, ClientStateSchema);
}
async function encodeConsensusStateValue(consensusState, Lucid) {
    const { Data } = Lucid;
    const MerkleRootSchema = Data.Object({
        hash: Data.Bytes(),
    });
    const ConsensusStateSchema = Data.Object({
        timestamp: Data.Integer(),
        next_validators_hash: Data.Bytes(),
        root: MerkleRootSchema,
    });
    return Data.to(consensusState, ConsensusStateSchema);
}
async function encodeConnectionEndValue(connectionEnd, Lucid) {
    const { Data } = Lucid;
    const VersionSchema = Data.Object({
        identifier: Data.Bytes(),
        features: Data.Array(Data.Bytes()),
    });
    const StateSchema = Data.Enum([
        Data.Literal("Uninitialized"),
        Data.Literal("Init"),
        Data.Literal("TryOpen"),
        Data.Literal("Open"),
    ]);
    const MerklePrefixSchema = Data.Object({
        key_prefix: Data.Bytes(),
    });
    const CounterpartySchema = Data.Object({
        client_id: Data.Bytes(),
        connection_id: Data.Bytes(),
        prefix: MerklePrefixSchema,
    });
    const ConnectionEndSchema = Data.Object({
        client_id: Data.Bytes(),
        versions: Data.Array(VersionSchema),
        state: StateSchema,
        counterparty: CounterpartySchema,
        delay_period: Data.Integer(),
    });
    return Data.to(connectionEnd, ConnectionEndSchema);
}
async function encodeChannelEndValue(channelEnd, Lucid) {
    const { Data } = Lucid;
    const StateSchema = Data.Enum([
        Data.Literal("Uninitialized"),
        Data.Literal("Init"),
        Data.Literal("TryOpen"),
        Data.Literal("Open"),
        Data.Literal("Close"),
    ]);
    const OrderSchema = Data.Enum([
        Data.Literal("None"),
        Data.Literal("Unordered"),
        Data.Literal("Ordered"),
    ]);
    const ChannelCounterpartySchema = Data.Object({
        port_id: Data.Bytes(),
        channel_id: Data.Bytes(),
    });
    const ChannelSchema = Data.Object({
        state: StateSchema,
        ordering: OrderSchema,
        counterparty: ChannelCounterpartySchema,
        connection_hops: Data.Array(Data.Bytes()),
        version: Data.Bytes(),
    });
    return Data.to(channelEnd, ChannelSchema);
}
async function computeRootWithHandlePacketUpdate(oldRoot, portId, channelId, inputChannelDatum, outputChannelDatum, Lucid) {
    const speculativeTree = getClonedTreeFromRoot(oldRoot);
    const { Data } = Lucid;
    const encodePacketStoreValue = (bytesHex) => Buffer.from(Data.to(bytesHex, Data.Bytes()), "hex");
    const channelPath = `channelEnds/ports/${portId}/channels/${channelId}`;
    let channelSiblings = [];
    if (inputChannelDatum.state.channel !== outputChannelDatum.state.channel) {
        const newChannelValue = Buffer.from(await encodeChannelEndValue(outputChannelDatum.state.channel, Lucid), "hex");
        channelSiblings = speculativeTree
            .getSiblings(channelPath)
            .map((h) => h.toString("hex"));
        speculativeTree.set(channelPath, newChannelValue);
    }
    const nextSequenceSendPath = `nextSequenceSend/ports/${portId}/channels/${channelId}`;
    let nextSequenceSendSiblings = [];
    if (inputChannelDatum.state.next_sequence_send !==
        outputChannelDatum.state.next_sequence_send) {
        const newValue = Buffer.from(Data.to(outputChannelDatum.state.next_sequence_send, Data.Integer()), "hex");
        nextSequenceSendSiblings = speculativeTree
            .getSiblings(nextSequenceSendPath)
            .map((h) => h.toString("hex"));
        speculativeTree.set(nextSequenceSendPath, newValue);
    }
    const nextSequenceRecvPath = `nextSequenceRecv/ports/${portId}/channels/${channelId}`;
    let nextSequenceRecvSiblings = [];
    if (inputChannelDatum.state.next_sequence_recv !==
        outputChannelDatum.state.next_sequence_recv) {
        const newValue = Buffer.from(Data.to(outputChannelDatum.state.next_sequence_recv, Data.Integer()), "hex");
        nextSequenceRecvSiblings = speculativeTree
            .getSiblings(nextSequenceRecvPath)
            .map((h) => h.toString("hex"));
        speculativeTree.set(nextSequenceRecvPath, newValue);
    }
    const nextSequenceAckPath = `nextSequenceAck/ports/${portId}/channels/${channelId}`;
    let nextSequenceAckSiblings = [];
    if (inputChannelDatum.state.next_sequence_ack !==
        outputChannelDatum.state.next_sequence_ack) {
        const newValue = Buffer.from(Data.to(outputChannelDatum.state.next_sequence_ack, Data.Integer()), "hex");
        nextSequenceAckSiblings = speculativeTree
            .getSiblings(nextSequenceAckPath)
            .map((h) => h.toString("hex"));
        speculativeTree.set(nextSequenceAckPath, newValue);
    }
    const inputCommitments = Array.from(inputChannelDatum.state.packet_commitment.entries());
    const outputCommitments = Array.from(outputChannelDatum.state.packet_commitment.entries());
    const insertedCommitments = outputCommitments.filter(([seq]) => !inputChannelDatum.state.packet_commitment.has(seq));
    const removedCommitments = inputCommitments.filter(([seq]) => !outputChannelDatum.state.packet_commitment.has(seq));
    let packetCommitmentSiblings = [];
    if (insertedCommitments.length > 0) {
        if (removedCommitments.length !== 0 || insertedCommitments.length !== 1) {
            throw new Error(`HandlePacket root update expects exactly one commitment insertion and no deletions; got ${insertedCommitments.length} insertions and ${removedCommitments.length} deletions`);
        }
        const [sequence, commitmentBytes] = insertedCommitments[0];
        const key = `commitments/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
        packetCommitmentSiblings = speculativeTree
            .getSiblings(key)
            .map((h) => h.toString("hex"));
        speculativeTree.set(key, encodePacketStoreValue(commitmentBytes));
    }
    else if (removedCommitments.length > 0) {
        if (removedCommitments.length !== 1) {
            throw new Error(`HandlePacket root update expects exactly one commitment deletion; got ${removedCommitments.length}`);
        }
        const [sequence] = removedCommitments[0];
        const key = `commitments/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
        packetCommitmentSiblings = speculativeTree
            .getSiblings(key)
            .map((h) => h.toString("hex"));
        speculativeTree.set(key, Buffer.alloc(0));
    }
    const inputReceipts = Array.from(inputChannelDatum.state.packet_receipt.entries());
    const outputReceipts = Array.from(outputChannelDatum.state.packet_receipt.entries());
    const insertedReceipts = outputReceipts.filter(([seq]) => !inputChannelDatum.state.packet_receipt.has(seq));
    const removedReceipts = inputReceipts.filter(([seq]) => !outputChannelDatum.state.packet_receipt.has(seq));
    let packetReceiptSiblings = [];
    if (insertedReceipts.length > 0) {
        if (removedReceipts.length !== 0 || insertedReceipts.length !== 1) {
            throw new Error(`HandlePacket root update expects receipts to only ever insert a single entry; got ${insertedReceipts.length} insertions and ${removedReceipts.length} deletions`);
        }
        const [sequence, receiptBytes] = insertedReceipts[0];
        const key = `receipts/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
        packetReceiptSiblings = speculativeTree
            .getSiblings(key)
            .map((h) => h.toString("hex"));
        speculativeTree.set(key, encodePacketStoreValue(receiptBytes));
    }
    else if (removedReceipts.length > 0) {
        throw new Error("HandlePacket root update does not allow receipt deletions");
    }
    const inputAcks = Array.from(inputChannelDatum.state.packet_acknowledgement.entries());
    const outputAcks = Array.from(outputChannelDatum.state.packet_acknowledgement.entries());
    const insertedAcks = outputAcks.filter(([seq]) => !inputChannelDatum.state.packet_acknowledgement.has(seq));
    const removedAcks = inputAcks.filter(([seq]) => !outputChannelDatum.state.packet_acknowledgement.has(seq));
    let packetAcknowledgementSiblings = [];
    if (insertedAcks.length > 0) {
        if (removedAcks.length !== 0 || insertedAcks.length !== 1) {
            throw new Error(`HandlePacket root update expects acknowledgements to only ever insert a single entry; got ${insertedAcks.length} insertions and ${removedAcks.length} deletions`);
        }
        const [sequence, ackBytes] = insertedAcks[0];
        const key = `acks/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
        packetAcknowledgementSiblings = speculativeTree
            .getSiblings(key)
            .map((h) => h.toString("hex"));
        speculativeTree.set(key, encodePacketStoreValue(ackBytes));
    }
    else if (removedAcks.length > 0) {
        throw new Error("HandlePacket root update does not allow acknowledgement deletions");
    }
    const newRoot = speculativeTree.getRoot();
    return {
        newRoot,
        channelSiblings,
        nextSequenceSendSiblings,
        nextSequenceRecvSiblings,
        nextSequenceAckSiblings,
        packetCommitmentSiblings,
        packetReceiptSiblings,
        packetAcknowledgementSiblings,
        commit: () => {
            currentTree = speculativeTree;
        },
    };
}
/** Map a local retired-module key (NUL + port bytes) back to its committed ICS port. */
function committedModulePortIdHex(hostPortIdHex) {
    const retired = hostPortIdHex.startsWith("00");
    const committedPortId = retired ? hostPortIdHex.slice(2) : hostPortIdHex;
    if (!isCanonicalIcsPortHex(committedPortId)) {
        throw new Error(`Invalid HostState module port bytes '${hostPortIdHex}'`);
    }
    return committedPortId;
}
function isCanonicalIcsPortHex(portIdHex) {
    if (!/^(?:[0-9a-f]{2}){2,128}$/.test(portIdHex))
        return false;
    return Buffer.from(portIdHex, "hex").every((byte) => (byte >= 0x30 && byte <= 0x39) ||
        (byte >= 0x41 && byte <= 0x5a) ||
        (byte >= 0x61 && byte <= 0x7a) ||
        [0x5f, 0x2e, 0x2b, 0x2d, 0x23, 0x5b, 0x5d, 0x3c, 0x3e].includes(byte));
}
async function rebuildTreeFromChain(kupoService, lucidService) {
    const hostStateUtxo = await lucidService.findUtxoAtHostStateNFT();
    if (!hostStateUtxo?.datum) {
        throw new Error("HostState UTXO has no datum");
    }
    const hostStateDatum = await lucidService.decodeDatum(hostStateUtxo.datum, "host_state");
    const expectedRoot = hostStateDatum.state.ibc_state_root;
    const tree = new ics23MerkleTree_1.ICS23MerkleTree();
    const boundPorts = hostStateDatum.state.bound_port ?? new Map();
    if (boundPorts.size > 0) {
        const { Data } = lucidService.LucidImporter;
        const AuthTokenSchema = Data.Object({
            policy_id: Data.Bytes(),
            name: Data.Bytes(),
        });
        const ModuleRegistrationSchema = Data.Object({
            module_script_hash: Data.Bytes(),
            port_token: AuthTokenSchema,
            module_token: AuthTokenSchema,
        });
        const committedPortIds = new Set();
        for (const [hostPortIdHex, registration] of boundPorts.entries()) {
            const portIdHex = committedModulePortIdHex(hostPortIdHex);
            if (committedPortIds.has(portIdHex)) {
                throw new Error(`HostState contains duplicate active/retired registration for port ${portIdHex}`);
            }
            committedPortIds.add(portIdHex);
            // Datum keys are hex-encoded UTF-8 and must be decoded before rebuilding textual paths.
            const portId = Buffer.from(portIdHex, "hex").toString("utf8");
            const portValue = Buffer.from(Data.to(registration, ModuleRegistrationSchema), "hex");
            tree.set(`ports/${portId}`, portValue);
        }
    }
    const clientUtxos = await kupoService.queryAllClientUtxos();
    const liveClientIds = new Set();
    for (const clientUtxo of clientUtxos) {
        if (!clientUtxo.datum) {
            continue;
        }
        const clientDatum = await lucidService.decodeDatum(clientUtxo.datum, "client");
        const clientUnit = Object.keys(clientUtxo.assets || {}).find((unit) => unit !== "lovelace");
        if (!clientUnit || clientUnit.length < 56 + 48 + 2) {
            continue;
        }
        const tokenName = clientUnit.slice(56);
        const postfixHex = tokenName.slice(48);
        const clientSequence = BigInt(Buffer.from(postfixHex, "hex").toString("utf8"));
        const clientId = `07-tendermint-${clientSequence.toString()}`;
        liveClientIds.add(clientId);
        const clientStateValue = Buffer.from(await encodeClientStateValue(clientDatum.state.clientState, lucidService.LucidImporter), "hex");
        tree.set(`clients/${clientId}/clientState`, clientStateValue);
        const consensusStates = clientDatum.state.consensusStates;
        const entries = consensusStates instanceof Map
            ? Array.from(consensusStates.entries())
            : Object.entries(consensusStates ?? {});
        for (const [heightKey, consensusState] of entries) {
            const heightStr = typeof heightKey === "object" && heightKey !== null
                ? `${heightKey.revisionHeight || 0}`
                : String(heightKey);
            const consensusValue = Buffer.from(await encodeConsensusStateValue(consensusState, lucidService.LucidImporter), "hex");
            tree.set(`clients/${clientId}/consensusStates/${heightStr}`, consensusValue);
        }
    }
    const connectionUtxos = await kupoService.queryAllConnectionUtxos();
    const liveConnectionCounts = new Map();
    for (const connectionUtxo of connectionUtxos) {
        if (!connectionUtxo.datum) {
            continue;
        }
        const connectionDatum = await lucidService.decodeDatum(connectionUtxo.datum, "connection");
        const connectionUnit = Object.keys(connectionUtxo.assets || {}).find((unit) => unit !== "lovelace");
        if (!connectionUnit || connectionUnit.length <= 56) {
            continue;
        }
        const tokenNameHex = connectionUnit.slice(56);
        if (tokenNameHex.length < 48 + 2) {
            continue;
        }
        const postfixHex = tokenNameHex.slice(48);
        const connectionSequenceStr = Buffer.from(postfixHex, "hex").toString("utf8");
        if (!/^\d+$/.test(connectionSequenceStr)) {
            continue;
        }
        const connectionId = `connection-${connectionSequenceStr}`;
        const connectionValue = Buffer.from(await encodeConnectionEndValue(connectionDatum.state, lucidService.LucidImporter), "hex");
        tree.set(`connections/${connectionId}`, connectionValue);
        const owningClientId = Buffer.from(connectionDatum.state.client_id, "hex").toString("utf8");
        if (!liveClientIds.has(owningClientId)) {
            throw new Error(`Tree rebuild failed: live connection ${connectionId} references missing client ${owningClientId}`);
        }
        liveConnectionCounts.set(owningClientId, (liveConnectionCounts.get(owningClientId) ?? 0n) + 1n);
    }
    const { Data: CountData } = lucidService.LucidImporter;
    for (const clientId of liveClientIds) {
        tree.set(`cardano/dependencies/v1/clients/${clientId}/liveConnections`, Buffer.from(CountData.to((liveConnectionCounts.get(clientId) ?? 0n), CountData.Integer(), { canonical: true }), "hex"));
    }
    const channelUtxos = await kupoService.queryAllChannelUtxos();
    for (const channelUtxo of channelUtxos) {
        if (!channelUtxo.datum) {
            continue;
        }
        const channelDatum = await lucidService.decodeDatum(channelUtxo.datum, "channel");
        const channelUnit = Object.keys(channelUtxo.assets || {}).find((unit) => unit !== "lovelace");
        if (!channelUnit || channelUnit.length <= 56) {
            continue;
        }
        const tokenNameHex = channelUnit.slice(56);
        if (tokenNameHex.length < 48 + 2) {
            continue;
        }
        const postfixHex = tokenNameHex.slice(48);
        const channelSequenceStr = Buffer.from(postfixHex, "hex").toString("utf8");
        if (!/^\d+$/.test(channelSequenceStr)) {
            continue;
        }
        const channelId = `channel-${channelSequenceStr}`;
        const portHex = channelDatum.port;
        const portId = portHex
            ? Buffer.from(portHex, "hex").toString("utf8")
            : "transfer";
        const channelValue = Buffer.from(await encodeChannelEndValue(channelDatum.state.channel, lucidService.LucidImporter), "hex");
        tree.set(`channelEnds/ports/${portId}/channels/${channelId}`, channelValue);
        const { Data } = lucidService.LucidImporter;
        tree.set(`nextSequenceSend/ports/${portId}/channels/${channelId}`, Buffer.from(Data.to(channelDatum.state.next_sequence_send, Data.Integer()), "hex"));
        tree.set(`nextSequenceRecv/ports/${portId}/channels/${channelId}`, Buffer.from(Data.to(channelDatum.state.next_sequence_recv, Data.Integer()), "hex"));
        tree.set(`nextSequenceAck/ports/${portId}/channels/${channelId}`, Buffer.from(Data.to(channelDatum.state.next_sequence_ack, Data.Integer()), "hex"));
        const bytesSchema = Data.Bytes();
        for (const [sequence, bytesHex] of channelDatum.state.packet_commitment.entries()) {
            tree.set(`commitments/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`, Buffer.from(Data.to(bytesHex, bytesSchema), "hex"));
        }
        for (const [sequence, bytesHex] of channelDatum.state.packet_receipt.entries()) {
            tree.set(`receipts/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`, Buffer.from(Data.to(bytesHex, bytesSchema), "hex"));
        }
        for (const [sequence, bytesHex] of channelDatum.state.packet_acknowledgement.entries()) {
            tree.set(`acks/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`, Buffer.from(Data.to(bytesHex, bytesSchema), "hex"));
        }
    }
    const channelHistory = await kupoService.queryLatestChannelUtxosFromHistory();
    const liveChannelOutRefs = new Set(channelUtxos.map((utxo) => `${utxo.txHash}#${utxo.outputIndex}`));
    const historyLiveOutRefs = new Set();
    for (const historicalChannel of channelHistory) {
        const outRef = `${historicalChannel.txHash}#${historicalChannel.outputIndex}`;
        if (historicalChannel.spentAt === null) {
            if (!liveChannelOutRefs.has(outRef)) {
                throw new Error(`Tree rebuild failed: Kupo channel history is not aligned at ${outRef}`);
            }
            historyLiveOutRefs.add(outRef);
            continue;
        }
        if (!historicalChannel.datum) {
            throw new Error(`Tree rebuild failed: historical channel ${outRef} has no datum`);
        }
        const channelDatum = await lucidService.decodeDatum(historicalChannel.datum, "channel");
        const isAbandoned = typeof channelDatum.lifecycle === "object" &&
            channelDatum.lifecycle !== null &&
            "Abandoning" in channelDatum.lifecycle;
        if (isAbandoned) {
            continue;
        }
        if (channelDatum.lifecycle !== "ChannelActive" ||
            channelDatum.state.channel.state !== "Close") {
            throw new Error(`Tree rebuild failed: spent channel ${outRef} is neither reclaimed Closed nor abandoned`);
        }
        const channelUnit = historicalChannel.authToken?.unit ??
            Object.keys(historicalChannel.assets || {}).find((unit) => unit !== "lovelace");
        if (!channelUnit || channelUnit.length < 56 + 48 + 2) {
            throw new Error(`Tree rebuild failed: historical channel ${outRef} has no canonical NFT`);
        }
        const sequenceText = Buffer.from(channelUnit.slice(56 + 48), "hex").toString("utf8");
        if (!/^(?:0|[1-9][0-9]*)$/.test(sequenceText)) {
            throw new Error(`Tree rebuild failed: historical channel ${outRef} has an invalid id`);
        }
        const channelId = `channel-${sequenceText}`;
        const portId = Buffer.from(channelDatum.port, "hex").toString("utf8");
        tree.set(`channelEnds/ports/${portId}/channels/${channelId}`, Buffer.from(await encodeChannelEndValue(channelDatum.state.channel, lucidService.LucidImporter), "hex"));
        const { Data } = lucidService.LucidImporter;
        tree.set(`nextSequenceRecv/ports/${portId}/channels/${channelId}`, Buffer.from(Data.to(channelDatum.state.next_sequence_recv, Data.Integer()), "hex"));
    }
    if (historyLiveOutRefs.size !== liveChannelOutRefs.size) {
        throw new Error("Tree rebuild failed: Kupo channel history is incomplete for live channels");
    }
    const computedRoot = tree.getRoot();
    if (computedRoot !== expectedRoot) {
        throw new Error(`Tree rebuild failed: expected ${expectedRoot} but computed ${computedRoot}`);
    }
    currentTree = tree;
    return { tree, root: computedRoot };
}
