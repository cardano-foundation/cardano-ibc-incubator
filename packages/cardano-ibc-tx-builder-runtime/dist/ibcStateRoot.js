"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IbcTreeStateStore = void 0;
exports.encodeClientStateValue = encodeClientStateValue;
exports.encodeConsensusStateValue = encodeConsensusStateValue;
exports.encodeConnectionEndValue = encodeConnectionEndValue;
exports.encodeChannelEndValue = encodeChannelEndValue;
exports.encodeModuleRegistration = encodeModuleRegistration;
const ics23MerkleTree_1 = require("./ics23MerkleTree");
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
    constructor(deployment, kupoService, lucidService) {
        this.kupoService = kupoService;
        this.lucidService = lucidService;
        this.deployment = Object.freeze({
            network: deployment.network,
            hostStateNFT: Object.freeze({
                policyId: deployment.hostStateNFT.policyId,
                name: deployment.hostStateNFT.name,
            }),
        });
    }
    isTreeAligned(onChainRoot) {
        if (onChainRoot === '0'.repeat(64)) {
            return this.currentTree.getRoot() === onChainRoot;
        }
        return this.currentTree.getRoot() === onChainRoot;
    }
    async alignTreeWithChain() {
        const result = await this.rebuildTreeFromChain();
        return { root: result.root };
    }
    getClonedTreeFromRoot(rootHash) {
        if (rootHash === '0'.repeat(64)) {
            return new ics23MerkleTree_1.ICS23MerkleTree();
        }
        const currentRoot = this.currentTree.getRoot();
        if (currentRoot === rootHash) {
            return this.currentTree.clone();
        }
        throw new Error(`Tree out of sync with on-chain state. Expected root ${rootHash.substring(0, 16)}..., but in-memory root is ${currentRoot.substring(0, 16)}...`);
    }
    async computeRootWithHandlePacketUpdate(oldRoot, portId, channelId, inputChannelDatum, outputChannelDatum, Lucid) {
        const speculativeTree = this.getClonedTreeFromRoot(oldRoot);
        const { Data } = Lucid;
        const encodePacketStoreValue = (bytesHex) => Buffer.from(Data.to(bytesHex, Data.Bytes()), 'hex');
        const channelPath = `channelEnds/ports/${portId}/channels/${channelId}`;
        let channelSiblings = [];
        if (inputChannelDatum.state.channel !== outputChannelDatum.state.channel) {
            const newChannelValue = Buffer.from(await encodeChannelEndValue(outputChannelDatum.state.channel, Lucid), 'hex');
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
                this.currentTree = speculativeTree;
            },
        };
    }
    async rebuildTreeFromChain() {
        const { kupoService, lucidService } = this;
        const hostStateUtxo = await lucidService.findUtxoAtHostStateNFT();
        if (!hostStateUtxo?.datum) {
            throw new Error('HostState UTXO has no datum');
        }
        const hostStateDatum = await lucidService.decodeDatum(hostStateUtxo.datum, 'host_state');
        const expectedRoot = hostStateDatum.state.ibc_state_root;
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
        const clientUtxos = await kupoService.queryAllClientUtxos();
        for (const clientUtxo of clientUtxos) {
            if (!clientUtxo.datum) {
                continue;
            }
            const clientDatum = await lucidService.decodeDatum(clientUtxo.datum, 'client');
            const clientUnit = Object.keys(clientUtxo.assets || {}).find((unit) => unit !== 'lovelace');
            if (!clientUnit || clientUnit.length < 56 + 48 + 2) {
                continue;
            }
            const tokenName = clientUnit.slice(56);
            const postfixHex = tokenName.slice(48);
            const clientSequence = BigInt(Buffer.from(postfixHex, 'hex').toString('utf8'));
            const clientId = `07-tendermint-${clientSequence.toString()}`;
            const clientStateValue = Buffer.from(await encodeClientStateValue(clientDatum.state.clientState, lucidService.LucidImporter), 'hex');
            tree.set(`clients/${clientId}/clientState`, clientStateValue);
            const consensusStates = clientDatum.state.consensusStates;
            const entries = consensusStates instanceof Map
                ? Array.from(consensusStates.entries())
                : Object.entries(consensusStates ?? {});
            for (const [heightKey, consensusState] of entries) {
                const heightStr = typeof heightKey === 'object' && heightKey !== null
                    ? `${heightKey.revisionHeight || 0}`
                    : String(heightKey);
                const consensusValue = Buffer.from(await encodeConsensusStateValue(consensusState, lucidService.LucidImporter), 'hex');
                tree.set(`clients/${clientId}/consensusStates/${heightStr}`, consensusValue);
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
        if (computedRoot !== expectedRoot) {
            throw new Error(`Tree rebuild failed: expected ${expectedRoot} but computed ${computedRoot}`);
        }
        this.currentTree = tree;
        return { tree, root: computedRoot };
    }
    computeRootWithCreateClientUpdate(oldRoot, clientId, clientStateValue, consensusStateValue, consensusHeight) {
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
        const newRoot = speculativeTree.getRoot();
        return {
            newRoot,
            clientStateSiblings,
            consensusStateSiblings,
            commit: () => {
                this.currentTree = speculativeTree;
            },
        };
    }
    computeRootWithUpdateClientUpdate(oldRoot, clientId, newClientStateValue, removedConsensusHeights, addedConsensusState) {
        const speculativeTree = this.getClonedTreeFromRoot(oldRoot);
        // 1) Client state update.
        const clientPath = `clients/${clientId}/clientState`;
        if (!speculativeTree.get(clientPath)) {
            throw new Error(`UpdateClient root update expects existing clientState at '${clientPath}', but it was not found in the tree`);
        }
        const clientStateSiblings = speculativeTree.getSiblings(clientPath).map((h) => h.toString('hex'));
        speculativeTree.set(clientPath, newClientStateValue);
        // 2) Consensus state deletions (in the order provided by the caller).
        const removedConsensusStateSiblings = [];
        for (const height of removedConsensusHeights) {
            const heightStr = String(height);
            const consensusPath = `clients/${clientId}/consensusStates/${heightStr}`;
            if (!speculativeTree.get(consensusPath)) {
                throw new Error(`UpdateClient root update expects existing consensusState at '${consensusPath}', but it was not found in the tree`);
            }
            const siblings = speculativeTree.getSiblings(consensusPath).map((h) => h.toString('hex'));
            removedConsensusStateSiblings.push(siblings);
            // Deletion is modeled as "set to empty", which collapses back to the empty hash on-chain.
            speculativeTree.set(consensusPath, Buffer.alloc(0));
        }
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
        const newRoot = speculativeTree.getRoot();
        return {
            newRoot,
            clientStateSiblings,
            consensusStateSiblings,
            removedConsensusStateSiblings,
            commit: () => {
                this.currentTree = speculativeTree;
            },
        };
    }
    computeRootWithCreateConnectionUpdate(oldRoot, connectionId, connectionValue) {
        const speculativeTree = this.getClonedTreeFromRoot(oldRoot);
        const path = `connections/${connectionId}`;
        const connectionSiblings = speculativeTree.getSiblings(path).map((h) => h.toString('hex'));
        speculativeTree.set(path, connectionValue);
        const newRoot = speculativeTree.getRoot();
        return {
            newRoot,
            connectionSiblings,
            commit: () => {
                this.currentTree = speculativeTree;
            },
        };
    }
    computeRootWithCreateChannelUpdate(oldRoot, portId, channelId, channelValue, nextSequenceSendValue, nextSequenceRecvValue, nextSequenceAckValue) {
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
        const newRoot = speculativeTree.getRoot();
        return {
            newRoot,
            channelSiblings,
            nextSequenceSendSiblings,
            nextSequenceRecvSiblings,
            nextSequenceAckSiblings,
            commit: () => {
                this.currentTree = speculativeTree;
            },
        };
    }
    computeRootWithUpdateChannelUpdate(oldRoot, portId, channelId, channelValue) {
        const speculativeTree = this.getClonedTreeFromRoot(oldRoot);
        const channelPath = `channelEnds/ports/${portId}/channels/${channelId}`;
        const channelSiblings = speculativeTree.getSiblings(channelPath).map((h) => h.toString('hex'));
        speculativeTree.set(channelPath, channelValue);
        const newRoot = speculativeTree.getRoot();
        return {
            newRoot,
            channelSiblings,
            commit: () => {
                this.currentTree = speculativeTree;
            },
        };
    }
    computeRootWithPrunePacketHistoryUpdate(oldRoot, portId, channelId, sequence, ordering) {
        if (ordering !== 'Unordered' && ordering !== 'Ordered') {
            throw new Error(`PrunePacketHistory does not support channel ordering '${ordering}'`);
        }
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
        const newRoot = speculativeTree.getRoot();
        return {
            newRoot,
            packetReceiptSiblings,
            packetAcknowledgementSiblings,
            commit: () => {
                this.currentTree = speculativeTree;
            },
        };
    }
    computeRootWithPortBind(oldRoot, portId, portValue) {
        const speculativeTree = this.getClonedTreeFromRoot(oldRoot);
        // Exact case-sensitive port text becomes the commitment path without aliases or normalization.
        const path = `ports/${portId}`;
        // The on-chain validator replays this update using the per-level sibling hashes.
        const portSiblings = speculativeTree.getSiblings(path).map((h) => h.toString('hex'));
        speculativeTree.set(path, portValue);
        const newRoot = speculativeTree.getRoot();
        return {
            newRoot,
            portSiblings,
            commit: () => {
                this.currentTree = speculativeTree;
            },
        };
    }
    getCurrentTree() {
        return this.currentTree;
    }
    setCurrentTree(tree) {
        this.currentTree = tree;
    }
    getCurrentRoot() {
        return this.currentTree.getRoot();
    }
    resetTreeState() {
        this.currentTree = new ics23MerkleTree_1.ICS23MerkleTree();
    }
}
exports.IbcTreeStateStore = IbcTreeStateStore;
