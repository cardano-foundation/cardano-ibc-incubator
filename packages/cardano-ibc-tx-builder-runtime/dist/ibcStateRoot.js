"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFetchIbcTreeRecoveryStore = createFetchIbcTreeRecoveryStore;
exports.initTreeServices = initTreeServices;
exports.isTreeAligned = isTreeAligned;
exports.alignTreeWithChain = alignTreeWithChain;
exports.computeRootWithHandlePacketUpdate = computeRootWithHandlePacketUpdate;
exports.createTreeCheckpoint = createTreeCheckpoint;
exports.recoverTreeFromCheckpointAndJournal = recoverTreeFromCheckpointAndJournal;
exports.installVerifiedTreeRecovery = installVerifiedTreeRecovery;
exports.resetTreeState = resetTreeState;
exports.rebuildTreeFromChain = rebuildTreeFromChain;
const ics23MerkleTree_1 = require("./ics23MerkleTree");
function createFetchIbcTreeRecoveryStore(endpoint, fetchImpl = fetch) {
    const normalizedEndpoint = endpoint.trim();
    if (!normalizedEndpoint) {
        throw new Error('IBC tree recovery endpoint must not be empty');
    }
    return {
        async load(expectedRoot) {
            assertRoot(expectedRoot, 'expected HostState root');
            const url = new URL(normalizedEndpoint);
            url.searchParams.set('root', expectedRoot.toLowerCase());
            const response = await fetchImpl(url, {
                headers: { accept: 'application/json' },
                cache: 'no-store',
            });
            if (response.status === 404) {
                return null;
            }
            if (!response.ok) {
                throw new Error(`IBC tree recovery request failed: ${response.status} ${response.statusText}`);
            }
            return response.json();
        },
    };
}
let currentTree = new ics23MerkleTree_1.ICS23MerkleTree();
let cachedKupoService = null;
let cachedLucidService = null;
let cachedRecoveryStore = null;
function initTreeServices(kupoService, lucidService, recoveryStore) {
    cachedKupoService = kupoService;
    cachedLucidService = lucidService;
    cachedRecoveryStore = recoveryStore ?? null;
}
function isTreeAligned(onChainRoot) {
    if (onChainRoot === '0'.repeat(64)) {
        return currentTree.getRoot() === onChainRoot;
    }
    return currentTree.getRoot() === onChainRoot;
}
async function alignTreeWithChain() {
    if (!cachedKupoService || !cachedLucidService) {
        throw new Error('Tree services not initialized. Call initTreeServices() first.');
    }
    const result = await rebuildTreeFromChain(cachedKupoService, cachedLucidService, cachedRecoveryStore ?? undefined);
    return { root: result.root };
}
function getClonedTreeFromRoot(rootHash) {
    if (rootHash === '0'.repeat(64)) {
        return new ics23MerkleTree_1.ICS23MerkleTree();
    }
    const currentRoot = currentTree.getRoot();
    if (currentRoot === rootHash) {
        return currentTree.clone();
    }
    throw new Error(`Tree out of sync with on-chain state. Expected root ${rootHash.substring(0, 16)}..., but in-memory root is ${currentRoot.substring(0, 16)}...`);
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
        Data.Literal('Closed'),
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
function assertHexBytes(value, label) {
    if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) {
        throw new Error(`${label} must be even-length hexadecimal bytes`);
    }
}
function canonicalJson(value) {
    return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? { $bigint: item.toString() } : item);
}
function assertUnchanged(input, output, label) {
    if (canonicalJson(input) !== canonicalJson(output)) {
        throw new Error(`${label} must not change`);
    }
}
function buffersEqual(left, right) {
    return left === null ? right === null : right !== null && left.equals(right);
}
function describeValue(value) {
    return value === null ? '<absent>' : value.toString('hex');
}
function assertTreeValue(tree, key, expectedValue) {
    const actualValue = tree.get(key) ?? null;
    if (!buffersEqual(actualValue, expectedValue)) {
        throw new Error(`Authenticated IBC tree does not match channel datum at ${key}: expected ${expectedValue.toString('hex')}, got ${describeValue(actualValue)}`);
    }
}
async function computeRootWithHandlePacketUpdate(oldRoot, portId, channelId, inputChannelDatum, outputChannelDatum, operation, Lucid) {
    const speculativeTree = getClonedTreeFromRoot(oldRoot);
    const { Data } = Lucid;
    const encodePacketStoreValue = (bytesHex) => Buffer.from(Data.to(bytesHex, Data.Bytes()), 'hex');
    assertHexBytes(operation.kind === 'recv' ? operation.acknowledgementCommitment : operation.commitment, `${operation.kind} commitment`);
    assertUnchanged(inputChannelDatum.port, outputChannelDatum.port, 'channel port');
    assertUnchanged(inputChannelDatum.token, outputChannelDatum.token, 'channel token');
    const mutations = [];
    const applyMutation = (key, expectedOldValue, newValue) => {
        const actualOldValue = speculativeTree.get(key) ?? null;
        if (!buffersEqual(actualOldValue, expectedOldValue)) {
            throw new Error(`Authenticated IBC tree precondition failed for ${key}: expected ${describeValue(expectedOldValue)}, got ${describeValue(actualOldValue)}`);
        }
        const siblings = speculativeTree.getSiblings(key).map((hash) => hash.toString('hex'));
        if (newValue === null) {
            speculativeTree.delete(key);
        }
        else {
            speculativeTree.set(key, newValue);
        }
        mutations.push({
            key,
            oldValue: expectedOldValue?.toString('hex') ?? null,
            newValue: newValue?.toString('hex') ?? null,
        });
        return siblings;
    };
    const inputState = inputChannelDatum.state;
    const outputState = outputChannelDatum.state;
    const ordered = inputState.channel.ordering === 'Ordered';
    const sequence = operation.sequence;
    const integerValue = (value) => Buffer.from(Data.to(value, Data.Integer()), 'hex');
    const channelPath = `channelEnds/ports/${portId}/channels/${channelId}`;
    const nextSequenceSendPath = `nextSequenceSend/ports/${portId}/channels/${channelId}`;
    const nextSequenceRecvPath = `nextSequenceRecv/ports/${portId}/channels/${channelId}`;
    const nextSequenceAckPath = `nextSequenceAck/ports/${portId}/channels/${channelId}`;
    const commitmentPath = `commitments/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
    const receiptPath = `receipts/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
    const acknowledgementPath = `acks/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
    let channelSiblings = [];
    let nextSequenceSendSiblings = [];
    let nextSequenceRecvSiblings = [];
    let nextSequenceAckSiblings = [];
    let packetCommitmentSiblings = [];
    let packetReceiptSiblings = [];
    let packetAcknowledgementSiblings = [];
    const inputChannelValue = Buffer.from(await encodeChannelEndValue(inputState.channel, Lucid), 'hex');
    const outputChannelValue = Buffer.from(await encodeChannelEndValue(outputState.channel, Lucid), 'hex');
    const channelChanged = !inputChannelValue.equals(outputChannelValue);
    assertTreeValue(speculativeTree, nextSequenceSendPath, integerValue(inputState.next_sequence_send));
    assertTreeValue(speculativeTree, nextSequenceRecvPath, integerValue(inputState.next_sequence_recv));
    assertTreeValue(speculativeTree, nextSequenceAckPath, integerValue(inputState.next_sequence_ack));
    assertTreeValue(speculativeTree, channelPath, inputChannelValue);
    if (operation.kind === 'send') {
        assertUnchanged(inputState.channel, outputState.channel, 'channel end during send');
        assertUnchanged(inputState.next_sequence_recv, outputState.next_sequence_recv, 'next_sequence_recv during send');
        assertUnchanged(inputState.next_sequence_ack, outputState.next_sequence_ack, 'next_sequence_ack during send');
        if (sequence !== inputState.next_sequence_send || outputState.next_sequence_send !== sequence + 1n) {
            throw new Error('Send transition must use next_sequence_send and increment it exactly once');
        }
        nextSequenceSendSiblings = applyMutation(nextSequenceSendPath, integerValue(inputState.next_sequence_send), integerValue(outputState.next_sequence_send));
        packetCommitmentSiblings = applyMutation(commitmentPath, null, encodePacketStoreValue(operation.commitment));
    }
    else if (operation.kind === 'recv') {
        assertUnchanged(inputState.channel, outputState.channel, 'channel end during receive');
        assertUnchanged(inputState.next_sequence_send, outputState.next_sequence_send, 'next_sequence_send during receive');
        assertUnchanged(inputState.next_sequence_ack, outputState.next_sequence_ack, 'next_sequence_ack during receive');
        if (ordered) {
            if (sequence !== inputState.next_sequence_recv || outputState.next_sequence_recv !== sequence + 1n) {
                throw new Error('Ordered receive must use next_sequence_recv and increment it exactly once');
            }
            nextSequenceRecvSiblings = applyMutation(nextSequenceRecvPath, integerValue(inputState.next_sequence_recv), integerValue(outputState.next_sequence_recv));
        }
        else {
            assertUnchanged(inputState.next_sequence_recv, outputState.next_sequence_recv, 'next_sequence_recv during unordered receive');
            packetReceiptSiblings = applyMutation(receiptPath, null, encodePacketStoreValue(''));
        }
        packetAcknowledgementSiblings = applyMutation(acknowledgementPath, null, encodePacketStoreValue(operation.acknowledgementCommitment));
    }
    else if (operation.kind === 'acknowledge') {
        assertUnchanged(inputState.channel, outputState.channel, 'channel end during acknowledgement');
        assertUnchanged(inputState.next_sequence_send, outputState.next_sequence_send, 'next_sequence_send during acknowledgement');
        assertUnchanged(inputState.next_sequence_recv, outputState.next_sequence_recv, 'next_sequence_recv during acknowledgement');
        if (ordered) {
            if (sequence !== inputState.next_sequence_ack || outputState.next_sequence_ack !== sequence + 1n) {
                throw new Error('Ordered acknowledgement must use next_sequence_ack and increment it exactly once');
            }
            nextSequenceAckSiblings = applyMutation(nextSequenceAckPath, integerValue(inputState.next_sequence_ack), integerValue(outputState.next_sequence_ack));
        }
        else {
            assertUnchanged(inputState.next_sequence_ack, outputState.next_sequence_ack, 'next_sequence_ack during unordered acknowledgement');
        }
        packetCommitmentSiblings = applyMutation(commitmentPath, encodePacketStoreValue(operation.commitment), null);
    }
    else {
        assertUnchanged(inputState.next_sequence_send, outputState.next_sequence_send, 'next_sequence_send during timeout');
        assertUnchanged(inputState.next_sequence_recv, outputState.next_sequence_recv, 'next_sequence_recv during timeout');
        assertUnchanged(inputState.next_sequence_ack, outputState.next_sequence_ack, 'next_sequence_ack during timeout');
        if (ordered) {
            if (!channelChanged || inputState.channel.state !== 'Open' || outputState.channel.state !== 'Closed') {
                throw new Error('Ordered timeout must close an open channel');
            }
            const expectedClosedChannel = { ...inputState.channel, state: 'Closed' };
            assertUnchanged(expectedClosedChannel, outputState.channel, 'closed channel end during timeout');
            channelSiblings = applyMutation(channelPath, inputChannelValue, outputChannelValue);
        }
        else {
            assertUnchanged(inputState.channel, outputState.channel, 'channel end during unordered timeout');
        }
        packetCommitmentSiblings = applyMutation(commitmentPath, encodePacketStoreValue(operation.commitment), null);
    }
    const newRoot = speculativeTree.getRoot();
    const journalEntry = {
        previousRoot: oldRoot,
        newRoot,
        mutations,
    };
    return {
        newRoot,
        channelSiblings,
        nextSequenceSendSiblings,
        nextSequenceRecvSiblings,
        nextSequenceAckSiblings,
        packetCommitmentSiblings,
        packetReceiptSiblings,
        packetAcknowledgementSiblings,
        journalEntry,
        commit: () => {
            currentTree = speculativeTree;
        },
    };
}
function assertRoot(value, label) {
    if (!/^[0-9a-f]{64}$/i.test(value)) {
        throw new Error(`${label} must be a 32-byte hexadecimal root`);
    }
}
function decodeJournalValue(value, label) {
    if (value === null) {
        return null;
    }
    assertHexBytes(value, label);
    if (value.length === 0) {
        throw new Error(`${label} must use null, not empty bytes, for an absent leaf`);
    }
    return Buffer.from(value, 'hex');
}
function applyVerifiedJournalEntry(tree, entry, direction) {
    assertRoot(entry.previousRoot, 'journal previousRoot');
    assertRoot(entry.newRoot, 'journal newRoot');
    const expectedStartRoot = direction === 'forward' ? entry.previousRoot : entry.newRoot;
    const expectedEndRoot = direction === 'forward' ? entry.newRoot : entry.previousRoot;
    if (tree.getRoot().toLowerCase() !== expectedStartRoot.toLowerCase()) {
        throw new Error(`Journal is not connected to the recovered tree: expected ${expectedStartRoot}, got ${tree.getRoot()}`);
    }
    const mutations = direction === 'forward'
        ? entry.mutations
        : [...entry.mutations].reverse();
    for (const mutation of mutations) {
        if (!mutation.key || typeof mutation.key !== 'string') {
            throw new Error('Journal mutation key must be a non-empty string');
        }
        const oldValue = decodeJournalValue(mutation.oldValue, `old value for ${mutation.key}`);
        const newValue = decodeJournalValue(mutation.newValue, `new value for ${mutation.key}`);
        const expectedValue = direction === 'forward' ? oldValue : newValue;
        const replacementValue = direction === 'forward' ? newValue : oldValue;
        const actualValue = tree.get(mutation.key) ?? null;
        if (!buffersEqual(actualValue, expectedValue)) {
            throw new Error(`Journal precondition failed for ${mutation.key}: expected ${describeValue(expectedValue)}, got ${describeValue(actualValue)}`);
        }
        if (replacementValue === null) {
            tree.delete(mutation.key);
        }
        else {
            tree.set(mutation.key, replacementValue);
        }
    }
    const computedEndRoot = tree.getRoot();
    if (computedEndRoot.toLowerCase() !== expectedEndRoot.toLowerCase()) {
        throw new Error(`Journal root mismatch: expected ${expectedEndRoot}, computed ${computedEndRoot}`);
    }
}
function createTreeCheckpoint(tree = currentTree) {
    const serialized = tree.toJSON();
    return {
        formatVersion: 1,
        root: serialized.root,
        leaves: serialized.leaves,
    };
}
function recoverTreeFromCheckpointAndJournal(recovery, expectedRoot) {
    assertRoot(expectedRoot, 'expected HostState root');
    if (recovery.checkpoint.formatVersion !== 1) {
        throw new Error(`Unsupported IBC tree checkpoint format ${String(recovery.checkpoint.formatVersion)}`);
    }
    assertRoot(recovery.checkpoint.root, 'checkpoint root');
    for (const [key, value] of Object.entries(recovery.checkpoint.leaves)) {
        if (!key) {
            throw new Error('Checkpoint leaf key must be non-empty');
        }
        assertHexBytes(value, `checkpoint value for ${key}`);
        if (value.length === 0) {
            throw new Error(`Checkpoint leaf ${key} must not contain an empty value`);
        }
    }
    const tree = ics23MerkleTree_1.ICS23MerkleTree.fromJSON({ leaves: recovery.checkpoint.leaves });
    const checkpointRoot = tree.getRoot();
    if (checkpointRoot.toLowerCase() !== recovery.checkpoint.root.toLowerCase()) {
        throw new Error(`Checkpoint root mismatch: declared ${recovery.checkpoint.root}, computed ${checkpointRoot}`);
    }
    const targetRoot = expectedRoot.toLowerCase();
    const unused = new Set(recovery.journal.map((_entry, index) => index));
    while (tree.getRoot().toLowerCase() !== targetRoot) {
        const currentRoot = tree.getRoot().toLowerCase();
        const candidates = [...unused].flatMap((index) => {
            const entry = recovery.journal[index];
            const directions = [];
            if (entry.previousRoot.toLowerCase() === currentRoot)
                directions.push('forward');
            if (entry.newRoot.toLowerCase() === currentRoot)
                directions.push('reverse');
            return directions.map((direction) => ({ index, direction }));
        });
        if (candidates.length === 0) {
            throw new Error(`Verified IBC tree recovery does not reach on-chain root ${expectedRoot}; stopped at ${tree.getRoot()}`);
        }
        if (candidates.length > 1) {
            throw new Error(`IBC tree journal branches at root ${tree.getRoot()}; recovery must provide one canonical chain`);
        }
        const [{ index, direction }] = candidates;
        applyVerifiedJournalEntry(tree, recovery.journal[index], direction);
        unused.delete(index);
    }
    return tree;
}
function installVerifiedTreeRecovery(recovery, expectedRoot) {
    const tree = recoverTreeFromCheckpointAndJournal(recovery, expectedRoot);
    currentTree = tree;
    return { tree, root: tree.getRoot() };
}
function resetTreeState() {
    currentTree = new ics23MerkleTree_1.ICS23MerkleTree();
}
async function rebuildTreeFromChain(kupoService, lucidService, recoveryStore) {
    const hostStateUtxo = await lucidService.findUtxoAtHostStateNFT();
    if (!hostStateUtxo?.datum) {
        throw new Error('HostState UTXO has no datum');
    }
    const hostStateDatum = await lucidService.decodeDatum(hostStateUtxo.datum, 'host_state');
    const expectedRoot = hostStateDatum.state.ibc_state_root;
    if (recoveryStore) {
        const recovery = await recoveryStore.load(expectedRoot);
        if (recovery) {
            return installVerifiedTreeRecovery(recovery, expectedRoot);
        }
    }
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
        for (const [portNumber, registration] of boundPorts.entries()) {
            const portId = `port-${portNumber.toString()}`;
            const portValue = Buffer.from(Data.to(registration, ModuleRegistrationSchema), 'hex');
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
    }
    const computedRoot = tree.getRoot();
    if (computedRoot !== expectedRoot) {
        throw new Error(`Tree rebuild failed: expected ${expectedRoot} but datum-backed state computed ${computedRoot}. ` +
            'Packet leaves are root-authoritative and cannot be recovered from channel UTxOs; ' +
            'configure an IBC tree recovery store containing a verified checkpoint/journal chain.');
    }
    currentTree = tree;
    return { tree, root: computedRoot };
}
