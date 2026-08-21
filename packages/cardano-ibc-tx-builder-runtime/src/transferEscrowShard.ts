import type { UTxO } from '@lucid-evolution/lucid';
import type { TransferEscrowShardLookup } from '@cardano-ibc/tx-builder';
import { blake2b } from '@noble/hashes/blake2b';
import { ICS23MerkleTree } from './ics23MerkleTree';

const TRANSFER_ESCROW_SHARD_NAME_DOMAIN = Buffer.from(
  'cardano-ibc/transfer-escrow-shard/v1',
  'utf8',
);
const REGISTERED_ESCROW_SHARD_VALUE = Buffer.from([1]);
const EMPTY_REGISTRY_ROOT = '00'.repeat(32);
const UINT32_MAX = 0xffff_ffff;

type TransferModuleDatum = {
  escrow_shard_registry_root: string;
};

type TransferEscrowDatum = {
  channel_id: string;
  denom: string;
};

type RegistryTree = Pick<ICS23MerkleTree, 'getRoot' | 'getSiblings' | 'set'>;

export type TransferEscrowShardRegistryDependencies = {
  transferModuleAddress: string;
  transferModuleIdentifier: string;
  shardPolicyId: string;
  findUtxosAt: (address: string) => Promise<UTxO[]>;
  encodeTransferEscrowDatum: (datum: TransferEscrowDatum) => Promise<string>;
  decodeTransferEscrowDatum: (encodedDatum: string) => Promise<TransferEscrowDatum>;
  encodeTransferModuleDatum: (datum: TransferModuleDatum) => Promise<string>;
  decodeTransferModuleDatum: (encodedDatum: string) => Promise<TransferModuleDatum>;
  createRegistryTree?: () => RegistryTree;
};

function utxoRef(utxo: Pick<UTxO, 'txHash' | 'outputIndex'>): string {
  return `${utxo.txHash}#${utxo.outputIndex}`;
}

function decodeHexBytes(value: string, label: string): Buffer {
  if (value.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`${label} must be an even-length hexadecimal string`);
  }
  return Buffer.from(value, 'hex');
}

function uint32BigEndian(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new Error(`Escrow shard framing length ${value} exceeds uint32`);
  }
  const encoded = Buffer.alloc(4);
  encoded.writeUInt32BE(value);
  return encoded;
}

export function transferEscrowShardTokenName(
  channelId: string,
  packetDenom: string,
): string {
  const channelBytes = decodeHexBytes(channelId, 'channelId');
  const denomBytes = decodeHexBytes(packetDenom, 'packetDenom');
  return Buffer.from(
    blake2b(
      Buffer.concat([
        TRANSFER_ESCROW_SHARD_NAME_DOMAIN,
        Buffer.from([0]),
        uint32BigEndian(channelBytes.length),
        channelBytes,
        uint32BigEndian(denomBytes.length),
        denomBytes,
      ]),
      { dkLen: 28 },
    ),
  ).toString('hex');
}

export function transferEscrowShardRegistryKey(tokenName: string): string {
  if (!/^[0-9a-f]{56}$/.test(tokenName)) {
    throw new Error('Transfer escrow shard token name must be 28 lowercase hexadecimal bytes');
  }
  return `escrowShards/${tokenName}`;
}

function escrowDatumDenomToken(encodedDenom: string): string {
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

function registryRoot(tree: RegistryTree): string {
  try {
    return tree.getRoot();
  } catch (error) {
    throw new Error(`Transfer escrow shard registry Merkle path collision: ${String(error)}`);
  }
}

function registrySiblings(tree: RegistryTree, key: string): string[] {
  try {
    return tree.getSiblings(key).map((sibling) => sibling.toString('hex'));
  } catch (error) {
    throw new Error(`Transfer escrow shard registry Merkle path collision: ${String(error)}`);
  }
}

export async function findTransferEscrowShard(
  dependencies: TransferEscrowShardRegistryDependencies,
  channelId: string,
  packetDenom: string,
  denomToken: string,
  requiredAmount?: bigint,
): Promise<TransferEscrowShardLookup> {
  const {
    transferModuleAddress,
    transferModuleIdentifier,
    shardPolicyId,
  } = dependencies;
  if (!/^[0-9a-f]{56}$/.test(shardPolicyId)) {
    throw new Error('Transfer escrow shard policy id must be 28 lowercase hexadecimal bytes');
  }

  const canonicalRequestedDenom = escrowDatumDenomToken(packetDenom);
  if (denomToken !== canonicalRequestedDenom) {
    throw new Error(
      `Requested asset ${denomToken} does not match escrow shard denom ${canonicalRequestedDenom}`,
    );
  }

  const encodedDatum = await dependencies.encodeTransferEscrowDatum({
    channel_id: channelId,
    denom: packetDenom,
  });
  const shardTokenName = transferEscrowShardTokenName(channelId, packetDenom);
  const shardTokenUnit = shardPolicyId + shardTokenName;
  // One plural provider query gives the root and every shard from the same view.
  const moduleUtxos = await dependencies.findUtxosAt(transferModuleAddress);

  const seenOutRefs = new Set<string>();
  for (const utxo of moduleUtxos) {
    const outRef = utxoRef(utxo);
    if (seenOutRefs.has(outRef)) {
      throw new Error(`Transfer module address scan returned duplicate output ${outRef}`);
    }
    seenOutRefs.add(outRef);
  }

  const moduleRoots = moduleUtxos.filter((utxo) =>
    Object.prototype.hasOwnProperty.call(utxo.assets ?? {}, transferModuleIdentifier)
  );
  if (
    moduleRoots.length !== 1 ||
    (moduleRoots[0].assets[transferModuleIdentifier] ?? 0n) !== 1n
  ) {
    throw new Error(`Expected exactly one transfer module root, found ${moduleRoots.length}`);
  }
  const transferModuleUtxo = moduleRoots[0];

  let onChainRoot = EMPTY_REGISTRY_ROOT;
  if (transferModuleUtxo.datum) {
    let moduleDatum: TransferModuleDatum;
    try {
      moduleDatum = await dependencies.decodeTransferModuleDatum(transferModuleUtxo.datum);
    } catch (error) {
      throw new Error(`Malformed transfer module registry datum: ${String(error)}`);
    }
    onChainRoot = moduleDatum.escrow_shard_registry_root;
  }
  if (!/^[0-9a-f]{64}$/.test(onChainRoot)) {
    throw new Error('Transfer module escrow shard registry root must be 32 lowercase hexadecimal bytes');
  }

  const tree = dependencies.createRegistryTree?.() ?? new ICS23MerkleTree();
  const canonicalShards = new Map<string, UTxO>();
  for (const candidate of moduleUtxos) {
    const shardUnits = Object.entries(candidate.assets ?? {}).filter(([unit]) =>
      unit.startsWith(shardPolicyId)
    );
    if (shardUnits.length === 0) {
      continue;
    }
    if (
      shardUnits.length !== 1 ||
      shardUnits[0][0].length !== shardPolicyId.length + 56 ||
      !/^[0-9a-f]+$/.test(shardUnits[0][0]) ||
      shardUnits[0][1] !== 1n ||
      !candidate.datum
    ) {
      throw new Error(`Malformed transfer escrow shard at ${utxoRef(candidate)}`);
    }

    let shardDatum: TransferEscrowDatum;
    let canonicalDenomToken: string;
    try {
      shardDatum = await dependencies.decodeTransferEscrowDatum(candidate.datum);
      canonicalDenomToken = escrowDatumDenomToken(shardDatum.denom);
    } catch (error) {
      throw new Error(`Malformed transfer escrow shard datum at ${utxoRef(candidate)}: ${String(error)}`);
    }
    const tokenName = transferEscrowShardTokenName(
      shardDatum.channel_id,
      shardDatum.denom,
    );
    const unit = `${shardPolicyId}${tokenName}`;
    if (
      shardUnits[0][0] !== unit ||
      Object.keys(candidate.assets).some(
        (assetUnit) =>
          assetUnit !== 'lovelace' &&
          assetUnit !== canonicalDenomToken &&
          assetUnit !== unit,
      )
    ) {
      throw new Error(`Non-canonical transfer escrow shard at ${utxoRef(candidate)}`);
    }
    if (canonicalShards.has(unit)) {
      throw new Error(`Duplicate transfer escrow shard ${unit}`);
    }
    canonicalShards.set(unit, candidate);
    tree.set(
      transferEscrowShardRegistryKey(tokenName),
      REGISTERED_ESCROW_SHARD_VALUE,
    );
  }

  if (registryRoot(tree) !== onChainRoot) {
    throw new Error('Transfer escrow shard registry root does not match live shards');
  }

  const matchingUtxo = canonicalShards.get(shardTokenUnit);
  if (matchingUtxo) {
    if (matchingUtxo.datum !== encodedDatum) {
      throw new Error(`Transfer escrow shard ${shardTokenUnit} has a non-canonical datum`);
    }
    if (
      requiredAmount !== undefined &&
      (matchingUtxo.assets[canonicalRequestedDenom] ?? 0n) < requiredAmount
    ) {
      throw new Error(`Transfer escrow shard ${shardTokenUnit} has insufficient funds`);
    }
    return {
      kind: 'existing',
      transferModuleUtxo,
      utxo: matchingUtxo,
      encodedDatum,
      shardTokenUnit,
    };
  }

  const registryKey = transferEscrowShardRegistryKey(shardTokenName);
  const siblings = registrySiblings(tree, registryKey);
  tree.set(registryKey, REGISTERED_ESCROW_SHARD_VALUE);
  const encodedUpdatedTransferModuleDatum = await dependencies.encodeTransferModuleDatum({
    escrow_shard_registry_root: registryRoot(tree),
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
