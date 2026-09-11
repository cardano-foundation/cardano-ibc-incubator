"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsensusHistoryCommitment = exports.CONSENSUS_HISTORY_KEY_PREFIX = exports.EMPTY_CONSENSUS_HISTORY_ROOT = void 0;
exports.recordToConstr = recordToConstr;
exports.recordFromConstr = recordFromConstr;
exports.encodeConsensusHistoryRecord = encodeConsensusHistoryRecord;
exports.decodeConsensusHistoryRecord = decodeConsensusHistoryRecord;
exports.consensusHistoryKey = consensusHistoryKey;
const lucid_1 = require("@lucid-evolution/lucid");
const node_crypto_1 = require("node:crypto");
const node_buffer_1 = require("node:buffer");
const ics23MerkleTree_ts_1 = require("./ics23MerkleTree.js");
// History storage only: this does not verify Tendermint headers or authorize
// client transitions. The on-chain validator must authenticate every insertion.
exports.EMPTY_CONSENSUS_HISTORY_ROOT = "00".repeat(32);
exports.CONSENSUS_HISTORY_KEY_PREFIX = "internal/consensus-history/v1/";
function hex(value, label) {
    if (typeof value !== "string" || !/^(?:[0-9a-fA-F]{2})*$/.test(value)) {
        throw new Error(`${label} must be byte hex`);
    }
    return value.toLowerCase();
}
function integer(value, label) {
    if (typeof value !== "bigint" || value < 0n) {
        throw new Error(`${label} must be a nonnegative bigint`);
    }
    return value;
}
function fields(value, count, label) {
    if (!(value instanceof lucid_1.Constr) || value.index !== 0 ||
        value.fields.length !== count) {
        throw new Error(`${label} must be constructor 0 with ${count} fields`);
    }
    return value.fields;
}
function tokenToConstr(token) {
    return new lucid_1.Constr(0, [
        hex(token.policyId, "client policy"),
        hex(token.name, "client name"),
    ]);
}
function heightToConstr(height) {
    return new lucid_1.Constr(0, [
        integer(height.revisionNumber, "revision number"),
        integer(height.revisionHeight, "revision height"),
    ]);
}
function recordToConstr(record) {
    return new lucid_1.Constr(0, [
        tokenToConstr(record.clientToken),
        heightToConstr(record.height),
        new lucid_1.Constr(0, [
            integer(record.consensusState.timestamp, "consensus timestamp"),
            hex(record.consensusState.nextValidatorsHash, "next validators hash"),
            new lucid_1.Constr(0, [hex(record.consensusState.root, "consensus root")]),
        ]),
        integer(record.processedTime, "processed time"),
        integer(record.processedHeight, "processed height"),
    ]);
}
function recordFromConstr(value) {
    const [token, height, consensus, processedTime, processedHeight] = fields(value, 5, "record");
    const [policyId, name] = fields(token, 2, "client token");
    const [revisionNumber, revisionHeight] = fields(height, 2, "height");
    const [timestamp, nextValidatorsHash, root] = fields(consensus, 3, "consensus state");
    const [rootHash] = fields(root, 1, "consensus root");
    return {
        clientToken: {
            policyId: hex(policyId, "client policy"),
            name: hex(name, "client name"),
        },
        height: {
            revisionNumber: integer(revisionNumber, "revision number"),
            revisionHeight: integer(revisionHeight, "revision height"),
        },
        consensusState: {
            timestamp: integer(timestamp, "consensus timestamp"),
            nextValidatorsHash: hex(nextValidatorsHash, "next validators hash"),
            root: hex(rootHash, "consensus root"),
        },
        processedTime: integer(processedTime, "processed time"),
        processedHeight: integer(processedHeight, "processed height"),
    };
}
function encodeConsensusHistoryRecord(record) {
    // Fresh constructors + default Plutus encoding match Aiken cbor.serialise.
    // canonical:true instead produces definite arrays and changes the commitment.
    return lucid_1.Data.to(recordToConstr(record));
}
function decodeConsensusHistoryRecord(cbor) {
    return recordFromConstr(lucid_1.Data.from(hex(cbor, "record CBOR")));
}
function consensusHistoryKey(clientToken, height) {
    return exports.CONSENSUS_HISTORY_KEY_PREFIX + lucid_1.Data.to(new lucid_1.Constr(0, [tokenToConstr(clientToken), heightToConstr(height)]));
}
function expectedRootHex(value) {
    const root = hex(value, "independently expected root");
    if (root.length !== 64) {
        throw new Error("independently expected root must be 32 bytes");
    }
    return root;
}
class ConsensusHistoryCommitment {
    // Only immutable encoded strings are retained. Every returned record, witness,
    // and snapshot is detached from these authoritative copies.
    #records = new Map();
    #paths = new Map();
    #view;
    get size() {
        return this.#records.size;
    }
    append(record) {
        const encoded = encodeConsensusHistoryRecord(record);
        const key = consensusHistoryKey(record.clientToken, record.height);
        if (this.#records.has(key)) {
            throw new Error(`history record already exists: ${key}`);
        }
        // DeploymentIbcTree itself does not reject two keys mapped to one 64-bit
        // path. Fail closed here instead of silently losing an earlier record.
        const path = (0, node_crypto_1.createHash)("sha256").update(key, "utf8").digest("hex").slice(0, 16);
        if (this.#paths.has(path)) {
            throw new Error(`history key path collision: ${path}`);
        }
        this.#records.set(key, encoded);
        this.#paths.set(path, key);
        this.#view = undefined;
    }
    get(token, height) {
        const encoded = this.#records.get(consensusHistoryKey(token, height));
        return encoded === undefined
            ? undefined
            : decodeConsensusHistoryRecord(encoded);
    }
    async getRoot() {
        return (await this.currentView().ready).getRoot();
    }
    async witness(token, height) {
        const view = this.currentView();
        const key = consensusHistoryKey(token, height);
        const value = view.records.get(key);
        if (value === undefined) {
            throw new Error(`history record not found: ${key}`);
        }
        return await this.makeWitness(view, key, value);
    }
    async insertionWitness(record) {
        const value = encodeConsensusHistoryRecord(record);
        const key = consensusHistoryKey(record.clientToken, record.height);
        const path = (0, node_crypto_1.createHash)("sha256").update(key, "utf8").digest("hex").slice(0, 16);
        if (this.#records.has(key)) {
            throw new Error(`history record already exists: ${key}`);
        }
        if (this.#paths.has(path)) {
            throw new Error(`history key path collision: ${path}`);
        }
        // The root/siblings prove the OLD EMPTY leaf; value is the candidate value.
        // Generating this witness does not mutate the tree or authorize the update.
        return await this.makeWitness(this.currentView(), key, value);
    }
    async snapshot() {
        const view = this.currentView();
        const tree = await view.ready;
        return {
            version: 1,
            root: await tree.getRoot(),
            records: [...view.records.values()],
        };
    }
    static async replay(records, expectedRoot) {
        const expected = expectedRootHex(expectedRoot);
        const history = new ConsensusHistoryCommitment();
        for (const record of records)
            history.append(record);
        if (await history.getRoot() !== expected) {
            throw new Error("replayed history does not match independently expected root");
        }
        return history;
    }
    static async fromSnapshot(snapshot, expectedRoot) {
        const expected = expectedRootHex(expectedRoot);
        if (!snapshot || typeof snapshot !== "object") {
            throw new Error("invalid history snapshot");
        }
        const candidate = snapshot;
        if (candidate.version !== 1 || !Array.isArray(candidate.records)) {
            throw new Error("invalid history snapshot version or records");
        }
        if (expectedRootHex(candidate.root) !== expected) {
            throw new Error("snapshot root does not match independently expected root");
        }
        const records = candidate.records.map((value) => {
            const record = decodeConsensusHistoryRecord(value);
            if (encodeConsensusHistoryRecord(record) !== value) {
                throw new Error("snapshot record is not normalized CBOR");
            }
            return record;
        });
        return await this.replay(records, expected);
    }
    currentView() {
        if (!this.#view) {
            // A rebuild reads an immutable capture, so appending while an async proof
            // is being generated cannot mix roots, siblings, or record generations.
            const records = new Map(this.#records);
            const tree = new ics23MerkleTree_ts_1.ICS23MerkleTree();
            for (const [key, value] of records) {
                tree.set(key, node_buffer_1.Buffer.from(value, "hex"));
            }
            this.#view = { records, ready: Promise.resolve(tree) };
        }
        return this.#view;
    }
    async makeWitness(view, key, value) {
        const tree = await view.ready;
        return {
            root: await tree.getRoot(),
            key,
            value,
            record: decodeConsensusHistoryRecord(value),
            siblings: tree.getSiblings(key).map((sibling) => sibling.toString("hex")),
        };
    }
}
exports.ConsensusHistoryCommitment = ConsensusHistoryCommitment;
