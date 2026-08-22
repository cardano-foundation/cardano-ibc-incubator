"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSFER_ESCROW_SHARD_RETIRED_VALUE = exports.TRANSFER_ESCROW_SHARD_LIVE_VALUE = void 0;
exports.transferEscrowShardTokenName = transferEscrowShardTokenName;
exports.transferEscrowShardRegistryKey = transferEscrowShardRegistryKey;
exports.transferEscrowShardChannelLiveCountKey = transferEscrowShardChannelLiveCountKey;
exports.transferEscrowShardCountValue = transferEscrowShardCountValue;
exports.findTransferEscrowShard = findTransferEscrowShard;
exports.proveTransferChannelHasNoLiveShards = proveTransferChannelHasNoLiveShards;
exports.prepareTransferEscrowShardRetirement = prepareTransferEscrowShardRetirement;
const lucid_1 = require("@lucid-evolution/lucid");
const blake2b_1 = require("@noble/hashes/blake2b");
const ics23MerkleTree_1 = require("./ics23MerkleTree");
const TRANSFER_ESCROW_SHARD_NAME_DOMAIN = Buffer.from('cardano-ibc/transfer-escrow-shard/v1', 'utf8');
exports.TRANSFER_ESCROW_SHARD_LIVE_VALUE = Buffer.from([1]);
exports.TRANSFER_ESCROW_SHARD_RETIRED_VALUE = Buffer.from([2]);
const REGISTERED_ESCROW_SHARD_VALUE = exports.TRANSFER_ESCROW_SHARD_LIVE_VALUE;
const EMPTY_REGISTRY_ROOT = '00'.repeat(32);
const UINT32_MAX = 0xffff_ffff;
function utxoRef(utxo) {
    return `${utxo.txHash}#${utxo.outputIndex}`;
}
function decodeHexBytes(value, label) {
    if (value.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(value)) {
        throw new Error(`${label} must be an even-length hexadecimal string`);
    }
    return Buffer.from(value, 'hex');
}
function uint32BigEndian(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
        throw new Error(`Escrow shard framing length ${value} exceeds uint32`);
    }
    const encoded = Buffer.alloc(4);
    encoded.writeUInt32BE(value);
    return encoded;
}
function transferEscrowShardTokenName(channelId, packetDenom) {
    const channelBytes = decodeHexBytes(channelId, 'channelId');
    const denomBytes = decodeHexBytes(packetDenom, 'packetDenom');
    return Buffer.from((0, blake2b_1.blake2b)(Buffer.concat([
        TRANSFER_ESCROW_SHARD_NAME_DOMAIN,
        Buffer.from([0]),
        uint32BigEndian(channelBytes.length),
        channelBytes,
        uint32BigEndian(denomBytes.length),
        denomBytes,
    ]), { dkLen: 28 })).toString('hex');
}
function transferEscrowShardRegistryKey(tokenName) {
    if (!/^[0-9a-f]{56}$/.test(tokenName)) {
        throw new Error('Transfer escrow shard token name must be 28 lowercase hexadecimal bytes');
    }
    return `escrowShards/${tokenName}`;
}
function transferEscrowShardChannelLiveCountKey(channelId) {
    return `escrowShardCounts/${decodeHexBytes(channelId, 'channelId').toString('hex')}`;
}
function transferEscrowShardCountValue(count) {
    if (count < 0n) {
        throw new Error('Escrow shard count cannot be negative');
    }
    return Buffer.from(lucid_1.Data.to(count, lucid_1.Data.Integer(), { canonical: true }), 'hex');
}
function escrowDatumDenomToken(encodedDenom) {
    const packetDenomBytes = decodeHexBytes(encodedDenom, 'transfer escrow shard datum denom');
    const packetDenom = packetDenomBytes.toString('utf8');
    if (!Buffer.from(packetDenom, 'utf8').equals(packetDenomBytes)) {
        throw new Error('Transfer escrow shard datum denom is not canonical UTF-8');
    }
    if (packetDenom.toLowerCase() === Buffer.from('lovelace').toString('hex')) {
        return 'lovelace';
    }
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(packetDenom)) {
        throw new Error('Transfer escrow shard datum contains a non-hex denomination');
    }
    if (packetDenom.length < 56 || packetDenom.length > 120) {
        throw new Error('Transfer escrow shard datum contains an invalid Cardano asset unit');
    }
    return packetDenom.toLowerCase();
}
function registryRoot(tree) {
    try {
        return tree.getRoot();
    }
    catch (error) {
        throw new Error(`Transfer escrow shard registry Merkle path collision: ${String(error)}`);
    }
}
function registrySiblings(tree, key) {
    try {
        return tree.getSiblings(key).map((sibling) => sibling.toString('hex'));
    }
    catch (error) {
        throw new Error(`Transfer escrow shard registry Merkle path collision: ${String(error)}`);
    }
}
async function findTransferEscrowShard(dependencies, channelId, packetDenom, denomToken, principalDelta, inspectionOnly = false) {
    const { transferModuleAddress, transferModuleIdentifier, shardPolicyId, } = dependencies;
    if (!/^[0-9a-f]{56}$/.test(shardPolicyId)) {
        throw new Error('Transfer escrow shard policy id must be 28 lowercase hexadecimal bytes');
    }
    const canonicalRequestedDenom = escrowDatumDenomToken(packetDenom);
    if (denomToken !== canonicalRequestedDenom) {
        throw new Error(`Requested asset ${denomToken} does not match escrow shard denom ${canonicalRequestedDenom}`);
    }
    const shardTokenName = transferEscrowShardTokenName(channelId, packetDenom);
    const shardTokenUnit = shardPolicyId + shardTokenName;
    // One plural provider query gives the root and every shard from the same view.
    const moduleUtxos = await dependencies.findUtxosAt(transferModuleAddress);
    const seenOutRefs = new Set();
    for (const utxo of moduleUtxos) {
        const outRef = utxoRef(utxo);
        if (seenOutRefs.has(outRef)) {
            throw new Error(`Transfer module address scan returned duplicate output ${outRef}`);
        }
        seenOutRefs.add(outRef);
    }
    const moduleRoots = moduleUtxos.filter((utxo) => Object.prototype.hasOwnProperty.call(utxo.assets ?? {}, transferModuleIdentifier));
    if (moduleRoots.length !== 1 ||
        (moduleRoots[0].assets[transferModuleIdentifier] ?? 0n) !== 1n) {
        throw new Error(`Expected exactly one transfer module root, found ${moduleRoots.length}`);
    }
    const transferModuleUtxo = moduleRoots[0];
    let moduleDatum = {
        escrow_shard_registry_root: EMPTY_REGISTRY_ROOT,
        live_escrow_shard_count: 0n,
        voucher_supply: 0n,
    };
    if (transferModuleUtxo.datum) {
        try {
            moduleDatum = await dependencies.decodeTransferModuleDatum(transferModuleUtxo.datum);
        }
        catch (error) {
            throw new Error(`Malformed transfer module registry datum: ${String(error)}`);
        }
    }
    const onChainRoot = moduleDatum.escrow_shard_registry_root;
    if (!/^[0-9a-f]{64}$/.test(onChainRoot)) {
        throw new Error('Transfer module escrow shard registry root must be 32 lowercase hexadecimal bytes');
    }
    const tree = dependencies.createRegistryTree?.() ?? new ics23MerkleTree_1.ICS23MerkleTree();
    const canonicalShards = new Map();
    const channelLiveCounts = new Map();
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
            throw new Error(`Malformed transfer escrow shard at ${utxoRef(candidate)}`);
        }
        let shardDatum;
        let canonicalDenomToken;
        try {
            shardDatum = await dependencies.decodeTransferEscrowDatum(candidate.datum);
            canonicalDenomToken = escrowDatumDenomToken(shardDatum.denom);
        }
        catch (error) {
            throw new Error(`Malformed transfer escrow shard datum at ${utxoRef(candidate)}: ${String(error)}`);
        }
        const tokenName = transferEscrowShardTokenName(shardDatum.channel_id, shardDatum.denom);
        const unit = `${shardPolicyId}${tokenName}`;
        const physicalPrincipal = candidate.assets[canonicalDenomToken] ?? 0n;
        if (shardUnits[0][0] !== unit ||
            shardDatum.escrowed_amount < 0n ||
            (canonicalDenomToken === 'lovelace'
                ? physicalPrincipal < shardDatum.escrowed_amount
                : physicalPrincipal !== shardDatum.escrowed_amount) ||
            Object.keys(candidate.assets).some((assetUnit) => assetUnit !== 'lovelace' &&
                assetUnit !== canonicalDenomToken &&
                assetUnit !== unit)) {
            throw new Error(`Non-canonical transfer escrow shard at ${utxoRef(candidate)}`);
        }
        if (canonicalShards.has(unit)) {
            throw new Error(`Duplicate transfer escrow shard ${unit}`);
        }
        canonicalShards.set(unit, {
            utxo: candidate,
            datum: shardDatum,
            denomToken: canonicalDenomToken,
        });
        channelLiveCounts.set(shardDatum.channel_id, (channelLiveCounts.get(shardDatum.channel_id) ?? 0n) + 1n);
        tree.set(transferEscrowShardRegistryKey(tokenName), REGISTERED_ESCROW_SHARD_VALUE);
    }
    for (const [liveChannelId, liveCount] of channelLiveCounts) {
        tree.set(transferEscrowShardChannelLiveCountKey(liveChannelId), transferEscrowShardCountValue(liveCount));
    }
    // Retired shard NFTs no longer appear in an unspent address query, but their
    // permanent #02 marker remains in the committed module root. A cold rebuild
    // therefore requires Kupo's retained spent history from deployment onward.
    const history = await dependencies.findLatestShardHistory(transferModuleAddress, shardPolicyId);
    const liveHistoryUnits = new Set();
    const retiredShardUnits = new Set();
    for (const historicalShard of history) {
        let datum;
        let historicalDenomToken;
        try {
            if (!historicalShard.datum) {
                throw new Error('missing inline datum');
            }
            datum = await dependencies.decodeTransferEscrowDatum(historicalShard.datum);
            historicalDenomToken = escrowDatumDenomToken(datum.denom);
        }
        catch (error) {
            throw new Error(`Malformed historical transfer escrow shard at ${utxoRef(historicalShard)}: ${String(error)}`);
        }
        const tokenName = transferEscrowShardTokenName(datum.channel_id, datum.denom);
        const canonicalUnit = shardPolicyId + tokenName;
        const physicalPrincipal = historicalShard.assets[historicalDenomToken] ?? 0n;
        if (historicalShard.shardTokenUnit !== canonicalUnit ||
            datum.escrowed_amount < 0n ||
            (historicalDenomToken === 'lovelace'
                ? physicalPrincipal < datum.escrowed_amount
                : physicalPrincipal !== datum.escrowed_amount) ||
            Object.keys(historicalShard.assets).some((assetUnit) => assetUnit !== 'lovelace' &&
                assetUnit !== historicalDenomToken &&
                assetUnit !== canonicalUnit)) {
            throw new Error(`Non-canonical historical transfer escrow shard at ${utxoRef(historicalShard)}`);
        }
        const key = transferEscrowShardRegistryKey(tokenName);
        if (!historicalShard.spent) {
            const liveShard = canonicalShards.get(canonicalUnit);
            if (!liveShard || utxoRef(liveShard.utxo) !== utxoRef(historicalShard)) {
                throw new Error(`Kupo escrow history is not aligned with live shard ${canonicalUnit}`);
            }
            liveHistoryUnits.add(canonicalUnit);
            tree.set(key, exports.TRANSFER_ESCROW_SHARD_LIVE_VALUE);
        }
        else {
            if (datum.escrowed_amount !== 0n || canonicalShards.has(canonicalUnit)) {
                throw new Error(`Retired transfer escrow shard ${canonicalUnit} must have zero principal and no live output`);
            }
            retiredShardUnits.add(canonicalUnit);
            tree.set(key, exports.TRANSFER_ESCROW_SHARD_RETIRED_VALUE);
        }
    }
    if (liveHistoryUnits.size !== canonicalShards.size) {
        throw new Error('Kupo escrow history is incomplete for the live transfer shard set');
    }
    if (moduleDatum.live_escrow_shard_count !== BigInt(canonicalShards.size) ||
        registryRoot(tree) !== onChainRoot) {
        throw new Error('Transfer escrow shard registry root does not match live shards');
    }
    if (inspectionOnly) {
        return {
            kind: 'registry',
            transferModuleUtxo,
            moduleDatum,
            shardPolicyId,
            tree,
            canonicalShards,
            channelLiveCounts,
            retiredShardUnits,
        };
    }
    const matchingShard = canonicalShards.get(shardTokenUnit);
    if (matchingShard) {
        const updatedPrincipal = matchingShard.datum.escrowed_amount + (principalDelta ?? 0n);
        if (updatedPrincipal < 0n) {
            throw new Error(`Transfer escrow shard ${shardTokenUnit} has insufficient funds`);
        }
        const encodedDatum = await dependencies.encodeTransferEscrowDatum({
            ...matchingShard.datum,
            escrowed_amount: updatedPrincipal,
        });
        return {
            kind: 'existing',
            transferModuleUtxo,
            utxo: matchingShard.utxo,
            encodedDatum,
            shardTokenUnit,
        };
    }
    if (retiredShardUnits.has(shardTokenUnit)) {
        throw new Error(`Transfer escrow shard ${shardTokenUnit} is permanently retired`);
    }
    if (principalDelta === undefined || principalDelta <= 0n) {
        throw new Error('A positive transfer amount is required to create an escrow shard');
    }
    const registryKey = transferEscrowShardRegistryKey(shardTokenName);
    const siblings = registrySiblings(tree, registryKey);
    tree.set(registryKey, REGISTERED_ESCROW_SHARD_VALUE);
    const oldChannelLiveEscrowShardCount = channelLiveCounts.get(channelId) ?? 0n;
    const channelCountKey = transferEscrowShardChannelLiveCountKey(channelId);
    const channelLiveEscrowShardCountSiblings = registrySiblings(tree, channelCountKey);
    tree.set(channelCountKey, transferEscrowShardCountValue(oldChannelLiveEscrowShardCount + 1n));
    const encodedDatum = await dependencies.encodeTransferEscrowDatum({
        channel_id: channelId,
        denom: packetDenom,
        escrowed_amount: principalDelta,
    });
    const encodedUpdatedTransferModuleDatum = await dependencies.encodeTransferModuleDatum({
        escrow_shard_registry_root: registryRoot(tree),
        live_escrow_shard_count: moduleDatum.live_escrow_shard_count + 1n,
        voucher_supply: moduleDatum.voucher_supply,
    });
    return {
        kind: 'missing',
        transferModuleUtxo,
        encodedDatum,
        shardTokenUnit,
        registrySiblings: siblings,
        oldChannelLiveEscrowShardCount,
        channelLiveEscrowShardCountSiblings,
        encodedUpdatedTransferModuleDatum,
    };
}
async function inspectTransferEscrowShardRegistry(dependencies, channelId) {
    const syntheticDenomToken = '0'.repeat(56);
    const syntheticPacketDenom = Buffer.from(syntheticDenomToken, 'utf8').toString('hex');
    return findTransferEscrowShard(dependencies, channelId, syntheticPacketDenom, syntheticDenomToken, undefined, true);
}
async function proveTransferChannelHasNoLiveShards(dependencies, channelId) {
    const snapshot = await inspectTransferEscrowShardRegistry(dependencies, channelId);
    if ((snapshot.channelLiveCounts.get(channelId) ?? 0n) !== 0n) {
        throw new Error('Transfer channel still owns live escrow shards');
    }
    return {
        transferModuleUtxo: snapshot.transferModuleUtxo,
        channelLiveEscrowShardCountSiblings: registrySiblings(snapshot.tree, transferEscrowShardChannelLiveCountKey(channelId)),
    };
}
async function prepareTransferEscrowShardRetirement(dependencies, channelId, packetDenom) {
    const snapshot = await inspectTransferEscrowShardRegistry(dependencies, channelId);
    const tokenName = transferEscrowShardTokenName(channelId, packetDenom);
    const shardTokenUnit = snapshot.shardPolicyId + tokenName;
    const shard = snapshot.canonicalShards.get(shardTokenUnit);
    if (!shard) {
        if (snapshot.retiredShardUnits.has(shardTokenUnit)) {
            throw new Error(`Transfer escrow shard ${shardTokenUnit} is already retired`);
        }
        throw new Error(`Transfer escrow shard ${shardTokenUnit} is not live`);
    }
    if (shard.datum.channel_id !== channelId ||
        shard.datum.denom !== packetDenom ||
        shard.datum.escrowed_amount !== 0n) {
        throw new Error(`Transfer escrow shard ${shardTokenUnit} is not empty and reclaimable`);
    }
    const oldChannelLiveEscrowShardCount = snapshot.channelLiveCounts.get(channelId) ?? 0n;
    if (oldChannelLiveEscrowShardCount <= 0n ||
        snapshot.moduleDatum.live_escrow_shard_count <= 0n) {
        throw new Error('Transfer escrow shard counts cannot be decremented below zero');
    }
    const registryKey = transferEscrowShardRegistryKey(tokenName);
    const registryWitness = registrySiblings(snapshot.tree, registryKey);
    snapshot.tree.set(registryKey, exports.TRANSFER_ESCROW_SHARD_RETIRED_VALUE);
    const countKey = transferEscrowShardChannelLiveCountKey(channelId);
    const countWitness = registrySiblings(snapshot.tree, countKey);
    const newChannelCount = oldChannelLiveEscrowShardCount - 1n;
    snapshot.tree.set(countKey, newChannelCount === 0n
        ? Buffer.alloc(0)
        : transferEscrowShardCountValue(newChannelCount));
    return {
        transferModuleUtxo: snapshot.transferModuleUtxo,
        shardUtxo: shard.utxo,
        shardTokenUnit,
        registrySiblings: registryWitness,
        oldChannelLiveEscrowShardCount,
        channelLiveEscrowShardCountSiblings: countWitness,
        encodedUpdatedTransferModuleDatum: await dependencies.encodeTransferModuleDatum({
            escrow_shard_registry_root: registryRoot(snapshot.tree),
            live_escrow_shard_count: snapshot.moduleDatum.live_escrow_shard_count - 1n,
            voucher_supply: snapshot.moduleDatum.voucher_supply,
        }),
        encodedShardDatum: shard.utxo.datum,
    };
}
