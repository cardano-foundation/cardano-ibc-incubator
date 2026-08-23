import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UTxO } from '@lucid-evolution/lucid';
import { ICS23MerkleTree } from './ics23MerkleTree';
import {
  TRANSFER_ESCROW_SHARD_LIVE_VALUE,
  TRANSFER_ESCROW_SHARD_RETIRED_VALUE,
  findTransferEscrowShard,
  prepareTransferEscrowShardRetirement,
  proveTransferChannelHasNoLiveShards,
  transferEscrowShardChannelLiveCountKey,
  transferEscrowShardRegistryKey,
  transferEscrowShardTokenName,
  type TransferEscrowShardRegistryDependencies,
  type TransferEscrowShardHistoryOutput,
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

function encodedEscrowDatum(
  channelId: string,
  denom: string,
  escrowedAmount: bigint,
): string {
  return `escrow:${channelId}:${denom}:${escrowedAmount}`;
}

function encodedModuleDatum(
  root: string,
  liveEscrowShardCount: bigint,
  voucherSupply = 0n,
): string {
  return `module:${root}:${liveEscrowShardCount}:${voucherSupply}`;
}

function moduleRoot(
  root?: string,
  liveCount = root === undefined ? 0n : 1n,
  voucherSupply = 0n,
): UTxO {
  return utxo(
    'module-root',
    0,
    { lovelace: 5_000_000n, [TRANSFER_MODULE_IDENTIFIER]: 1n },
    root === undefined ? undefined : encodedModuleDatum(root, liveCount, voucherSupply),
  );
}

function shard(
  txHash = 'shard',
  outputIndex = 0,
  escrowedAmount = 10n,
): UTxO {
  return utxo(
    txHash,
    outputIndex,
    {
      lovelace: 2_000_000n,
      [DENOM_TOKEN]: escrowedAmount,
      [SHARD_TOKEN_UNIT]: 1n,
    },
    encodedEscrowDatum(CHANNEL_ID, PACKET_DENOM, escrowedAmount),
  );
}

function existingRegistryRoot(): string {
  const tree = new ICS23MerkleTree();
  tree.set(
    transferEscrowShardRegistryKey(SHARD_TOKEN_NAME),
    Buffer.from([1]),
  );
  tree.set(
    transferEscrowShardChannelLiveCountKey(CHANNEL_ID),
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
    findLatestShardHistory: async (address, policyId) =>
      (await findUtxosAt(address))
        .flatMap((candidate) => {
          const units = Object.keys(candidate.assets).filter((unit) =>
            unit.startsWith(policyId)
          );
          return units.length === 1
            ? [{ ...candidate, shardTokenUnit: units[0], spent: false }]
            : [];
        }),
    encodeTransferEscrowDatum: async (datum) =>
      encodedEscrowDatum(
        datum.channel_id,
        datum.denom,
        datum.escrowed_amount,
      ),
    decodeTransferEscrowDatum: async (datum) => {
      const [prefix, channel_id, denom, escrowedAmount] = datum.split(':');
      if (prefix !== 'escrow' || !channel_id || !denom || !escrowedAmount) {
        throw new Error('bad escrow datum');
      }
      return { channel_id, denom, escrowed_amount: BigInt(escrowedAmount) };
    },
    encodeTransferModuleDatum: async (datum) =>
      encodedModuleDatum(
        datum.escrow_shard_registry_root,
        datum.live_escrow_shard_count,
        datum.voucher_supply,
      ),
    decodeTransferModuleDatum: async (datum) => {
      if (!datum.startsWith('module:')) {
        throw new Error('bad module datum');
      }
      const [prefix, root, liveCount, voucherSupply] = datum.split(':');
      if (prefix !== 'module' || !root || !liveCount || !voucherSupply) {
        throw new Error('bad module datum');
      }
      return {
        escrow_shard_registry_root: root,
        live_escrow_shard_count: BigInt(liveCount),
        voucher_supply: BigInt(voucherSupply),
      };
    },
    ...overrides,
  };
}

function lookup(
  deps: TransferEscrowShardRegistryDependencies,
  denomToken = DENOM_TOKEN,
  principalDelta?: bigint,
) {
  return findTransferEscrowShard(
    deps,
    CHANNEL_ID,
    PACKET_DENOM,
    denomToken,
    principalDelta,
  );
}

describe('transfer escrow shard registry lookup', () => {
  it('matches the Aiken lifecycle values and channel-count key encoding', () => {
    assert.deepEqual(TRANSFER_ESCROW_SHARD_LIVE_VALUE, Buffer.from([1]));
    assert.deepEqual(TRANSFER_ESCROW_SHARD_RETIRED_VALUE, Buffer.from([2]));
    assert.equal(
      transferEscrowShardChannelLiveCountKey(
        Buffer.from('channel-1').toString('hex'),
      ),
      'escrowShardCounts/6368616e6e656c2d31',
    );
  });

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

    const result = await lookup(
      dependencies(async () => [legacyRoot]),
      DENOM_TOKEN,
      1_000n,
    );

    assert.equal(result.kind, 'missing');
    assert.equal(result.transferModuleUtxo, legacyRoot);
    if (result.kind === 'missing') {
      assert.equal(result.registrySiblings.length, 64);
      assert.notEqual(
        result.encodedUpdatedTransferModuleDatum,
        encodedModuleDatum('00'.repeat(32), 0n),
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
      encodedEscrowDatum(CHANNEL_ID, PACKET_DENOM, 0n),
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

  it('restores retired markers from Kupo history and rejects deterministic recreation', async () => {
    const tree = new ICS23MerkleTree();
    tree.set(
      transferEscrowShardRegistryKey(SHARD_TOKEN_NAME),
      TRANSFER_ESCROW_SHARD_RETIRED_VALUE,
    );
    const retired = shard('retired', 0, 0n);
    const history: TransferEscrowShardHistoryOutput = {
      ...retired,
      shardTokenUnit: SHARD_TOKEN_UNIT,
      spent: true,
    };

    await assert.rejects(
      () =>
        lookup(
          dependencies(
            async () => [moduleRoot(tree.getRoot(), 0n)],
            { findLatestShardHistory: async () => [history] },
          ),
          DENOM_TOKEN,
          1n,
        ),
      /permanently retired/,
    );
  });

  it('prepares exact retirement witnesses and deletes the final channel count leaf', async () => {
    const emptyShard = shard('empty', 0, 0n);
    const deps = dependencies(async () => [
      moduleRoot(existingRegistryRoot(), 1n),
      emptyShard,
    ]);
    const retiredTree = new ICS23MerkleTree();
    retiredTree.set(
      transferEscrowShardRegistryKey(SHARD_TOKEN_NAME),
      TRANSFER_ESCROW_SHARD_RETIRED_VALUE,
    );

    const prepared = await prepareTransferEscrowShardRetirement(
      deps,
      CHANNEL_ID,
      PACKET_DENOM,
    );

    assert.equal(prepared.shardUtxo, emptyShard);
    assert.equal(prepared.oldChannelLiveEscrowShardCount, 1n);
    assert.equal(prepared.registrySiblings.length, 64);
    assert.equal(prepared.channelLiveEscrowShardCountSiblings.length, 64);
    assert.equal(
      prepared.encodedUpdatedTransferModuleDatum,
      encodedModuleDatum(retiredTree.getRoot(), 0n),
    );
  });

  it('rejects funded retirement and proves absence after retained retirement', async () => {
    await assert.rejects(
      () =>
        prepareTransferEscrowShardRetirement(
          dependencies(async () => [
            moduleRoot(existingRegistryRoot(), 1n),
            shard('funded', 0, 1n),
          ]),
          CHANNEL_ID,
          PACKET_DENOM,
        ),
      /not empty and reclaimable/,
    );

    const retiredTree = new ICS23MerkleTree();
    retiredTree.set(
      transferEscrowShardRegistryKey(SHARD_TOKEN_NAME),
      TRANSFER_ESCROW_SHARD_RETIRED_VALUE,
    );
    const retired = shard('retired-for-proof', 0, 0n);
    const witness = await proveTransferChannelHasNoLiveShards(
      dependencies(
        // Voucher liabilities elsewhere in the transfer module do not belong
        // to this drained channel and must not block its reclamation proof.
        async () => [moduleRoot(retiredTree.getRoot(), 0n, 7n)],
        {
          findLatestShardHistory: async () => [
            { ...retired, shardTokenUnit: SHARD_TOKEN_UNIT, spent: true },
          ],
        },
      ),
      CHANNEL_ID,
    );
    assert.equal(witness.channelLiveEscrowShardCountSiblings.length, 64);
  });
});
