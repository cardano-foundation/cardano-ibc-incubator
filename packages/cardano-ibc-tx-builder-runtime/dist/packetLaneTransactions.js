"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPacketTimeoutOnClose = exports.buildPacketRejection = exports.buildPacketTimeout = exports.buildPacketAcknowledgement = exports.MAX_LANE_BALANCES = exports.sha256 = exports.outRef = exports.encode = exports.variant = exports.record = void 0;
exports.buildPacketBalanceCompaction = buildPacketBalanceCompaction;
exports.buildTransferIntent = buildTransferIntent;
exports.laneTree = laneTree;
exports.buildPacketSendBatch = buildPacketSendBatch;
exports.buildLiquidityRetirement = buildLiquidityRetirement;
exports.buildTransferIntentCancellation = buildTransferIntentCancellation;
exports.buildPacketLaneInitialization = buildPacketLaneInitialization;
exports.buildPacketReceive = buildPacketReceive;
exports.voucherTokenName = voucherTokenName;
exports.localAssetUnit = localAssetUnit;
exports.buildPacketPrune = buildPacketPrune;
exports.usableTransferIntent = usableTransferIntent;
exports.selectPacketLiquidity = selectPacketLiquidity;
const sha256_1 = require("@noble/hashes/sha256");
const blake2b_1 = require("@noble/hashes/blake2b");
const lucid_1 = require("@lucid-evolution/lucid");
const packet_lanes_1 = require("@cardano-ibc/tx-builder/dist/packet-lanes");
const ics20_json_codec_1 = require("@cardano-ibc/tx-builder/dist/ics20-json-codec");
const ics23MerkleTree_ts_1 = require("./ics23MerkleTree.js");
class PacketLaneTree {
    tree = new ics23MerkleTree_ts_1.ICS23MerkleTree();
    set(key, value) {
        this.tree.set(key, value);
    }
    getRoot() {
        return this.tree.getRoot();
    }
    getSiblings(key) {
        return this.tree.getSiblings(key).map((value) => value.toString("hex"));
    }
}
const record = (...fields) => new lucid_1.Constr(0, fields);
exports.record = record;
const variant = (index, ...fields) => new lucid_1.Constr(index, fields);
exports.variant = variant;
const encode = (data) => lucid_1.Data.to(data);
exports.encode = encode;
const outRef = (utxo) => (0, exports.record)(utxo.txHash, BigInt(utxo.outputIndex));
exports.outRef = outRef;
const copy = (data) => lucid_1.Data.from((0, exports.encode)(data));
const sha256 = async (hex) => (0, lucid_1.toHex)(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array((0, lucid_1.fromHex)(hex)))));
exports.sha256 = sha256;
const operationNames = [
    "send",
    "acknowledge",
    "timeout",
    "retire",
    "retire",
    "receive",
    "reject",
    "prune",
    "timeout_on_close",
];
exports.MAX_LANE_BALANCES = 8;
/** Cancel completed cross-lane obligations, or redistribute keys to admit a return.
 * Only these two lanes are spent. Packet roots, replay state and reserves are preserved.
 * leftDenoms can place a returning asset in its receive lane even when both maps are full.
 */
async function buildPacketBalanceCompaction(lucid, deployment, leftLane, rightLane, leftDenoms) {
    if (leftLane === rightLane) {
        throw new Error("Compaction requires different lanes");
    }
    const { port, channelId } = channelIdentity(deployment);
    const inputs = await Promise.all([leftLane, rightLane].map((lane) => lucid.utxoByUnit(deployment.statePolicy +
        (0, packet_lanes_1.packetLaneTokenName)(port, channelId, lane, deployment.laneCount))));
    const datums = inputs.map((input) => copy(decode(input)));
    const totals = new Map();
    for (const datum of datums) {
        for (const [key, amount] of datum.fields[11]) {
            totals.set(key, (totals.get(key) ?? 0n) + amount);
        }
    }
    const entries = [...totals].filter(([, amount]) => amount !== 0n)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const preferred = leftDenoms?.map((denom) => (0, lucid_1.toHex)((0, sha256_1.sha256)(new TextEncoder().encode(denom))));
    const leftKeys = new Set(preferred ?? entries.slice(0, exports.MAX_LANE_BALANCES).map(([key]) => key));
    for (const [i, datum] of datums.entries()) {
        const balances = new Map(entries.filter(([key]) => leftKeys.has(key) === (i === 0)));
        if (balances.size > exports.MAX_LANE_BALANCES) {
            throw new Error("Redistribution exceeds lane accounting capacity");
        }
        datum.fields[11] = balances;
        datum.fields[4] = datum.fields[4] + 1n;
    }
    let tx = lucid.newTx().readFrom(deployment.scripts.filter((u) => u.scriptRef));
    for (const [i, input] of inputs.entries()) {
        tx = tx.collectFrom([input], (0, exports.encode)((0, exports.variant)(5, (0, exports.outRef)(inputs[1 - i]))))
            .pay.ToContract(input.address, {
            kind: "inline",
            value: (0, exports.encode)(datums[i]),
        }, input.assets);
    }
    return { tx, inputs, datums };
}
function addLaneBalance(datum, denom, delta) {
    const balances = datum.fields[11];
    const key = (0, lucid_1.toHex)((0, sha256_1.sha256)(new TextEncoder().encode(denom)));
    const amount = (balances.get(key) ?? 0n) + delta;
    if (amount === 0n)
        balances.delete(key);
    else
        balances.set(key, amount);
    if (balances.size > exports.MAX_LANE_BALANCES) {
        throw new Error("Packet lane accounting is full. Compact or redistribute balances before retrying.");
    }
    datum.fields[11] = new Map([...balances].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
async function authorizeOperation(tx, deployment, operation, mint) {
    const authorized = (0, exports.encode)((0, exports.record)(decode(deployment.channel).fields[2], operation, deployment.historyWitness
        ? (0, exports.variant)(0, deployment.historyWitness)
        : (0, exports.variant)(1)));
    tx = tx.mintAssets(mint, authorized);
    const names = [operationNames[operation.index]];
    if ([0, 1, 2, 5, 6, 8].includes(operation.index)) {
        names.push(operation.index === 0 ? "send_funds" : "funds");
    }
    for (const name of names) {
        const validator = deployment.operations[name];
        if (!validator)
            throw new Error(`Missing packet operation policy: ${name}`);
        tx = tx.readFrom([validator.reference]).mintAssets({
            [validator.policy]: 1n,
        }, lucid_1.Data.void());
    }
    if (![0, 3, 4].includes(operation.index)) {
        const proof = await packetProof(deployment, operation);
        tx = tx.readFrom([deployment.proofVerifier.reference]).mintAssets({
            [deployment.proofVerifier.policy]: 1n,
        }, (0, exports.encode)((0, exports.record)(proof, (0, exports.variant)(1))));
    }
    return tx;
}
function mapAtHeight(map, height) {
    if (!(map instanceof Map))
        throw new Error("Invalid client consensus map");
    for (const [key, value] of map) {
        if ((0, exports.encode)(key) === (0, exports.encode)(height))
            return value;
    }
    throw new Error("Client does not contain the requested proof height");
}
// The operation validator compares this envelope to the authenticated client,
// connection and packet. The verifier performs the ICS-23 computation.
async function packetProof(deployment, op) {
    const receive = op.index === 5;
    const prune = op.index === 7;
    const timeout = op.index === 2 || op.index === 8;
    const heightIndex = op.index === 1 || prune ? 1 : op.index === 6 ? 3 : 2;
    const height = op.fields[heightIndex];
    const proof = op.fields[heightIndex + 1];
    const client = decode(deployment.client).fields[0];
    const connection = decode(deployment.connection).fields[0];
    const counterparty = connection.fields[3];
    const prefix = counterparty.fields[2].fields[0];
    let consensus, processedTime, processedHeight;
    if (deployment.historyWitness) {
        const history = deployment.historyWitness
            .fields[0];
        if ((0, exports.encode)(history.fields[1]) !== (0, exports.encode)(height)) {
            throw new Error("History witness height mismatch");
        }
        [consensus, processedTime, processedHeight] = history.fields.slice(2, 5);
    }
    else {
        consensus = mapAtHeight(client.fields[1], height);
        processedTime = mapAtHeight(client.fields[2], height);
        processedHeight = mapAtHeight(client.fields[3], height);
    }
    const delay = connection.fields[4];
    const common = [
        client.fields[0],
        consensus,
        height,
        processedTime,
        processedHeight,
        delay,
        (delay + 3999999999n) / 4000000000n,
    ];
    const channel = channelIdentity(deployment);
    const packet = op.fields[0];
    const port = prune
        ? channel.counterparty.fields[0]
        : packet.fields[receive ? 1 : 3];
    const channelId = prune
        ? channel.counterparty.fields[1]
        : packet.fields[receive ? 2 : 4];
    const sequence = prune ? op.fields[0] : packet.fields[0];
    const kind = prune || receive ? "commitments" : timeout ? "receipts" : "acks";
    const path = (0, exports.record)([
        prefix,
        (0, lucid_1.fromText)(`${kind}/ports/${(0, lucid_1.toText)(String(port))}/channels/${(0, lucid_1.toText)(String(channelId))}/sequences/${sequence}`),
    ]);
    if (op.index === 8) {
        const end = decode(deployment.channel).fields[0]
            .fields[0];
        const counterpart = protobufBytes(1, String(packet.fields[1])) +
            protobufBytes(2, String(packet.fields[2]));
        const closedChannel = "08041001" + protobufBytes(3, counterpart) +
            protobufBytes(4, String(counterparty.fields[1])) +
            protobufBytes(5, String(end.fields[4]));
        const closePath = (0, exports.record)([
            prefix,
            (0, lucid_1.fromText)(`channelEnds/ports/${(0, lucid_1.toText)(String(port))}/channels/${(0, lucid_1.toText)(String(channelId))}`),
        ]);
        const membership = (0, exports.record)(...common.slice(0, 5), 0n, 0n, op.fields[6], closePath, closedChannel);
        return (0, exports.variant)(4, [membership], [(0, exports.record)(...common, proof, path)]);
    }
    if (timeout || prune)
        return (0, exports.variant)(1, ...common, proof, path);
    const value = receive
        ? await (0, exports.sha256)(packet.fields[7].toString(16).padStart(16, "0") +
            packet.fields[6].fields[0].toString(16)
                .padStart(16, "0") +
            packet.fields[6].fields[1].toString(16)
                .padStart(16, "0") +
            await (0, exports.sha256)(String(packet.fields[5])))
        : await (0, exports.sha256)((0, lucid_1.fromText)(op.index === 6
            ? `{"error":"${(0, lucid_1.toText)(String(op.fields[2]))}"}`
            : '{"result":"AQ=="}'));
    return (0, exports.variant)(0, ...common, proof, path, value);
}
function protobufBytes(field, hex) {
    let length = hex.length / 2;
    let encoded = "";
    do {
        const next = length % 128;
        length = Math.floor(length / 128);
        encoded += (next | (length ? 128 : 0)).toString(16).padStart(2, "0");
    } while (length);
    return (field * 8 + 2).toString(16).padStart(2, "0") + encoded + hex;
}
function decode(utxo) {
    if (!utxo.datum)
        throw new Error("Expected inline datum");
    const data = lucid_1.Data.from(utxo.datum);
    if (!(data instanceof lucid_1.Constr) || data.index !== 0) {
        throw new Error("Unexpected datum");
    }
    return data;
}
function channelIdentity(deployment) {
    const channel = decode(deployment.channel);
    const token = channel.fields[2];
    const channelId = `channel-${(0, lucid_1.toText)(String(token.fields[1]).slice(48))}`;
    const port = (0, lucid_1.toText)(String(channel.fields[1]));
    const state = channel.fields[0];
    const end = state.fields[0];
    const counterparty = end.fields[2];
    return { port, channelId, counterparty };
}
/** Admission spends only the user's funding. It has no protocol state inputs. */
async function buildTransferIntent(lucid, deployment, request) {
    const { port, channelId } = channelIdentity(deployment);
    const owner = (0, lucid_1.getAddressDetails)(await lucid.wallet().address()).paymentCredential;
    if (owner?.type !== "Key") {
        throw new Error("Intent owner must be a payment key");
    }
    const unit = request.assetUnit ?? "lovelace";
    if (unit !== "lovelace" &&
        (!/^[0-9a-f]{56,120}$/.test(unit) || unit.length % 2 !== 0))
        throw new Error("Invalid native asset unit");
    const amount = request.amount;
    const reserve = request.reserve ?? 3000000n;
    if (amount <= 0n || reserve <= 0n || request.timeoutTimestamp <= 0n) {
        throw new Error("Invalid funded intent");
    }
    const data = {
        amount: amount.toString(),
        denom: request.fullDenom ?? (unit === "lovelace" ? (0, lucid_1.fromText)(unit) : unit),
        memo: request.memo ?? "",
        receiver: request.receiver,
        sender: owner.hash,
    };
    (0, ics20_json_codec_1.stringifyIcs20PacketData)(data);
    const intent = (0, exports.record)((0, lucid_1.fromText)(port), (0, lucid_1.fromText)(channelId), owner.hash, (0, exports.record)((0, lucid_1.fromText)(data.denom), (0, lucid_1.fromText)(data.amount), (0, lucid_1.fromText)(data.sender), (0, lucid_1.fromText)(data.receiver), (0, lucid_1.fromText)(data.memo)), request.timeoutTimestamp);
    const assets = { lovelace: reserve };
    assets[unit] = (assets[unit] ?? 0n) + amount;
    return lucid.newTx().pay.ToContract(deployment.guardAddress, {
        kind: "inline",
        value: (0, exports.encode)(intent),
    }, assets);
}
async function laneTree(datum) {
    const port = (0, lucid_1.toText)(String(datum.fields[0]));
    const channel = (0, lucid_1.toText)(String(datum.fields[1]));
    const tree = new PacketLaneTree();
    for (const [sequence, value] of datum.fields[6]) {
        tree.set(`commitments/ports/${port}/channels/${channel}/sequences/${sequence}`, value);
    }
    for (const sequence of datum.fields[7]) {
        tree.set(`receipts/ports/${port}/channels/${channel}/sequences/${sequence}`, "01");
    }
    for (const [sequence, value] of datum.fields[8]) {
        tree.set(`acks/ports/${port}/channels/${channel}/sequences/${sequence}`, value);
    }
    if (await tree.getRoot() !== datum.fields[5]) {
        throw new Error("Lane datum does not match its root");
    }
    return tree;
}
async function requireUnspent(lucid, inputs) {
    const actual = await lucid.utxosByOutRef(inputs.map(({ txHash, outputIndex }) => ({ txHash, outputIndex })));
    const refs = new Set(actual.map((u) => `${u.txHash}#${u.outputIndex}`));
    if (inputs.some((u) => !refs.has(`${u.txHash}#${u.outputIndex}`))) {
        throw new Error("State or intent input is no longer unspent, rebuild from included state");
    }
}
/** Read current included outputs on every build. Preparing a transaction never
 * publishes speculative roots or sequences, so retries after rollback reload
 * the ledger's state instead of advancing a process-local counter. */
async function buildPacketSendBatch(lucid, deployment, intents, validFrom, validTo) {
    if (intents.length < 1 || intents.length > 2) {
        throw new Error("Send batch requires one or two intents");
    }
    if (new Set(intents.map((u) => `${u.txHash}#${u.outputIndex}`)).size !==
        intents.length)
        throw new Error("Duplicate intent");
    await requireUnspent(lucid, intents);
    const { port, channelId, counterparty } = channelIdentity(deployment);
    const sequencer = await lucid.utxoByUnit(deployment.statePolicy + (0, packet_lanes_1.sendSequencerTokenName)(port, channelId));
    const oldSequence = decode(sequencer);
    const firstSequence = oldSequence.fields[3];
    const packets = [];
    const lanes = new Map();
    const escrows = [];
    const mint = {};
    for (const [index, input] of intents.entries()) {
        const intent = decode(input);
        if (intent.fields[0] !== (0, lucid_1.fromText)(port) ||
            intent.fields[1] !== (0, lucid_1.fromText)(channelId))
            throw new Error("Intent belongs to another channel");
        const fields = intent.fields[3].fields;
        const data = {
            denom: (0, lucid_1.toText)(fields[0]),
            amount: (0, lucid_1.toText)(fields[1]),
            sender: (0, lucid_1.toText)(fields[2]),
            receiver: (0, lucid_1.toText)(fields[3]),
            memo: (0, lucid_1.toText)(fields[4]),
        };
        const timeout = intent.fields[4];
        if (timeout <= BigInt(validTo) * 1000000n) {
            throw new Error("Intent timeout is too early for batch validity");
        }
        const payload = (0, lucid_1.fromText)((0, ics20_json_codec_1.stringifyIcs20PacketData)(data));
        const sequence = firstSequence + BigInt(index);
        const packet = (0, exports.record)(sequence, (0, lucid_1.fromText)(port), (0, lucid_1.fromText)(channelId), ...counterparty.fields, payload, (0, exports.record)(0n, 0n), timeout);
        packets.push(packet);
        const commitment = await (0, exports.sha256)(timeout.toString(16).padStart(16, "0") + "00".repeat(16) +
            await (0, exports.sha256)(payload));
        const laneId = (0, packet_lanes_1.packetLane)(port, channelId, sequence, deployment.laneCount);
        let lane = lanes.get(laneId);
        if (!lane) {
            const utxo = await lucid.utxoByUnit(deployment.statePolicy +
                (0, packet_lanes_1.packetLaneTokenName)(port, channelId, laneId, deployment.laneCount));
            const datum = copy(decode(utxo));
            lane = { input: utxo, datum, tree: await laneTree(datum), updates: [] };
            lanes.set(laneId, lane);
        }
        const key = `commitments/ports/${port}/channels/${channelId}/sequences/${sequence}`;
        const siblings = await lane.tree.getSiblings(key);
        lane.tree.set(key, commitment);
        lane.updates.push((0, exports.record)((0, exports.variant)(0, packet), [siblings]));
        lane.datum.fields[6].set(sequence, commitment);
        addLaneBalance(lane.datum, data.denom, BigInt(data.amount) *
            (data.denom.startsWith(`${port}/${channelId}/`) ? -1n : 1n));
        if (data.denom.startsWith(`${port}/${channelId}/`)) {
            const unit = localAssetUnit(data.denom, deployment);
            mint[unit] = (mint[unit] ?? 0n) - BigInt(data.amount);
            mint[deployment.batchPolicy + (0, lucid_1.fromText)("send")] = 1n;
            continue;
        }
        const token = (0, packet_lanes_1.liquidityTokenName)(port, channelId, data.denom, input.txHash, input.outputIndex);
        const unit = localAssetUnit(data.denom, deployment);
        const escrow = (0, exports.record)((0, lucid_1.fromText)(port), (0, lucid_1.fromText)(channelId), fields[0], unit === "lovelace" ? "" : unit.slice(0, 56), unit === "lovelace" ? "" : unit.slice(56), (0, exports.outRef)(input), BigInt(data.amount), (0, exports.record)((0, exports.variant)(0, String(intent.fields[2])), (0, exports.variant)(1)));
        escrows.push({
            datum: escrow,
            assets: { ...input.assets, [deployment.batchPolicy + token]: 1n },
        });
        mint[deployment.batchPolicy + token] = 1n;
    }
    const ordered = [...lanes.entries()].sort(([a], [b]) => a - b).map(([, lane]) => lane);
    const laneUpdates = ordered.map((lane) => (0, exports.record)((0, exports.outRef)(lane.input), lane.updates));
    const operation = (0, exports.variant)(0, (0, exports.outRef)(sequencer), intents.map(exports.outRef), packets, laneUpdates);
    const nextSequence = copy(oldSequence);
    nextSequence.fields[2] = oldSequence.fields[2] + 1n;
    nextSequence.fields[3] = firstSequence + BigInt(intents.length);
    let tx = lucid.newTx().readFrom([
        deployment.channel,
        deployment.connection,
        deployment.client,
        ...deployment.scripts,
    ])
        .collectFrom(intents, (0, exports.encode)((0, exports.variant)(0)))
        .collectFrom([sequencer], (0, exports.encode)((0, exports.variant)(2)))
        .pay.ToContract(deployment.guardAddress, {
        kind: "inline",
        value: (0, exports.encode)(nextSequence),
    }, sequencer.assets)
        .validFrom(validFrom).validTo(validTo);
    for (const lane of ordered) {
        lane.datum.fields[4] = lane.datum.fields[4] + 1n;
        lane.datum.fields[5] = await lane.tree.getRoot();
        // Aiken's map insertion orders sequences. Preserve that representation.
        lane.datum.fields[6] = new Map([...lane.datum.fields[6]].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
        tx = tx.collectFrom([lane.input], (0, exports.encode)((0, exports.variant)(3)))
            .pay.ToContract(deployment.guardAddress, {
            kind: "inline",
            value: (0, exports.encode)(lane.datum),
        }, lane.input.assets);
    }
    for (const escrow of escrows) {
        tx = tx.pay.ToContract(deployment.batchAddress, {
            kind: "inline",
            value: (0, exports.encode)(escrow.datum),
        }, escrow.assets);
    }
    if (deployment.voucherPolicy &&
        Object.keys(mint).some((unit) => unit.startsWith(deployment.voucherPolicy))) {
        const burns = Object.fromEntries(Object.entries(mint).filter(([unit]) => unit.startsWith(deployment.voucherPolicy)));
        // Minting policies require separate redeemers. The batch policy only owns liquidity identities.
        tx = tx.mintAssets(burns, (0, exports.encode)((0, exports.variant)(4)));
        for (const input of intents) {
            const intent = decode(input);
            const data = intent.fields[3];
            if (!(0, lucid_1.toText)(String(data.fields[0])).startsWith(`${port}/${channelId}/`)) {
                continue;
            }
            tx = tx.pay.ToAddressWithData((0, lucid_1.credentialToAddress)(lucid.config().network, {
                type: "Key",
                hash: String(intent.fields[2]),
            }), { kind: "inline", value: (0, exports.encode)((0, exports.outRef)(input)) }, { lovelace: input.assets.lovelace });
        }
    }
    await requireUnspent(lucid, [
        sequencer,
        ...ordered.map((lane) => lane.input),
        deployment.channel,
        deployment.connection,
        deployment.client,
    ]);
    tx = await authorizeOperation(tx, deployment, operation, Object.fromEntries(Object.entries(mint).filter(([unit]) => unit.startsWith(deployment.batchPolicy))));
    return {
        tx,
        packets,
        operation,
        inputs: [sequencer, ...intents, ...ordered.map((lane) => lane.input)],
        escrows,
    };
}
async function buildPacketCompletion(lucid, deployment, packet, proofHeight, proof, validFrom, validTo, liquidity, rejection, proofClose) {
    const { port, channelId } = channelIdentity(deployment);
    const sequence = packet.fields[0];
    const laneId = (0, packet_lanes_1.packetLane)(port, channelId, sequence, deployment.laneCount);
    const input = await lucid.utxoByUnit(deployment.statePolicy +
        (0, packet_lanes_1.packetLaneTokenName)(port, channelId, laneId, deployment.laneCount));
    const datum = copy(decode(input));
    const tree = await laneTree(datum);
    const key = `commitments/ports/${port}/channels/${channelId}/sequences/${sequence}`;
    const siblings = await tree.getSiblings(key);
    tree.set(key, "");
    if (!datum.fields[6].delete(sequence)) {
        throw new Error("Packet commitment is absent");
    }
    datum.fields[4] = datum.fields[4] + 1n;
    datum.fields[5] = await tree.getRoot();
    const update = (0, exports.record)((0, exports.outRef)(input), [
        (0, exports.record)((0, exports.variant)(2, packet), [siblings]),
    ]);
    let operation = (0, exports.variant)(1, packet, proofHeight, proof, update);
    const mint = {
        [deployment.batchPolicy + (0, lucid_1.fromText)("acknowledge")]: 1n,
    };
    if (liquidity) {
        const data = JSON.parse((0, lucid_1.toText)(String(packet.fields[5])));
        addLaneBalance(datum, data.denom, BigInt(data.amount) *
            (data.denom.startsWith(`${port}/${channelId}/`) ? 1n : -1n));
    }
    let tx = lucid.newTx().readFrom([
        deployment.channel,
        deployment.connection,
        deployment.client,
        ...deployment.scripts,
    ])
        .collectFrom([input], (0, exports.encode)((0, exports.variant)(3)))
        .pay.ToContract(deployment.guardAddress, {
        kind: "inline",
        value: (0, exports.encode)(datum),
    }, input.assets)
        .validFrom(validFrom).validTo(validTo);
    if (liquidity) {
        await requireUnspent(lucid, liquidity);
        const data = JSON.parse((0, lucid_1.toText)(String(packet.fields[5])));
        const fields = (0, exports.record)(...[data.denom, data.amount, data.sender, data.receiver, data.memo ?? ""]
            .map(lucid_1.fromText));
        operation = (0, exports.variant)(2, packet, fields, proofHeight, proof, update, liquidity.map(exports.outRef));
        delete mint[deployment.batchPolicy + (0, lucid_1.fromText)("acknowledge")];
        mint[deployment.batchPolicy + (0, lucid_1.fromText)("timeout")] = 1n;
        if (proofClose) {
            operation = (0, exports.variant)(8, packet, fields, proofHeight, proof, update, liquidity.map(exports.outRef), proofClose);
        }
        if (rejection !== undefined) {
            if (!rejection)
                throw new Error("Empty rejection acknowledgement");
            operation = (0, exports.variant)(6, packet, fields, (0, lucid_1.fromText)(JSON.stringify(rejection).slice(1, -1)), proofHeight, proof, update, liquidity.map(exports.outRef));
            delete mint[deployment.batchPolicy + (0, lucid_1.fromText)("timeout")];
            mint[deployment.batchPolicy + (0, lucid_1.fromText)("reject")] = 1n;
        }
        if (data.denom.startsWith(`${port}/${channelId}/`)) {
            if (liquidity.length) {
                throw new Error("Voucher refund must not release escrow");
            }
            tx = voucherPayment(lucid, deployment, tx, port, channelId, sequence, data.denom, BigInt(data.amount), data.sender);
        }
        else {
            tx = await releaseLiquidity(lucid, deployment, tx, mint, port, channelId, sequence, data.denom, BigInt(data.amount), data.sender, liquidity);
        }
    }
    await requireUnspent(lucid, [
        input,
        deployment.channel,
        deployment.connection,
        deployment.client,
    ]);
    return {
        tx: await authorizeOperation(tx, deployment, operation, mint),
        input,
    };
}
const buildPacketAcknowledgement = (lucid, deployment, packet, proofHeight, proof, validFrom, validTo) => buildPacketCompletion(lucid, deployment, packet, proofHeight, proof, validFrom, validTo);
exports.buildPacketAcknowledgement = buildPacketAcknowledgement;
/** Full-drain timeout refunds. Partial releases require a separate selection strategy. */
const buildPacketTimeout = (lucid, deployment, packet, proofHeight, proof, liquidity, validFrom, validTo) => buildPacketCompletion(lucid, deployment, packet, proofHeight, proof, validFrom, validTo, liquidity);
exports.buildPacketTimeout = buildPacketTimeout;
function liquidityUnit(input, deployment) {
    const units = Object.entries(input.assets).filter(([unit, quantity]) => unit.startsWith(deployment.batchPolicy) && quantity === 1n);
    if (units.length !== 1)
        throw new Error("Expected one liquidity identity");
    return units[0][0];
}
function refundReserve(tx, lucid, deployment, input) {
    const old = decode(input);
    const reserve = input.assets.lovelace -
        (old.fields[3] === "" && old.fields[4] === ""
            ? old.fields[6]
            : 0n);
    const owner = old.fields[7];
    const credential = owner.fields[0];
    if (credential.index !== 0 || owner.fields[1].index !== 1) {
        throw new Error("Expected an enterprise reserve owner");
    }
    const address = (0, lucid_1.credentialToAddress)(lucid.config().network, {
        type: "Key",
        hash: String(credential.fields[0]),
    });
    const token = liquidityUnit(input, deployment).slice(56);
    return tx.pay.ToAddressWithData(address, {
        kind: "inline",
        value: (0, exports.encode)((0, exports.record)(deployment.batchPolicy, token)),
    }, { lovelace: reserve });
}
/** Retire empty outputs, or consolidate into the first identity without releasing principal. */
async function buildLiquidityRetirement(lucid, deployment, inputs, consolidate = false) {
    if (inputs.length < (consolidate ? 2 : 1) || inputs.length > 5) {
        throw new Error("Invalid retirement input count");
    }
    if (new Set(inputs.map((u) => `${u.txHash}#${u.outputIndex}`)).size !==
        inputs.length)
        throw new Error("Duplicate liquidity input");
    await requireUnspent(lucid, inputs);
    let tx = lucid.newTx().readFrom(deployment.scripts).collectFrom(inputs, lucid_1.Data.void());
    const mint = {};
    const survivor = copy(decode(inputs[0]));
    let total = 0n;
    for (const [index, input] of inputs.entries()) {
        const datum = decode(input);
        if ((0, exports.encode)(datum.fields.slice(0, 5)) !== (0, exports.encode)(survivor.fields.slice(0, 5)))
            throw new Error("Cannot consolidate different assets or channels");
        const amount = datum.fields[6];
        total += amount;
        if (!consolidate && amount !== 0n) {
            throw new Error("Only empty liquidity can retire without a packet proof");
        }
        if (consolidate && index === 0)
            continue;
        mint[liquidityUnit(input, deployment)] = -1n;
        tx = refundReserve(tx, lucid, deployment, input);
    }
    if (consolidate) {
        const unit = survivor.fields[3] === "" && survivor.fields[4] === ""
            ? "lovelace"
            : String(survivor.fields[3]) + String(survivor.fields[4]);
        const assets = { ...inputs[0].assets };
        assets[unit] = (assets[unit] ?? 0n) + total -
            survivor.fields[6];
        survivor.fields[6] = total;
        tx = tx.pay.ToContract(deployment.batchAddress, {
            kind: "inline",
            value: (0, exports.encode)(survivor),
        }, assets);
    }
    const operation = consolidate
        ? (0, exports.variant)(4, inputs.map(exports.outRef), (0, exports.outRef)(inputs[0]))
        : (0, exports.variant)(3, inputs.map(exports.outRef));
    return await authorizeOperation(tx, deployment, operation, mint);
}
async function buildTransferIntentCancellation(lucid, deployment, intent) {
    await requireUnspent(lucid, [intent]);
    const owner = (0, lucid_1.getAddressDetails)(await lucid.wallet().address()).paymentCredential;
    if (owner?.type !== "Key" || owner.hash !== decode(intent).fields[2]) {
        throw new Error("Only the intent owner can cancel");
    }
    // The owner's signature authorizes the normal wallet change and fees.
    return lucid.newTx().readFrom(deployment.scripts)
        .collectFrom([intent], (0, exports.encode)((0, exports.variant)(1))).addSignerKey(owner.hash);
}
async function buildPacketLaneInitialization(lucid, deployment, config, registryAddress) {
    const { port, channelId } = channelIdentity(deployment);
    const registry = await lucid.utxoByUnit(deployment.statePolicy + (0, lucid_1.fromText)("ibc_packet_registry"));
    const next = decode(registry).fields[0];
    if (channelId !== `channel-${next}`) {
        throw new Error("Channels must initialize in creation order");
    }
    const mint = {
        [deployment.statePolicy + (0, packet_lanes_1.sendSequencerTokenName)(port, channelId)]: 1n,
    };
    let tx = lucid.newTx().readFrom([
        config,
        deployment.channel,
        ...deployment.scripts,
    ])
        .collectFrom([registry], lucid_1.Data.void())
        .pay.ToContract(registryAddress, {
        kind: "inline",
        value: (0, exports.encode)((0, exports.record)(next + 1n)),
    }, registry.assets)
        .pay.ToContract(deployment.guardAddress, {
        kind: "inline",
        value: (0, exports.encode)((0, exports.record)((0, lucid_1.fromText)(port), (0, lucid_1.fromText)(channelId), 0n, 1n)),
    }, {
        [deployment.statePolicy + (0, packet_lanes_1.sendSequencerTokenName)(port, channelId)]: 1n,
    });
    for (let lane = 0; lane < deployment.laneCount; lane++) {
        const token = deployment.statePolicy +
            (0, packet_lanes_1.packetLaneTokenName)(port, channelId, lane, deployment.laneCount);
        mint[token] = 1n;
        tx = tx.pay.ToContract(deployment.guardAddress, {
            kind: "inline",
            value: (0, exports.encode)((0, exports.record)((0, lucid_1.fromText)(port), (0, lucid_1.fromText)(channelId), BigInt(lane), BigInt(deployment.laneCount), 0n, "00".repeat(32), new Map(), [], new Map(), (0, exports.record)(0n, 0n), (0, exports.record)(0n, 0n), new Map())),
        }, { [token]: 1n });
    }
    return tx.mintAssets(mint, (0, exports.encode)((0, exports.variant)(1, decode(deployment.channel).fields[2])));
}
/** Select and release independent deposits. A full drain returns its reserve and burns its identity. */
async function releaseLiquidity(lucid, deployment, tx, mint, port, channel, sequence, denom, amount, recipient, inputs) {
    if (inputs.length < 1 || inputs.length > 5 ||
        new Set(inputs.map((u) => `${u.txHash}#${u.outputIndex}`)).size !==
            inputs.length) {
        throw new Error("Invalid liquidity selection");
    }
    await requireUnspent(lucid, inputs);
    let remaining = amount;
    const unit = localAssetUnit(denom, deployment);
    for (const input of inputs) {
        const datum = copy(decode(input));
        if (datum.fields[0] !== (0, lucid_1.fromText)(port) ||
            datum.fields[1] !== (0, lucid_1.fromText)(channel) ||
            datum.fields[2] !== (0, lucid_1.fromText)(denom)) {
            throw new Error("Liquidity belongs to another channel or denomination");
        }
        const available = datum.fields[6];
        if (remaining <= 0n || available <= 0n) {
            throw new Error("Unused liquidity input");
        }
        const released = available < remaining ? available : remaining;
        remaining -= released;
        tx = tx.collectFrom([input], lucid_1.Data.void());
        if (released === available) {
            mint[liquidityUnit(input, deployment)] = -1n;
            tx = refundReserve(tx, lucid, deployment, input);
        }
        else {
            datum.fields[6] = available - released;
            tx = tx.pay.ToContract(deployment.batchAddress, {
                kind: "inline",
                value: (0, exports.encode)(datum),
            }, {
                ...input.assets,
                [unit]: input.assets[unit] - released,
            });
        }
    }
    if (remaining !== 0n)
        throw new Error("Insufficient selected liquidity");
    return tx.pay.ToAddressWithData((0, lucid_1.credentialToAddress)(lucid.config().network, {
        type: "Key",
        hash: recipient,
    }), {
        kind: "inline",
        value: (0, exports.encode)((0, exports.record)((0, lucid_1.fromText)(port), (0, lucid_1.fromText)(channel), sequence)),
    }, { [unit]: amount });
}
async function buildPacketReceive(lucid, deployment, packet, proofHeight, proof, liquidity, validFrom, validTo) {
    const { port, channelId } = channelIdentity(deployment);
    const sequence = packet.fields[0];
    const laneId = (0, packet_lanes_1.packetLane)(port, channelId, sequence, deployment.laneCount);
    const input = await lucid.utxoByUnit(deployment.statePolicy +
        (0, packet_lanes_1.packetLaneTokenName)(port, channelId, laneId, deployment.laneCount));
    const datum = copy(decode(input));
    const tree = await laneTree(datum);
    if (datum.fields[7].includes(sequence)) {
        throw new Error("Packet already received");
    }
    const receiptKey = `receipts/ports/${port}/channels/${channelId}/sequences/${sequence}`;
    const ackKey = `acks/ports/${port}/channels/${channelId}/sequences/${sequence}`;
    const receiptSiblings = tree.getSiblings(receiptKey);
    tree.set(receiptKey, "01");
    const ackSiblings = tree.getSiblings(ackKey);
    const ack = await (0, exports.sha256)((0, lucid_1.fromText)('{"result":"AQ=="}'));
    tree.set(ackKey, ack);
    const updates = [
        (0, exports.record)((0, exports.variant)(1, packet, ack, proofHeight), [
            receiptSiblings,
            ackSiblings,
        ]),
    ];
    datum.fields[4] = datum.fields[4] + 1n;
    datum.fields[5] = await tree.getRoot();
    datum.fields[7] = [...datum.fields[7], sequence].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const acks = datum.fields[8];
    acks.set(sequence, ack);
    datum.fields[8] = new Map([...acks].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    const maximum = datum.fields[10];
    const compareHeight = (a, b) => a.fields[0] === b.fields[0]
        ? a.fields[1] > b.fields[1]
        : a.fields[0] > b.fields[0];
    if (compareHeight(proofHeight, maximum))
        datum.fields[10] = proofHeight;
    const data = JSON.parse((0, lucid_1.toText)(String(packet.fields[5])));
    const prefix = `${(0, lucid_1.toText)(String(packet.fields[1]))}/${(0, lucid_1.toText)(String(packet.fields[2]))}/`;
    addLaneBalance(datum, data.denom.startsWith(prefix)
        ? data.denom.slice(prefix.length)
        : `${port}/${channelId}/${data.denom}`, BigInt(data.amount) * (data.denom.startsWith(prefix) ? -1n : 1n));
    const fields = (0, exports.record)(...[data.denom, data.amount, data.sender, data.receiver, data.memo ?? ""]
        .map(lucid_1.fromText));
    const operation = (0, exports.variant)(5, packet, fields, proofHeight, proof, (0, exports.record)((0, exports.outRef)(input), updates), liquidity.map(exports.outRef));
    const mint = {
        [deployment.batchPolicy + (0, lucid_1.fromText)("receive")]: 1n,
    };
    let tx = lucid.newTx().readFrom([
        deployment.channel,
        deployment.connection,
        deployment.client,
        ...deployment.scripts,
    ])
        .collectFrom([input], (0, exports.encode)((0, exports.variant)(3)))
        .pay.ToContract(deployment.guardAddress, {
        kind: "inline",
        value: (0, exports.encode)(datum),
    }, input.assets)
        .validFrom(validFrom).validTo(validTo);
    if (data.denom.startsWith(prefix)) {
        tx = await releaseLiquidity(lucid, deployment, tx, mint, port, channelId, sequence, data.denom.slice(prefix.length), BigInt(data.amount), data.receiver, liquidity);
    }
    else {
        if (liquidity.length) {
            throw new Error("Voucher receive must not release escrow");
        }
        tx = voucherPayment(lucid, deployment, tx, port, channelId, sequence, `${port}/${channelId}/${data.denom}`, BigInt(data.amount), data.receiver);
    }
    await requireUnspent(lucid, [
        input,
        deployment.channel,
        deployment.connection,
        deployment.client,
    ]);
    return {
        tx: await authorizeOperation(tx, deployment, operation, mint),
        input,
    };
}
const buildPacketRejection = (lucid, deployment, packet, proofHeight, proof, liquidity, rejection, validFrom, validTo) => buildPacketCompletion(lucid, deployment, packet, proofHeight, proof, validFrom, validTo, liquidity, rejection);
exports.buildPacketRejection = buildPacketRejection;
function voucherTokenName(denom) {
    return "0014df10" +
        (0, lucid_1.toHex)((0, blake2b_1.blake2b)(new TextEncoder().encode(denom), { dkLen: 28 }));
}
function localAssetUnit(denom, deployment) {
    if (denom === (0, lucid_1.fromText)("lovelace"))
        return "lovelace";
    if (/^[0-9a-f]{56,120}$/.test(denom) && denom.length % 2 === 0)
        return denom;
    if (!deployment.voucherPolicy) {
        throw new Error("Voucher policy is required for a traced denomination");
    }
    return deployment.voucherPolicy + voucherTokenName(denom);
}
function voucherPayment(lucid, deployment, tx, port, channel, sequence, denom, amount, recipient) {
    const unit = localAssetUnit(denom, deployment);
    return tx.mintAssets({ [unit]: amount }, (0, exports.encode)((0, exports.variant)(4))).pay
        .ToAddressWithData((0, lucid_1.credentialToAddress)(lucid.config().network, {
        type: "Key",
        hash: recipient,
    }), {
        kind: "inline",
        value: (0, exports.encode)((0, exports.record)((0, lucid_1.fromText)(port), (0, lucid_1.fromText)(channel), sequence)),
    }, { [unit]: amount });
}
async function buildPacketPrune(lucid, deployment, sequence, proofHeight, proof, validFrom, validTo) {
    const { port, channelId } = channelIdentity(deployment);
    const lane = (0, packet_lanes_1.packetLane)(port, channelId, sequence, deployment.laneCount);
    const input = await lucid.utxoByUnit(deployment.statePolicy +
        (0, packet_lanes_1.packetLaneTokenName)(port, channelId, lane, deployment.laneCount));
    const datum = copy(decode(input));
    const tree = await laneTree(datum);
    if (!datum.fields[7].includes(sequence) ||
        !datum.fields[8].has(sequence))
        throw new Error("Packet has no retained receipt and acknowledgement");
    const receiptKey = `receipts/ports/${port}/channels/${channelId}/sequences/${sequence}`;
    const ackKey = `acks/ports/${port}/channels/${channelId}/sequences/${sequence}`;
    const receiptSiblings = tree.getSiblings(receiptKey);
    tree.set(receiptKey, "");
    const ackSiblings = tree.getSiblings(ackKey);
    tree.set(ackKey, "");
    datum.fields[4] = datum.fields[4] + 1n;
    datum.fields[5] = await tree.getRoot();
    datum.fields[7] = datum.fields[7].filter((value) => value !== sequence);
    datum.fields[8].delete(sequence);
    datum.fields[9] = proofHeight;
    const update = (0, exports.record)((0, exports.variant)(3, sequence, proofHeight), [
        receiptSiblings,
        ackSiblings,
    ]);
    const operation = (0, exports.variant)(7, sequence, proofHeight, proof, (0, exports.record)((0, exports.outRef)(input), [update]));
    await requireUnspent(lucid, [
        input,
        deployment.channel,
        deployment.connection,
        deployment.client,
    ]);
    const tx = lucid.newTx().readFrom([
        deployment.channel,
        deployment.connection,
        deployment.client,
        ...deployment.scripts,
    ])
        .collectFrom([input], (0, exports.encode)((0, exports.variant)(3)))
        .pay.ToContract(deployment.guardAddress, {
        kind: "inline",
        value: (0, exports.encode)(datum),
    }, input.assets)
        .validFrom(validFrom).validTo(validTo);
    return {
        tx: await authorizeOperation(tx, deployment, operation, {
            [deployment.batchPolicy + (0, lucid_1.fromText)("prune")]: 1n,
        }),
        input,
    };
}
const buildPacketTimeoutOnClose = (lucid, deployment, packet, proofHeight, proof, proofClose, liquidity, validFrom, validTo) => buildPacketCompletion(lucid, deployment, packet, proofHeight, proof, validFrom, validTo, liquidity, undefined, proofClose);
exports.buildPacketTimeoutOnClose = buildPacketTimeoutOnClose;
/** Admission is permissionless, so batch discovery must reject unfunded or malformed datums. */
function usableTransferIntent(input, deployment, validTo) {
    try {
        const datum = decode(input);
        const { port, channelId } = channelIdentity(deployment);
        if (datum.index !== 0 || datum.fields.length !== 5 ||
            datum.fields[0] !== (0, lucid_1.fromText)(port) ||
            datum.fields[1] !== (0, lucid_1.fromText)(channelId) ||
            typeof datum.fields[2] !== "string" ||
            !/^[0-9a-f]{56}$/.test(datum.fields[2]) ||
            typeof datum.fields[4] !== "bigint" ||
            datum.fields[4] <= BigInt(validTo) * 1000000n)
            return false;
        const fields = datum.fields[3];
        if (!(fields instanceof lucid_1.Constr) || fields.index !== 0 ||
            fields.fields.length !== 5 || !fields.fields.every((v) => typeof v === "string"))
            return false;
        const [denom, amount, sender, receiver, memo] = fields.fields
            .map(lucid_1.toText);
        if (!/^[1-9][0-9]*$/.test(amount) || sender !== datum.fields[2]) {
            return false;
        }
        (0, ics20_json_codec_1.stringifyIcs20PacketData)({ denom, amount, sender, receiver, memo });
        const unit = localAssetUnit(denom, deployment);
        const value = BigInt(amount);
        return (input.assets[unit] ?? 0n) >= value &&
            (input.assets.lovelace ?? 0n) > (unit === "lovelace" ? value : 0n) &&
            Object.keys(input.assets).every((asset) => asset === "lovelace" || asset === unit);
    }
    catch {
        return false;
    }
}
/** Script addresses accept arbitrary deposits. Authenticate before selecting funds. */
function selectPacketLiquidity(inputs, deployment, port, channel, denom, amount, sequence) {
    if (amount <= 0n || sequence < 1n) {
        throw new Error("Invalid liquidity request");
    }
    const candidates = inputs.flatMap((input) => {
        try {
            if (input.address !== deployment.batchAddress)
                return [];
            const datum = decode(input);
            const [p, c, d, policy, name, deposit, principal, owner] = datum.fields;
            if (datum.index !== 0 || datum.fields.length !== 8 ||
                p !== (0, lucid_1.fromText)(port) || c !== (0, lucid_1.fromText)(channel) ||
                d !== (0, lucid_1.fromText)(denom) ||
                typeof policy !== "string" || !/^([0-9a-f]{56})?$/.test(policy) ||
                typeof name !== "string" || !/^([0-9a-f]{2}){0,32}$/.test(name) ||
                (policy === "" && name !== "") || policy === deployment.batchPolicy ||
                !(deposit instanceof lucid_1.Constr) || deposit.index !== 0 ||
                deposit.fields.length !== 2 ||
                typeof deposit.fields[0] !== "string" ||
                !/^[0-9a-f]{64}$/.test(deposit.fields[0]) ||
                typeof deposit.fields[1] !== "bigint" || deposit.fields[1] < 0n ||
                deposit.fields[1] > 0xffffffffn ||
                typeof principal !== "bigint" || principal <= 0n ||
                !(owner instanceof lucid_1.Constr) || owner.index !== 0 ||
                owner.fields.length !== 2)
                return [];
            // Issuance fixes the reserve owner to the intent's enterprise key address.
            const [credential, stake] = owner.fields;
            if (!(credential instanceof lucid_1.Constr) || credential.index !== 0 ||
                credential.fields.length !== 1 ||
                typeof credential.fields[0] !== "string" ||
                !/^[0-9a-f]{56}$/.test(credential.fields[0]) ||
                !(stake instanceof lucid_1.Constr) || stake.index !== 1 ||
                stake.fields.length !== 0)
                return [];
            const unit = policy === "" ? "lovelace" : policy + name;
            if (unit !== localAssetUnit(denom, deployment))
                return [];
            const identity = deployment.batchPolicy + (0, packet_lanes_1.liquidityTokenName)(port, channel, denom, deposit.fields[0], Number(deposit.fields[1]));
            if (input.assets[identity] !== 1n ||
                (unit !== "lovelace" && input.assets[unit] !== principal) ||
                (input.assets.lovelace ?? 0n) <=
                    (unit === "lovelace" ? principal : 0n) ||
                Object.keys(input.assets).some((asset) => asset !== "lovelace" && asset !== identity && asset !== unit))
                return [];
            return [{ input, principal }];
        }
        catch {
            // Decode and interpretation errors are local to this untrusted output.
            return [];
        }
    }).sort((a, b) => a.input.txHash.localeCompare(b.input.txHash) ||
        a.input.outputIndex - b.input.outputIndex);
    const start = candidates.length
        ? Number((sequence - 1n) % BigInt(candidates.length))
        : 0;
    const selected = [];
    let total = 0n;
    for (const { input, principal } of [
        ...candidates.slice(start),
        ...candidates.slice(0, start),
    ]) {
        if (total >= amount || selected.length === 5)
            break;
        selected.push(input);
        total += principal;
    }
    if (total < amount) {
        throw new Error("Insufficient liquidity within the transaction input limit");
    }
    return selected;
}
