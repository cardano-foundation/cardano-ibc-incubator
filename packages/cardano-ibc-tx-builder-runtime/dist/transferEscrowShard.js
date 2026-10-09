"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSFER_ESCROW_SHARD_REGISTERED_VALUE = exports.transferEscrowShardTokenName = exports.transferEscrowShardRegistryKey = exports.escrowDenomTokenFromPacketDenom = void 0;
exports.getTransferModuleRootFromAddressScan = getTransferModuleRootFromAddressScan;
exports.findTransferEscrowShard = findTransferEscrowShard;
const ics23MerkleTree_1 = require("./ics23MerkleTree");
const transferEscrowIdentity_1 = require("./transferEscrowIdentity");
var transferEscrowIdentity_2 = require("./transferEscrowIdentity");
Object.defineProperty(exports, "escrowDenomTokenFromPacketDenom", { enumerable: true, get: function () { return transferEscrowIdentity_2.escrowDenomTokenFromPacketDenom; } });
Object.defineProperty(exports, "transferEscrowShardRegistryKey", { enumerable: true, get: function () { return transferEscrowIdentity_2.transferEscrowShardRegistryKey; } });
Object.defineProperty(exports, "transferEscrowShardTokenName", { enumerable: true, get: function () { return transferEscrowIdentity_2.transferEscrowShardTokenName; } });
exports.TRANSFER_ESCROW_SHARD_REGISTERED_VALUE = Buffer.from([1]);
const EMPTY_REGISTRY_ROOT = '00'.repeat(32);
const defaultError = (message) => new Error(message);
function utxoRef(utxo) {
    return `${utxo.txHash}#${utxo.outputIndex}`;
}
function getTransferModuleRootFromAddressScan(utxos, transferModuleIdentifier, failedPrecondition = defaultError) {
    const holders = utxos.filter((utxo) => Object.prototype.hasOwnProperty.call(utxo.assets ?? {}, transferModuleIdentifier));
    if (holders.length !== 1 ||
        (holders[0].assets?.[transferModuleIdentifier] ?? 0n) !== 1n) {
        throw failedPrecondition(`Expected one canonical transfer-module registry root at the transfer module address, found ${holders.length}`);
    }
    return holders[0];
}
function registryRoot(tree, failedPrecondition) {
    try {
        return tree.getRoot();
    }
    catch (error) {
        throw failedPrecondition(`Transfer escrow shard registry Merkle path collision: ${String(error)}`);
    }
}
function registrySiblings(tree, key, failedPrecondition) {
    try {
        return tree.getSiblings(key).map((sibling) => sibling.toString('hex'));
    }
    catch (error) {
        throw failedPrecondition(`Transfer escrow shard registry Merkle path collision: ${String(error)}`);
    }
}
async function findTransferEscrowShard(dependencies, channelId, packetDenom, denomToken, requiredAmount, balanceDelta = 0n) {
    const { transferModuleAddress, transferModuleIdentifier, shardPolicyId, } = dependencies;
    const invalidArgument = dependencies.invalidArgument ?? defaultError;
    const failedPrecondition = dependencies.failedPrecondition ?? defaultError;
    if (!/^[0-9a-f]{56}$/.test(shardPolicyId)) {
        throw failedPrecondition('Transfer escrow shard policy id must be 28 lowercase hexadecimal bytes');
    }
    const canonicalRequestedDenom = (0, transferEscrowIdentity_1.escrowDenomTokenFromPacketDenom)(packetDenom);
    if (denomToken.trim().toLowerCase() !== canonicalRequestedDenom) {
        throw invalidArgument(`Requested asset ${denomToken} does not match escrow shard denom ${canonicalRequestedDenom}`);
    }
    const encodedDatum = await dependencies.encodeTransferEscrowDatum({
        channel_id: channelId,
        denom: packetDenom,
        escrowed_amount: balanceDelta,
    });
    const shardTokenName = (0, transferEscrowIdentity_1.transferEscrowShardTokenName)(channelId, packetDenom);
    const shardTokenUnit = shardPolicyId + shardTokenName;
    // One plural provider query gives the root and every shard from the same view.
    const moduleUtxos = await dependencies.findUtxosAt(transferModuleAddress);
    const seenOutRefs = new Set();
    for (const utxo of moduleUtxos) {
        const outRef = utxoRef(utxo);
        if (seenOutRefs.has(outRef)) {
            throw failedPrecondition(`Transfer module address scan returned duplicate output ${outRef}`);
        }
        seenOutRefs.add(outRef);
    }
    const transferModuleUtxo = getTransferModuleRootFromAddressScan(moduleUtxos, transferModuleIdentifier, failedPrecondition);
    let moduleDatum = {
        escrow_shard_registry_root: EMPTY_REGISTRY_ROOT,
        outstanding_voucher_obligation: 0n,
    };
    if (transferModuleUtxo.datum) {
        try {
            moduleDatum = await dependencies.decodeTransferModuleDatum(transferModuleUtxo.datum);
        }
        catch (error) {
            throw failedPrecondition(`Malformed transfer-module registry datum: ${String(error)}`);
        }
    }
    const onChainRoot = moduleDatum.escrow_shard_registry_root;
    if (!/^[0-9a-f]{64}$/.test(onChainRoot)) {
        throw failedPrecondition('Transfer-module escrow shard registry root must be 32 lowercase hexadecimal bytes');
    }
    const tree = dependencies.createRegistryTree?.() ?? new ics23MerkleTree_1.ICS23MerkleTree();
    const canonicalShards = new Map();
    for (const candidate of moduleUtxos) {
        const shardUnits = Object.entries(candidate.assets ?? {}).filter(([unit]) => unit.startsWith(shardPolicyId));
        if (shardUnits.length === 0) {
            continue;
        }
        if (shardUnits.length !== 1 ||
            shardUnits[0][0].length !== shardPolicyId.length + 56 ||
            !/^[0-9a-f]+$/.test(shardUnits[0][0]) ||
            shardUnits[0][1] !== 1n ||
            !candidate.datum) {
            throw failedPrecondition(`Malformed escrow shard holder ${utxoRef(candidate)}`);
        }
        let shardDatum;
        let canonicalDenomToken;
        let tokenName;
        let canonicalDatum;
        try {
            shardDatum = await dependencies.decodeTransferEscrowDatum(candidate.datum);
            canonicalDenomToken = (0, transferEscrowIdentity_1.escrowDenomTokenFromPacketDenom)(shardDatum.denom);
            tokenName = (0, transferEscrowIdentity_1.transferEscrowShardTokenName)(shardDatum.channel_id, shardDatum.denom);
            if (typeof shardDatum.escrowed_amount !== 'bigint' || shardDatum.escrowed_amount < 0n ||
                (candidate.assets[canonicalDenomToken] ?? 0n) < shardDatum.escrowed_amount) {
                throw new Error('Escrow deposit balance is missing, negative, or exceeds its funds');
            }
            canonicalDatum = await dependencies.encodeTransferEscrowDatum(shardDatum);
        }
        catch (error) {
            throw failedPrecondition(`Malformed escrow shard datum at ${utxoRef(candidate)}: ${String(error)}`);
        }
        const unit = `${shardPolicyId}${tokenName}`;
        if (shardUnits[0][0] !== unit ||
            candidate.datum !== canonicalDatum ||
            Object.keys(candidate.assets).some((assetUnit) => assetUnit !== 'lovelace' &&
                assetUnit !== canonicalDenomToken &&
                assetUnit !== unit)) {
            throw failedPrecondition(`Non-canonical escrow shard holder ${utxoRef(candidate)}`);
        }
        if (canonicalShards.has(unit)) {
            throw failedPrecondition(`Duplicate escrow shard holders found for ${unit}`);
        }
        canonicalShards.set(unit, candidate);
        tree.set((0, transferEscrowIdentity_1.transferEscrowShardRegistryKey)(tokenName), exports.TRANSFER_ESCROW_SHARD_REGISTERED_VALUE);
    }
    const reconstructedRoot = registryRoot(tree, failedPrecondition);
    if (reconstructedRoot !== onChainRoot) {
        throw failedPrecondition(`Transfer escrow shard registry root mismatch: datum=${onChainRoot}, reconstructed=${reconstructedRoot}`);
    }
    const registryKey = (0, transferEscrowIdentity_1.transferEscrowShardRegistryKey)(shardTokenName);
    const siblings = registrySiblings(tree, registryKey, failedPrecondition);
    const matchingUtxo = canonicalShards.get(shardTokenUnit);
    if (matchingUtxo) {
        const currentDatum = await dependencies.decodeTransferEscrowDatum(matchingUtxo.datum);
        const remainingAmount = currentDatum.escrowed_amount + balanceDelta;
        if (remainingAmount < 0n) {
            throw invalidArgument(`Insufficient escrowed amount for ${canonicalRequestedDenom}`);
        }
        const updatedDatum = await dependencies.encodeTransferEscrowDatum({
            ...currentDatum, escrowed_amount: remainingAmount,
        });
        if (requiredAmount !== undefined &&
            currentDatum.escrowed_amount < requiredAmount) {
            throw invalidArgument(`Insufficient escrowed amount for ${canonicalRequestedDenom}`);
        }
        return {
            kind: 'existing',
            transferModuleUtxo,
            utxo: matchingUtxo,
            encodedDatum: updatedDatum,
            shardTokenUnit,
            registrySiblings: siblings,
        };
    }
    if (balanceDelta < 0n) {
        throw invalidArgument('Cannot withdraw from a missing escrow shard');
    }
    tree.set(registryKey, exports.TRANSFER_ESCROW_SHARD_REGISTERED_VALUE);
    const encodedUpdatedTransferModuleDatum = await dependencies.encodeTransferModuleDatum({
        ...moduleDatum,
        escrow_shard_registry_root: registryRoot(tree, failedPrecondition),
    });
    return {
        kind: 'missing',
        transferModuleUtxo,
        encodedDatum,
        shardTokenUnit,
        registrySiblings: siblings,
        encodedUpdatedTransferModuleDatum,
    };
}
