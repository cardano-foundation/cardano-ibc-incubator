import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UTxO } from '@lucid-evolution/lucid';
import { ICS23MerkleTree } from './ics23MerkleTree';
import {
  findTransferEscrowShard,
  transferEscrowShardRegistryKey,
  transferEscrowShardTokenName,
  type TransferEscrowShardRegistryDependencies,
} from './transferEscrowShard';

const TRANSFER_MODULE_ADDRESS = 'addr_test1_transfer_module';
const TRANSFER_MODULE_IDENTIFIER = `${'cd'.repeat(28)}01`;
const SHARD_POLICY_ID = 'ab'.repeat(28);
const CHANNEL_ID = Buffer.from('channel-7').toString('hex');
const DENOM_TOKEN = `${'ef'.repeat(28)}01`;
const PACKET_DENOM = Buffer.from(DENOM_TOKEN).toString('hex');
const SHARD_TOKEN_NAME = transferEscrowShardTokenName(CHANNEL_ID, PACKET_DENOM);
const SHARD_TOKEN_UNIT = SHARD_POLICY_ID + SHARD_TOKEN_NAME;

function utxo(
  txHash: string,
  outputIndex: number,
  assets: Record<string, bigint>,
  datum?: string,
): UTxO {
  return {
    txHash,
    outputIndex,
    address: TRANSFER_MODULE_ADDRESS,
    assets,
    datum,
    datumHash: undefined,
    scriptRef: undefined,
  } as UTxO;
}

function encodedEscrowDatum(channelId: string, denom: string): string {
  return `escrow:${channelId}:${denom}`;
}

function encodedModuleDatum(root: string): string {
  return `module:${root}`;
}

function moduleRoot(root?: string): UTxO {
  return utxo(
    'module-root',
    0,
    { lovelace: 5_000_000n, [TRANSFER_MODULE_IDENTIFIER]: 1n },
    root === undefined ? undefined : encodedModuleDatum(root),
  );
}

function shard(txHash = 'shard', outputIndex = 0): UTxO {
  return utxo(
    txHash,
    outputIndex,
    { lovelace: 2_000_000n, [SHARD_TOKEN_UNIT]: 1n },
    encodedEscrowDatum(CHANNEL_ID, PACKET_DENOM),
  );
}

function existingRegistryRoot(): string {
  const tree = new ICS23MerkleTree();
  tree.set(
    transferEscrowShardRegistryKey(SHARD_TOKEN_NAME),
    Buffer.from([1]),
  );
  return tree.getRoot();
}

function dependencies(
  findUtxosAt: TransferEscrowShardRegistryDependencies['findUtxosAt'],
  overrides: Partial<TransferEscrowShardRegistryDependencies> = {},
): TransferEscrowShardRegistryDependencies {
  return {
    transferModuleAddress: TRANSFER_MODULE_ADDRESS,
    transferModuleIdentifier: TRANSFER_MODULE_IDENTIFIER,
    shardPolicyId: SHARD_POLICY_ID,
    findUtxosAt,
    encodeTransferEscrowDatum: async (datum) =>
      encodedEscrowDatum(datum.channel_id, datum.denom),
    decodeTransferEscrowDatum: async (datum) => {
      const [prefix, channel_id, denom] = datum.split(':');
      if (prefix !== 'escrow' || !channel_id || !denom) {
        throw new Error('bad escrow datum');
      }
      return { channel_id, denom };
    },
    encodeTransferModuleDatum: async (datum) =>
      encodedModuleDatum(datum.escrow_shard_registry_root),
    decodeTransferModuleDatum: async (datum) => {
      if (!datum.startsWith('module:')) {
        throw new Error('bad module datum');
      }
      return { escrow_shard_registry_root: datum.slice('module:'.length) };
    },
    ...overrides,
  };
}

function lookup(
  deps: TransferEscrowShardRegistryDependencies,
  denomToken = DENOM_TOKEN,
) {
  return findTransferEscrowShard(
    deps,
    CHANNEL_ID,
    PACKET_DENOM,
    denomToken,
  );
}

describe('transfer escrow shard registry lookup', () => {
  it('returns the root from the authoritative address scan for transaction consumption', async () => {
    const scannedRoot = moduleRoot(existingRegistryRoot());
    const existingShard = shard();

    const result = await lookup(
      dependencies(async () => [scannedRoot, existingShard]),
    );

    assert.equal(result.kind, 'existing');
    assert.equal(result.transferModuleUtxo, scannedRoot);
    if (result.kind === 'existing') {
      assert.equal(result.utxo, existingShard);
      assert.equal(result.shardTokenUnit, SHARD_TOKEN_UNIT);
    }
  });

  it('treats a legacy root without a datum as an empty registry', async () => {
    const legacyRoot = moduleRoot();

    const result = await lookup(dependencies(async () => [legacyRoot]));

    assert.equal(result.kind, 'missing');
    assert.equal(result.transferModuleUtxo, legacyRoot);
    if (result.kind === 'missing') {
      assert.equal(result.registrySiblings.length, 64);
      assert.notEqual(
        result.encodedUpdatedTransferModuleDatum,
        encodedModuleDatum('00'.repeat(32)),
      );
    }
  });

  it('rejects a registry root that does not match the live shard set', async () => {
    await assert.rejects(
      () => lookup(dependencies(async () => [moduleRoot('11'.repeat(32)), shard()])),
      /registry root does not match live shards/,
    );
  });

  it('rejects duplicate scan rows, duplicate shards, and malformed shard holders', async () => {
    const root = moduleRoot(existingRegistryRoot());
    await assert.rejects(
      () => lookup(dependencies(async () => [root, root])),
      /duplicate output module-root#0/,
    );
    await assert.rejects(
      () => lookup(dependencies(async () => [root, shard('shard-a'), shard('shard-b')])),
      /Duplicate transfer escrow shard/,
    );

    const malformed = utxo(
      'malformed',
      0,
      { lovelace: 2_000_000n, [`${SHARD_POLICY_ID}ff`]: 1n },
      encodedEscrowDatum(CHANNEL_ID, PACKET_DENOM),
    );
    await assert.rejects(
      () => lookup(dependencies(async () => [moduleRoot('00'.repeat(32)), malformed])),
      /Malformed transfer escrow shard/,
    );
  });

  it('propagates provider failures instead of treating them as shard absence', async () => {
    const providerError = new Error('provider unavailable');

    await assert.rejects(
      () => lookup(dependencies(async () => Promise.reject(providerError))),
      (error) => error === providerError,
    );
  });

  it('rejects a 64-bit Merkle path collision explicitly', async () => {
    const collisionTree = {
      set: () => undefined,
      getSiblings: () => Array.from({ length: 64 }, () => Buffer.alloc(32)),
      getRoot: () => {
        throw new Error('Merkle path collision at index 7');
      },
    };

    await assert.rejects(
      () =>
        lookup(
          dependencies(
            async () => [moduleRoot()],
            { createRegistryTree: () => collisionTree },
          ),
        ),
      /registry Merkle path collision.*Merkle path collision/,
    );
  });

  it('rejects a requested token that does not match the datum denomination', async () => {
    const wrongToken = `${'99'.repeat(28)}01`;

    await assert.rejects(
      () =>
        lookup(
          dependencies(async () => [moduleRoot(existingRegistryRoot()), shard()]),
          wrongToken,
        ),
      /Requested asset .* does not match escrow shard denom/,
    );
  });
});
