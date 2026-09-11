"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IbcTreeStateStore = exports.StaleIbcTreeStateError = void 0;
exports.encodeClientStateValue = encodeClientStateValue;
exports.encodeConsensusStateValue = encodeConsensusStateValue;
exports.encodeConnectionEndValue = encodeConnectionEndValue;
exports.encodeChannelEndValue = encodeChannelEndValue;
exports.encodeModuleRegistration = encodeModuleRegistration;
const ics23MerkleTree_1 = require("./ics23MerkleTree");
const plutusSerialise_1 = require("./plutusSerialise");
class StaleIbcTreeStateError extends Error {
    constructor(message = 'IBC tree state changed while the operation was in progress') {
        super(message);
        this.name = 'StaleIbcTreeStateError';
    }
}
exports.StaleIbcTreeStateError = StaleIbcTreeStateError;
function normalizeHex(value) {
    return value.toLowerCase();
}
function utxoLabel(utxo) {
    return `${utxo.txHash}#${utxo.outputIndex}`;
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
    // Match Aiken cbor.serialise, including indefinite-length arrays.
    // Canonical CBOR would change the committed value bytes.
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
        Data.Literal('Uninitialized'),
        Data.Literal('Init'),
        Data.Literal('TryOpen'),
        Data.Literal('Open'),
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
        Data.Literal('Uninitialized'),
        Data.Literal('Init'),
        Data.Literal('TryOpen'),
        Data.Literal('Open'),
        Data.Literal('Close'),
    ]);
    const OrderSchema = Data.Enum([
        Data.Literal('None'),
        Data.Literal('Unordered'),
        Data.Literal('Ordered'),
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
async function encodeModuleRegistration(registration, Lucid) {
    const { Data } = Lucid;
    const AuthTokenSchema = Data.Object({
        policy_id: Data.Bytes(),
        name: Data.Bytes(),
    });
    const ModuleRegistrationSchema = Data.Object({
        module_script_hash: Data.Bytes(),
        port_token: AuthTokenSchema,
        module_token: AuthTokenSchema,
    });
    return Data.to(registration, ModuleRegistrationSchema);
}
/**
 * One deployment's working tree and the readers used to rebuild it.
 * Computations use clones and only replace this store's tree when committed.
 */
class IbcTreeStateStore {
    kupoService;
    lucidService;
    deployment;
    currentTree = new ics23MerkleTree_1.ICS23MerkleTree();
    version = 0;
    hostState = null;
    constructor(deployment, kupoService, lucidService) {
        this.kupoService = kupoService;
        this.lucidService = lucidService;
        this.deployment = Object.freeze({
            network: deployment.network,
            hostStateNFT: Object.freeze({
                policyId: deployment.hostStateNFT.policyId,
                name: deployment.hostStateNFT.name,
            }),
            ...(deployment.clientPolicyId ? { clientPolicyId: deployment.clientPolicyId } : {}),
        });
    }
    isTreeAligned(onChainRoot, hostState) {
        return this.hostState !== null && this.currentTree.getRoot() === onChainRoot &&
            (hostState === undefined || this.sameHostState(this.hostState, hostState));
    }
    async alignTreeWithChain() {
        const result = await this.rebuildTreeFromChain();
        return { root: result.root };
    }
    getClonedTreeFromRoot(rootHash) {
        const currentRoot = this.currentTree.getRoot();
        if (currentRoot === rootHash) {
            return this.currentTree.clone();
        }
        throw new StaleIbcTreeStateError(`Tree out of sync with on-chain state. Expected root ${rootHash.substring(0, 16)}..., but in-memory root is ${currentRoot.substring(0, 16)}...`);
    }
    sameHostState(left, right) {
        return left.txHash === right.txHash && left.outputIndex === right.outputIndex;
    }
    copyHostState(hostState) {
        if (!/^[0-9a-f]{64}$/.test(hostState.txHash) ||
            !Number.isSafeInteger(hostState.outputIndex) || hostState.outputIndex < 0) {
            throw new Error('HostState reference must contain a canonical transaction hash and output index');
        }
        return Object.freeze({ txHash: hostState.txHash, outputIndex: hostState.outputIndex });
    }
    snapshot(tree, hostState) {
        return Object.freeze({ root: tree.getRoot(), hostState: this.copyHostState(hostState), tree: tree.clone() });
    }
    async readLiveHostState() {
        const utxo = await this.lucidService.findUtxoAtHostStateNFT();
        if (!utxo?.datum)
            throw new Error('HostState UTXO has no datum');
        const hostState = this.copyHostState(utxo);
        const datum = await this.lucidService.decodeDatum(utxo.datum, 'host_state');
        const root = datum.state.ibc_state_root;
        if (!/^[0-9a-f]{64}$/.test(root))
            throw new Error('HostState root must be 32 lowercase hexadecimal bytes');
        return { root, hostState, datum };
    }
    assertUnchanged(version, initial, live) {
        if (this.version !== version || initial.root !== live.root || !this.sameHostState(initial.hostState, live.hostState)) {
            throw new StaleIbcTreeStateError();
        }
    }
    publish(tree, hostState) {
        this.currentTree = tree.clone();
        this.hostState = this.copyHostState(hostState);
        this.version += 1;
    }
    preparePublication(tree, version) {
        // Detach from caller-owned input buffers before returning a commit callback.
        const preparedTree = tree.clone();
        const newRoot = preparedTree.getRoot();
        return {
            newRoot,
            commit: async (hostState) => {
                const snapshot = this.snapshot(preparedTree, hostState);
                if (this.version !== version)
                    return { published: false, snapshot };
                const live = await this.readLiveHostState();
                if (this.version !== version || live.root !== newRoot || !this.sameHostState(live.hostState, snapshot.hostState)) {
                    return { published: false, snapshot };
                }
                // No await between the generation/live-state checks and publication.
                this.publish(preparedTree, snapshot.hostState);
                return { published: true, snapshot };
            },
        };
    }
    getSnapshot() {
        if (!this.hostState)
            throw new Error('IBC tree store has no bound HostState snapshot');
        return Object.freeze({ ...this.snapshot(this.currentTree, this.hostState), version: this.version });
    }
    async getAlignedSnapshot() {
        const version = this.version;
        const live = await this.readLiveHostState();
        if (this.version !== version)
            throw new StaleIbcTreeStateError();
        if (this.isTreeAligned(live.root, live.hostState))
            return this.getSnapshot();
        return this.rebuildTreeFromChain();
    }
    async restoreTreeFromCache(tree) {
        const version = this.version;
        const candidate = tree.clone();
        const initial = await this.readLiveHostState();
        const live = await this.readLiveHostState();
        this.assertUnchanged(version, initial, live);
        if (candidate.getRoot() !== live.root)
            throw new Error('Cached tree root does not match the live HostState');
        this.publish(candidate, live.hostState);
        return this.getSnapshot();
    }
    computeRootWithHeartbeatUpdate(oldRoot) {
        const version = this.version;
        return this.preparePublication(this.getClonedTreeFromRoot(oldRoot), version);
    }
    async computeRootWithHandlePacketUpdate(oldRoot, portId, channelId, inputChannelDatum, outputChannelDatum, Lucid) {
        const version = this.version;
        const speculativeTree = this.getClonedTreeFromRoot(oldRoot);
        const { Data } = Lucid;
        const encodePacketStoreValue = (bytesHex) => Buffer.from(Data.to(bytesHex, Data.Bytes()), 'hex');
        const channelPath = `channelEnds/ports/${portId}/channels/${channelId}`;
        let channelSiblings = [];
        const inputChannelValue = await encodeChannelEndValue(inputChannelDatum.state.channel, Lucid);
        const outputChannelValue = await encodeChannelEndValue(outputChannelDatum.state.channel, Lucid);
        if (inputChannelValue !== outputChannelValue) {
            const newChannelValue = Buffer.from(outputChannelValue, 'hex');
            channelSiblings = speculativeTree.getSiblings(channelPath).map((h) => h.toString('hex'));
            speculativeTree.set(channelPath, newChannelValue);
        }
        const nextSequenceSendPath = `nextSequenceSend/ports/${portId}/channels/${channelId}`;
        let nextSequenceSendSiblings = [];
        if (inputChannelDatum.state.next_sequence_send !== outputChannelDatum.state.next_sequence_send) {
            const newValue = Buffer.from(Data.to(outputChannelDatum.state.next_sequence_send, Data.Integer()), 'hex');
            nextSequenceSendSiblings = speculativeTree.getSiblings(nextSequenceSendPath).map((h) => h.toString('hex'));
            speculativeTree.set(nextSequenceSendPath, newValue);
        }
        const nextSequenceRecvPath = `nextSequenceRecv/ports/${portId}/channels/${channelId}`;
        let nextSequenceRecvSiblings = [];
        if (inputChannelDatum.state.next_sequence_recv !== outputChannelDatum.state.next_sequence_recv) {
            const newValue = Buffer.from(Data.to(outputChannelDatum.state.next_sequence_recv, Data.Integer()), 'hex');
            nextSequenceRecvSiblings = speculativeTree.getSiblings(nextSequenceRecvPath).map((h) => h.toString('hex'));
            speculativeTree.set(nextSequenceRecvPath, newValue);
        }
        const nextSequenceAckPath = `nextSequenceAck/ports/${portId}/channels/${channelId}`;
        let nextSequenceAckSiblings = [];
        if (inputChannelDatum.state.next_sequence_ack !== outputChannelDatum.state.next_sequence_ack) {
            const newValue = Buffer.from(Data.to(outputChannelDatum.state.next_sequence_ack, Data.Integer()), 'hex');
            nextSequenceAckSiblings = speculativeTree.getSiblings(nextSequenceAckPath).map((h) => h.toString('hex'));
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
            packetCommitmentSiblings = speculativeTree.getSiblings(key).map((h) => h.toString('hex'));
            speculativeTree.set(key, encodePacketStoreValue(commitmentBytes));
        }
        else if (removedCommitments.length > 0) {
            if (removedCommitments.length !== 1) {
                throw new Error(`HandlePacket root update expects exactly one commitment deletion; got ${removedCommitments.length}`);
            }
            const [sequence] = removedCommitments[0];
            const key = `commitments/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
            packetCommitmentSiblings = speculativeTree.getSiblings(key).map((h) => h.toString('hex'));
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
            packetReceiptSiblings = speculativeTree.getSiblings(key).map((h) => h.toString('hex'));
            speculativeTree.set(key, encodePacketStoreValue(receiptBytes));
        }
        else if (removedReceipts.length > 0) {
            throw new Error('HandlePacket root update does not allow receipt deletions');
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
            packetAcknowledgementSiblings = speculativeTree.getSiblings(key).map((h) => h.toString('hex'));
            speculativeTree.set(key, encodePacketStoreValue(ackBytes));
        }
        else if (removedAcks.length > 0) {
            throw new Error('HandlePacket root update does not allow acknowledgement deletions');
        }
        return {
            ...this.preparePublication(speculativeTree, version),
            channelSiblings,
            nextSequenceSendSiblings,
            nextSequenceRecvSiblings,
            nextSequenceAckSiblings,
            packetCommitmentSiblings,
            packetReceiptSiblings,
            packetAcknowledgementSiblings,
        };
    }
    async rebuildTreeFromChain() {
        const version = this.version;
        const { kupoService, lucidService } = this;
        const initial = await this.readLiveHostState();
        const hostStateDatum = initial.datum;
        const expectedRoot = initial.root;
        const tree = new ics23MerkleTree_1.ICS23MerkleTree();
        const boundPorts = hostStateDatum.control.port_registry ?? new Map();
        if (boundPorts.size > 0) {
            for (const [portIdHex, registration] of boundPorts.entries()) {
                // Datum keys are hex-encoded UTF-8 and must be decoded before rebuilding textual paths.
                const portId = Buffer.from(portIdHex, 'hex').toString('utf8');
                const portValue = Buffer.from(await encodeModuleRegistration(registration, lucidService.LucidImporter), 'hex');
                tree.set(`ports/${portId}`, portValue);
            }
        }
        const clientIdsByTokenUnit = new Map();
        const consensusPaths = new Set();
        const clientUtxos = await kupoService.queryAllClientUtxos();
        for (const clientUtxo of clientUtxos) {
            if (!clientUtxo.datum) {
                continue;
            }
            const clientDatum = await lucidService.decodeDatum(clientUtxo.datum, 'client');
            const clientUnit = Object.keys(clientUtxo.assets || {}).find((unit) => unit !== 'lovelace' &&
                (!this.deployment.clientPolicyId ||
                    normalizeHex(unit).startsWith(normalizeHex(this.deployment.clientPolicyId))));
            if (!clientUnit || clientUnit.length < 56 + 48 + 2) {
                continue;
            }
            if (this.deployment.clientPolicyId) {
                const expectedPolicy = normalizeHex(this.deployment.clientPolicyId);
                const clientPolicyUnits = Object.keys(clientUtxo.assets || {}).filter((unit) => unit !== 'lovelace' && normalizeHex(unit).startsWith(expectedPolicy));
                const datumUnit = clientDatum.token
                    ? normalizeHex(clientDatum.token.policyId + clientDatum.token.name)
                    : undefined;
                if (clientPolicyUnits.length !== 1 ||
                    clientUtxo.assets[clientUnit] !== 1n ||
                    !datumUnit ||
                    datumUnit !== normalizeHex(clientUnit)) {
                    throw new Error(`Client UTxO ${utxoLabel(clientUtxo)} failed authentication during tree rebuild`);
                }
            }
            const tokenName = clientUnit.slice(56);
            const postfixHex = tokenName.slice(48);
            const clientSequenceText = Buffer.from(postfixHex, 'hex').toString('utf8');
            if (!/^\d+$/.test(clientSequenceText)) {
                if (this.deployment.clientPolicyId) {
                    throw new Error(`Client UTxO ${utxoLabel(clientUtxo)} has an invalid sequence token`);
                }
                continue;
            }
            const clientSequence = BigInt(clientSequenceText);
            const clientId = `07-tendermint-${clientSequence.toString()}`;
            const normalizedClientUnit = normalizeHex(clientUnit);
            if (clientIdsByTokenUnit.has(normalizedClientUnit)) {
                throw new Error(`Duplicate client authentication token ${clientUnit} during tree rebuild`);
            }
            clientIdsByTokenUnit.set(normalizedClientUnit, clientId);
            const clientStateValue = Buffer.from(this.deployment.clientPolicyId
                ? (0, plutusSerialise_1.publicClientCommitmentValues)(clientUtxo.datum, 'production').clientValue
                : await encodeClientStateValue(clientDatum.state.clientState, lucidService.LucidImporter), 'hex');
            tree.set(`clients/${clientId}/clientState`, clientStateValue);
            if (this.deployment.clientPolicyId) {
                if (!/^[0-9a-f]{64}$/.test(clientDatum.history_root ?? '') || !lucidService.consensusHistoryRecords) {
                    throw new Error('Proof-backed consensus history requires a valid client root and historical chain reader');
                }
                const records = await lucidService.consensusHistoryRecords(clientUtxo);
                if (records.length === 0)
                    throw new Error(`No consensus records recovered for '${clientId}'`);
                for (const { datum: record, consensusValue } of records) {
                    if (normalizeHex(record.clientToken.policyId + record.clientToken.name) !== normalizedClientUnit ||
                        record.height.revisionNumber < 0n || record.height.revisionHeight <= 0n ||
                        !/^(?:[0-9a-f]{2})+$/.test(consensusValue)) {
                        throw new Error(`Invalid recovered consensus record for '${clientId}'`);
                    }
                    const path = `clients/${clientId}/consensusStates/${record.height.revisionHeight}`;
                    if (consensusPaths.has(path))
                        throw new Error(`Duplicate consensus state path '${path}' during tree rebuild`);
                    tree.set(path, Buffer.from(consensusValue, 'hex'));
                    consensusPaths.add(path);
                }
                continue;
            }
            const consensusStates = clientDatum.state.consensusStates;
            const entries = consensusStates instanceof Map
                ? Array.from(consensusStates.entries())
                : Object.entries(consensusStates ?? {});
            for (const [heightKey, consensusState] of entries) {
                const heightStr = typeof heightKey === 'object' && heightKey !== null
                    ? `${heightKey.revisionHeight || 0}`
                    : String(heightKey);
                const consensusPath = `clients/${clientId}/consensusStates/${heightStr}`;
                if (consensusPaths.has(consensusPath)) {
                    throw new Error(`Duplicate consensus state path '${consensusPath}' during tree rebuild`);
                }
                const consensusValue = Buffer.from(await encodeConsensusStateValue(consensusState, lucidService.LucidImporter), 'hex');
                tree.set(consensusPath, consensusValue);
                consensusPaths.add(consensusPath);
            }
        }
        const connectionUtxos = await kupoService.queryAllConnectionUtxos();
        for (const connectionUtxo of connectionUtxos) {
            if (!connectionUtxo.datum) {
                continue;
            }
            const connectionDatum = await lucidService.decodeDatum(connectionUtxo.datum, 'connection');
            const connectionUnit = Object.keys(connectionUtxo.assets || {}).find((unit) => unit !== 'lovelace');
            if (!connectionUnit || connectionUnit.length <= 56) {
                continue;
            }
            const tokenNameHex = connectionUnit.slice(56);
            if (tokenNameHex.length < 48 + 2) {
                continue;
            }
            const postfixHex = tokenNameHex.slice(48);
            const connectionSequenceStr = Buffer.from(postfixHex, 'hex').toString('utf8');
            if (!/^\d+$/.test(connectionSequenceStr)) {
                continue;
            }
            const connectionId = `connection-${connectionSequenceStr}`;
            const connectionValue = Buffer.from(await encodeConnectionEndValue(connectionDatum.state, lucidService.LucidImporter), 'hex');
            tree.set(`connections/${connectionId}`, connectionValue);
        }
        const channelUtxos = await kupoService.queryAllChannelUtxos();
        for (const channelUtxo of channelUtxos) {
            if (!channelUtxo.datum) {
                continue;
            }
            const channelDatum = await lucidService.decodeDatum(channelUtxo.datum, 'channel');
            const channelUnit = Object.keys(channelUtxo.assets || {}).find((unit) => unit !== 'lovelace');
            if (!channelUnit || channelUnit.length <= 56) {
                continue;
            }
            const tokenNameHex = channelUnit.slice(56);
            if (tokenNameHex.length < 48 + 2) {
                continue;
            }
            const postfixHex = tokenNameHex.slice(48);
            const channelSequenceStr = Buffer.from(postfixHex, 'hex').toString('utf8');
            if (!/^\d+$/.test(channelSequenceStr)) {
                continue;
            }
            const channelId = `channel-${channelSequenceStr}`;
            const portHex = channelDatum.port;
            const portId = portHex ? Buffer.from(portHex, 'hex').toString('utf8') : 'transfer';
            const channelValue = Buffer.from(await encodeChannelEndValue(channelDatum.state.channel, lucidService.LucidImporter), 'hex');
            tree.set(`channelEnds/ports/${portId}/channels/${channelId}`, channelValue);
            const { Data } = lucidService.LucidImporter;
            tree.set(`nextSequenceSend/ports/${portId}/channels/${channelId}`, Buffer.from(Data.to(channelDatum.state.next_sequence_send, Data.Integer()), 'hex'));
            tree.set(`nextSequenceRecv/ports/${portId}/channels/${channelId}`, Buffer.from(Data.to(channelDatum.state.next_sequence_recv, Data.Integer()), 'hex'));
            tree.set(`nextSequenceAck/ports/${portId}/channels/${channelId}`, Buffer.from(Data.to(channelDatum.state.next_sequence_ack, Data.Integer()), 'hex'));
            const bytesSchema = Data.Bytes();
            for (const [sequence, bytesHex] of channelDatum.state.packet_commitment.entries()) {
                tree.set(`commitments/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`, Buffer.from(Data.to(bytesHex, bytesSchema), 'hex'));
            }
            for (const [sequence, bytesHex] of channelDatum.state.packet_receipt.entries()) {
                tree.set(`receipts/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`, Buffer.from(Data.to(bytesHex, bytesSchema), 'hex'));
            }
            for (const [sequence, bytesHex] of channelDatum.state.packet_acknowledgement.entries()) {
                tree.set(`acks/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`, Buffer.from(Data.to(bytesHex, bytesSchema), 'hex'));
            }
        }
        const computedRoot = tree.getRoot();
        const live = await this.readLiveHostState();
        this.assertUnchanged(version, initial, live);
        if (computedRoot !== expectedRoot) {
            throw new Error(`Tree rebuild failed: expected ${expectedRoot} but computed ${computedRoot}`);
        }
        this.publish(tree, live.hostState);
        return this.getSnapshot();
    }
    computeRootWithCreateClientUpdate(oldRoot, clientId, clientStateValue, consensusStateValue, consensusHeight) {
        const version = this.version;
        const speculativeTree = this.getClonedTreeFromRoot(oldRoot);
        const clientPath = `clients/${clientId}/clientState`;
        const clientStateSiblings = speculativeTree.getSiblings(clientPath).map((h) => h.toString('hex'));
        speculativeTree.set(clientPath, clientStateValue);
        const heightStr = String(consensusHeight);
        const consensusPath = `clients/${clientId}/consensusStates/${heightStr}`;
        const consensusStateSiblings = speculativeTree
            .getSiblings(consensusPath)
            .map((h) => h.toString('hex'));
        speculativeTree.set(consensusPath, consensusStateValue);
        return {
            ...this.preparePublication(speculativeTree, version),
            clientStateSiblings,
            consensusStateSiblings,
        };
    }
    computeRootWithUpdateClientUpdate(oldRoot, clientId, newClientStateValue, removedConsensusHeights, addedConsensusState) {
        if (removedConsensusHeights.length !== 0) {
            throw new Error('UpdateClient cannot remove consensus history');
        }
        const version = this.version;
        const speculativeTree = this.getClonedTreeFromRoot(oldRoot);
        // 1) Client state update.
        const clientPath = `clients/${clientId}/clientState`;
        if (!speculativeTree.get(clientPath)) {
            throw new Error(`UpdateClient root update expects existing clientState at '${clientPath}', but it was not found in the tree`);
        }
        const clientStateSiblings = speculativeTree.getSiblings(clientPath).map((h) => h.toString('hex'));
        speculativeTree.set(clientPath, newClientStateValue);
        // Archiving a tip changes its UTxO location, not its commitment leaf.
        const removedConsensusStateSiblings = [];
        // 3) Optional consensus state insertion (exactly one for normal UpdateClient, none for misbehaviour).
        let consensusStateSiblings = [];
        if (addedConsensusState) {
            const heightStr = String(addedConsensusState.height);
            const consensusPath = `clients/${clientId}/consensusStates/${heightStr}`;
            // For an insertion, the old value must be absent at this point in the update sequence.
            if (speculativeTree.get(consensusPath)) {
                throw new Error(`UpdateClient root update expects no consensusState at '${consensusPath}' before insertion, but one already exists`);
            }
            consensusStateSiblings = speculativeTree.getSiblings(consensusPath).map((h) => h.toString('hex'));
            speculativeTree.set(consensusPath, addedConsensusState.value);
        }
        return {
            ...this.preparePublication(speculativeTree, version),
            clientStateSiblings,
            consensusStateSiblings,
            removedConsensusStateSiblings,
        };
    }
    computeRootWithCreateConnectionUpdate(oldRoot, connectionId, connectionValue) {
        const version = this.version;
        const speculativeTree = this.getClonedTreeFromRoot(oldRoot);
        const path = `connections/${connectionId}`;
        const connectionSiblings = speculativeTree.getSiblings(path).map((h) => h.toString('hex'));
        speculativeTree.set(path, connectionValue);
        return {
            ...this.preparePublication(speculativeTree, version),
            connectionSiblings,
        };
    }
    computeRootWithCreateChannelUpdate(oldRoot, portId, channelId, channelValue, nextSequenceSendValue, nextSequenceRecvValue, nextSequenceAckValue) {
        const version = this.version;
        const speculativeTree = this.getClonedTreeFromRoot(oldRoot);
        const channelPath = `channelEnds/ports/${portId}/channels/${channelId}`;
        const channelSiblings = speculativeTree.getSiblings(channelPath).map((h) => h.toString('hex'));
        speculativeTree.set(channelPath, channelValue);
        const nextSequenceSendPath = `nextSequenceSend/ports/${portId}/channels/${channelId}`;
        const nextSequenceSendSiblings = speculativeTree
            .getSiblings(nextSequenceSendPath)
            .map((h) => h.toString('hex'));
        speculativeTree.set(nextSequenceSendPath, nextSequenceSendValue);
        const nextSequenceRecvPath = `nextSequenceRecv/ports/${portId}/channels/${channelId}`;
        const nextSequenceRecvSiblings = speculativeTree
            .getSiblings(nextSequenceRecvPath)
            .map((h) => h.toString('hex'));
        speculativeTree.set(nextSequenceRecvPath, nextSequenceRecvValue);
        const nextSequenceAckPath = `nextSequenceAck/ports/${portId}/channels/${channelId}`;
        const nextSequenceAckSiblings = speculativeTree.getSiblings(nextSequenceAckPath).map((h) => h.toString('hex'));
        speculativeTree.set(nextSequenceAckPath, nextSequenceAckValue);
        return {
            ...this.preparePublication(speculativeTree, version),
            channelSiblings,
            nextSequenceSendSiblings,
            nextSequenceRecvSiblings,
            nextSequenceAckSiblings,
        };
    }
    computeRootWithUpdateChannelUpdate(oldRoot, portId, channelId, channelValue) {
        const version = this.version;
        const speculativeTree = this.getClonedTreeFromRoot(oldRoot);
        const channelPath = `channelEnds/ports/${portId}/channels/${channelId}`;
        const channelSiblings = speculativeTree.getSiblings(channelPath).map((h) => h.toString('hex'));
        speculativeTree.set(channelPath, channelValue);
        return {
            ...this.preparePublication(speculativeTree, version),
            channelSiblings,
        };
    }
    computeRootWithPrunePacketHistoryUpdate(oldRoot, portId, channelId, sequence, ordering) {
        if (ordering !== 'Unordered' && ordering !== 'Ordered') {
            throw new Error(`PrunePacketHistory does not support channel ordering '${ordering}'`);
        }
        const version = this.version;
        const speculativeTree = this.getClonedTreeFromRoot(oldRoot);
        const sequenceText = sequence.toString();
        const receiptPath = `receipts/ports/${portId}/channels/${channelId}/sequences/${sequenceText}`;
        const acknowledgementPath = `acks/ports/${portId}/channels/${channelId}/sequences/${sequenceText}`;
        if (ordering === 'Unordered' && !speculativeTree.get(receiptPath)) {
            throw new Error(`PrunePacketHistory expects an existing receipt at '${receiptPath}'`);
        }
        if (!speculativeTree.get(acknowledgementPath)) {
            throw new Error(`PrunePacketHistory expects an existing acknowledgement at '${acknowledgementPath}'`);
        }
        let packetReceiptSiblings = [];
        if (ordering === 'Unordered') {
            packetReceiptSiblings = speculativeTree.getSiblings(receiptPath).map((hash) => hash.toString('hex'));
            speculativeTree.set(receiptPath, Buffer.alloc(0));
        }
        const packetAcknowledgementSiblings = speculativeTree
            .getSiblings(acknowledgementPath)
            .map((hash) => hash.toString('hex'));
        speculativeTree.set(acknowledgementPath, Buffer.alloc(0));
        return {
            ...this.preparePublication(speculativeTree, version),
            packetReceiptSiblings,
            packetAcknowledgementSiblings,
        };
    }
    computeRootWithPortBind(oldRoot, portId, portValue) {
        const version = this.version;
        const speculativeTree = this.getClonedTreeFromRoot(oldRoot);
        // Exact case-sensitive port text becomes the commitment path without aliases or normalization.
        const path = `ports/${portId}`;
        // The on-chain validator replays this update using the per-level sibling hashes.
        const portSiblings = speculativeTree.getSiblings(path).map((h) => h.toString('hex'));
        speculativeTree.set(path, portValue);
        return {
            ...this.preparePublication(speculativeTree, version),
            portSiblings,
        };
    }
    getCurrentTree() {
        return this.currentTree.clone();
    }
    getCurrentRoot() {
        return this.currentTree.getRoot();
    }
    resetTreeState() {
        this.currentTree = new ics23MerkleTree_1.ICS23MerkleTree();
        this.hostState = null;
        this.version += 1;
    }
}
exports.IbcTreeStateStore = IbcTreeStateStore;
