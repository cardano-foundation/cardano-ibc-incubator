import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ICS23MerkleTree } from '@shared/helpers/ics23-merkle-tree';
import {
  TRANSFER_ESCROW_SHARD_REGISTERED_VALUE,
  TRANSFER_ESCROW_SHARD_RETIRED_VALUE,
  transferEscrowShardChannelLiveCountKey,
  transferEscrowShardCountValue,
  transferEscrowShardRegistryKey,
  transferEscrowShardTokenName,
} from '@shared/helpers/transfer-escrow-shard';
import { DenomTraceService } from '../../query/services/denom-trace.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { PacketService } from '../packet.service';

const SHARD_POLICY_ID = 'ab'.repeat(28);
const TRANSFER_MODULE_IDENTIFIER = 'cd'.repeat(28) + '01';
const TRANSFER_MODULE_ADDRESS = 'addr_test1transfermodule';
const CHANNEL_ID = Buffer.from('channel-7').toString('hex');
const PACKET_DENOM = Buffer.from(Buffer.from('lovelace').toString('hex')).toString('hex');
const SHARD_TOKEN_NAME = transferEscrowShardTokenName(CHANNEL_ID, PACKET_DENOM);
const SHARD_TOKEN_UNIT = SHARD_POLICY_ID + SHARD_TOKEN_NAME;

const encodedEscrowDatum = (channelId: string, denom: string, amount: bigint) =>
  `escrow:${channelId}:${denom}:${amount}`;
const encodedModuleDatum = (root: string, liveCount: bigint, voucherSupply = 0n) =>
  `module:${root}:${liveCount}:${voucherSupply}`;

const rootUtxo = (root: string, liveCount = 0n, voucherSupply = 0n) => ({
  txHash: 'root',
  outputIndex: 0,
  datum: encodedModuleDatum(root, liveCount, voucherSupply),
  assets: {
    lovelace: 5_000_000n,
    [TRANSFER_MODULE_IDENTIFIER]: 1n,
  },
});

const shardUtxo = (txHash = 'shard', amount = 10n) => ({
  txHash,
  outputIndex: 0,
  datum: encodedEscrowDatum(CHANNEL_ID, PACKET_DENOM, amount),
  assets: {
    lovelace: 10n,
    [SHARD_TOKEN_UNIT]: 1n,
  },
});

const historicalShard = (utxo: ReturnType<typeof shardUtxo>, spent = false) => ({
  ...utxo,
  transactionIndex: 0,
  createdAt: { slotNo: 10, headerHash: 'aa'.repeat(32) },
  spentAt: spent ? { slotNo: 20, headerHash: 'bb'.repeat(32) } : null,
  inlineDatumHash: 'cc'.repeat(32),
  authToken: {
    policyId: SHARD_POLICY_ID,
    name: SHARD_TOKEN_NAME,
    unit: SHARD_TOKEN_UNIT,
  },
});

function existingRegistryRoot(): string {
  const tree = new ICS23MerkleTree();
  tree.set(transferEscrowShardRegistryKey(SHARD_TOKEN_NAME), TRANSFER_ESCROW_SHARD_REGISTERED_VALUE);
  tree.set(transferEscrowShardChannelLiveCountKey(CHANNEL_ID), transferEscrowShardCountValue(1n));
  return tree.getRoot();
}

function createService(findUtxoAt: jest.Mock, history: any[] = []): PacketService {
  const configService = {
    get: jest.fn().mockReturnValue({
      validators: {
        mintTransferEscrowShard: { scriptHash: SHARD_POLICY_ID },
      },
      modules: {
        transfer: {
          identifier: TRANSFER_MODULE_IDENTIFIER,
          address: TRANSFER_MODULE_ADDRESS,
        },
      },
    }),
  } as unknown as ConfigService;
  const lucidService = {
    findUtxoAt,
    encode: jest.fn().mockImplementation(async (value: any, type: string) => {
      if (type === 'transferEscrow') {
        return encodedEscrowDatum(value.channel_id, value.denom, value.escrowed_amount);
      }
      if (type === 'transferModule') {
        return encodedModuleDatum(
          value.escrow_shard_registry_root,
          value.live_escrow_shard_count,
          value.voucher_supply,
        );
      }
      throw new Error(`Unexpected codec ${type}`);
    }),
    decodeDatum: jest.fn().mockImplementation(async (datum: string, type: string) => {
      if (type === 'transferModule' && datum.startsWith('module:')) {
        const [, escrow_shard_registry_root, liveCount, voucherSupply] = datum.split(':');
        return {
          escrow_shard_registry_root,
          live_escrow_shard_count: BigInt(liveCount),
          voucher_supply: BigInt(voucherSupply),
        };
      }
      if (type === 'transferEscrow' && datum.startsWith('escrow:')) {
        const [, channel_id, denom, amount] = datum.split(':');
        return { channel_id, denom, escrowed_amount: BigInt(amount) };
      }
      throw new Error(`Malformed ${type} datum`);
    }),
  };

  return new PacketService(
    { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger,
    configService,
    lucidService as unknown as LucidService,
    {} as DenomTraceService,
    {} as any,
    {} as any,
    {
      queryLatestUtxosAtAddressByPolicyFromHistory: jest.fn().mockResolvedValue(history),
    } as any,
  );
}

describe('PacketService escrow shard registry lookup', () => {
  it('returns a 64-sibling insertion witness and updated root for a missing shard', async () => {
    const service = createService(jest.fn().mockResolvedValue([rootUtxo('00'.repeat(32))]));

    const lookup = await (service as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'lovelace', 10n);

    expect(lookup).toMatchObject({
      kind: 'missing',
      shardTokenUnit: SHARD_TOKEN_UNIT,
      encodedDatum: encodedEscrowDatum(CHANNEL_ID, PACKET_DENOM, 10n),
      encodedUpdatedTransferModuleDatum: encodedModuleDatum(existingRegistryRoot(), 1n),
      oldChannelLiveEscrowShardCount: 0n,
    });
    expect(lookup.registrySiblings).toHaveLength(64);
    expect(lookup.registrySiblings).toEqual(Array(64).fill('00'.repeat(32)));
  });

  it('reconstructs permanent membership from a canonical zero-balance shard', async () => {
    const canonicalShard = shardUtxo();
    const service = createService(jest.fn().mockResolvedValue([rootUtxo(existingRegistryRoot(), 1n), canonicalShard]), [
      historicalShard(canonicalShard),
    ]);

    const lookup = await (service as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'lovelace');

    expect(lookup.kind).toBe('existing');
    expect(lookup.utxo).toBe(canonicalShard);
    expect(lookup.registrySiblings).toHaveLength(64);

    await expect((service as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'lovelace')).resolves.toMatchObject(
      { kind: 'existing', utxo: canonicalShard },
    );
    expect((service as any).kupoService.queryLatestUtxosAtAddressByPolicyFromHistory).toHaveBeenCalledTimes(1);
  });

  it('uses the expected committed root after shard creation without another history replay', async () => {
    const createdShard = shardUtxo('created-shard');
    const findUtxoAt = jest.fn().mockResolvedValueOnce([rootUtxo('00'.repeat(32))]);
    const service = createService(findUtxoAt);

    const creation = await (service as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'lovelace', 10n);
    expect(creation.kind).toBe('missing');
    findUtxoAt.mockResolvedValue([rootUtxo(existingRegistryRoot(), 1n), createdShard]);

    await expect((service as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'lovelace')).resolves.toMatchObject(
      { kind: 'existing', utxo: createdShard },
    );
    expect((service as any).kupoService.queryLatestUtxosAtAddressByPolicyFromHistory).toHaveBeenCalledTimes(1);
  });

  it('rejects a requested asset mismatch and an insufficient shard balance', async () => {
    const canonicalShard = shardUtxo();
    const service = createService(jest.fn().mockResolvedValue([rootUtxo(existingRegistryRoot(), 1n), canonicalShard]), [
      historicalShard(canonicalShard),
    ]);
    const missingService = createService(jest.fn().mockResolvedValue([rootUtxo('00'.repeat(32))]));

    await expect((service as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'ab'.repeat(28))).rejects.toThrow(
      /does not match escrow shard denom/,
    );
    await expect(
      (missingService as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'ab'.repeat(28)),
    ).rejects.toThrow(/does not match escrow shard denom/);
    await expect((service as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'lovelace', -11n)).rejects.toThrow(
      /Insufficient escrowed amount/,
    );
  });

  it('keeps a registered non-lovelace shard canonical after its denom balance reaches zero', async () => {
    const denomToken = 'ef'.repeat(28) + '01';
    const packetDenom = Buffer.from(denomToken).toString('hex');
    const tokenName = transferEscrowShardTokenName(CHANNEL_ID, packetDenom);
    const tokenUnit = SHARD_POLICY_ID + tokenName;
    const tree = new ICS23MerkleTree();
    tree.set(transferEscrowShardRegistryKey(tokenName), TRANSFER_ESCROW_SHARD_REGISTERED_VALUE);
    tree.set(transferEscrowShardChannelLiveCountKey(CHANNEL_ID), transferEscrowShardCountValue(1n));
    const zeroBalanceShard = {
      txHash: 'zero-balance-shard',
      outputIndex: 0,
      datum: encodedEscrowDatum(CHANNEL_ID, packetDenom, 0n),
      assets: {
        lovelace: 2_000_000n,
        [tokenUnit]: 1n,
      },
    };
    const service = createService(jest.fn().mockResolvedValue([rootUtxo(tree.getRoot(), 1n), zeroBalanceShard]), [
      {
        ...historicalShard(shardUtxo()),
        ...zeroBalanceShard,
        authToken: {
          policyId: SHARD_POLICY_ID,
          name: tokenName,
          unit: tokenUnit,
        },
      },
    ]);

    const lookup = await (service as any).findTransferEscrowShard(CHANNEL_ID, packetDenom, denomToken);

    expect(lookup).toMatchObject({ kind: 'existing', utxo: zeroBalanceShard });
  });

  it('rebuilds retired tombstones from retained Kupo history and rejects recreation', async () => {
    const tree = new ICS23MerkleTree();
    tree.set(transferEscrowShardRegistryKey(SHARD_TOKEN_NAME), TRANSFER_ESCROW_SHARD_RETIRED_VALUE);
    const retired = shardUtxo('retired-shard', 0n);
    const service = createService(jest.fn().mockResolvedValue([rootUtxo(tree.getRoot())]), [
      historicalShard(retired, true),
    ]);

    await expect((service as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'lovelace', 1n)).rejects.toThrow(
      /permanently retired/,
    );
  });

  it('prepares live-to-retired and last-count deletion witnesses for an empty shard', async () => {
    const emptyShard = shardUtxo('empty-shard', 0n);
    const service = createService(jest.fn().mockResolvedValue([rootUtxo(existingRegistryRoot(), 1n), emptyShard]), [
      historicalShard(emptyShard),
    ]);
    const retiredTree = new ICS23MerkleTree();
    retiredTree.set(transferEscrowShardRegistryKey(SHARD_TOKEN_NAME), TRANSFER_ESCROW_SHARD_RETIRED_VALUE);

    const prepared = await service.prepareTransferEscrowShardRetirement(CHANNEL_ID, PACKET_DENOM);

    expect(prepared).toMatchObject({
      shardUtxo: emptyShard,
      shardTokenUnit: SHARD_TOKEN_UNIT,
      oldChannelLiveEscrowShardCount: 1n,
      encodedUpdatedTransferModuleDatum: encodedModuleDatum(retiredTree.getRoot(), 0n),
    });
    expect(prepared.registrySiblings).toHaveLength(64);
    expect(prepared.channelLiveEscrowShardCountSiblings).toHaveLength(64);
  });

  it('rejects retirement with logical principal and proves an absent channel count', async () => {
    const fundedShard = shardUtxo('funded-shard', 1n);
    const fundedService = createService(
      jest.fn().mockResolvedValue([rootUtxo(existingRegistryRoot(), 1n), fundedShard]),
      [historicalShard(fundedShard)],
    );
    await expect(fundedService.prepareTransferEscrowShardRetirement(CHANNEL_ID, PACKET_DENOM)).rejects.toThrow(
      /not empty and reclaimable/,
    );

    const retiredTree = new ICS23MerkleTree();
    retiredTree.set(transferEscrowShardRegistryKey(SHARD_TOKEN_NAME), TRANSFER_ESCROW_SHARD_RETIRED_VALUE);
    const retired = shardUtxo('retired-shard', 0n);
    const drainedService = createService(jest.fn().mockResolvedValue([rootUtxo(retiredTree.getRoot(), 0n)]), [
      historicalShard(retired, true),
    ]);
    const witness = await drainedService.prepareTransferChannelNoLiveShards(CHANNEL_ID);
    expect(witness.channelLiveEscrowShardCountSiblings).toHaveLength(64);

    await expect(fundedService.prepareTransferChannelNoLiveShards(CHANNEL_ID)).rejects.toThrow(
      /still owns live transfer escrow shards/,
    );

    const outstandingVoucherService = createService(jest.fn().mockResolvedValue([rootUtxo('00'.repeat(32), 0n, 1n)]));
    await expect(outstandingVoucherService.prepareTransferChannelNoLiveShards(CHANNEL_ID)).rejects.toThrow(
      /voucher supply remains/,
    );
  });

  it('rejects duplicate and malformed shard holders', async () => {
    const duplicateService = createService(
      jest.fn().mockResolvedValue([rootUtxo(existingRegistryRoot(), 1n), shardUtxo('shard-a'), shardUtxo('shard-b')]),
    );
    await expect(
      (duplicateService as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'lovelace'),
    ).rejects.toThrow(/Duplicate escrow shard holders/);

    const malformedService = createService(
      jest.fn().mockResolvedValue([
        rootUtxo('00'.repeat(32)),
        {
          txHash: 'malformed',
          outputIndex: 0,
          datum: encodedEscrowDatum(CHANNEL_ID, PACKET_DENOM, 0n),
          assets: { [SHARD_POLICY_ID + 'ff']: 1n },
        },
      ]),
    );
    await expect(
      (malformedService as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'lovelace'),
    ).rejects.toThrow(/Malformed escrow shard holder/);
  });

  it('rejects a registry root mismatch', async () => {
    const canonicalShard = shardUtxo();
    const service = createService(jest.fn().mockResolvedValue([rootUtxo('11'.repeat(32)), canonicalShard]), [
      historicalShard(canonicalShard),
    ]);

    await expect((service as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'lovelace')).rejects.toThrow(
      /registry root mismatch/,
    );
  });

  it('fails explicitly when registry keys collide on a 64-bit Merkle path', async () => {
    const service = createService(jest.fn().mockResolvedValue([rootUtxo('00'.repeat(32))]));
    const getRootSpy = jest.spyOn(ICS23MerkleTree.prototype, 'getRoot').mockImplementationOnce(() => {
      throw new Error('Merkle key collision at index 7');
    });

    try {
      await expect((service as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'lovelace')).rejects.toThrow(
        /registry Merkle path collision.*Merkle key collision/,
      );
    } finally {
      getRootSpy.mockRestore();
    }
  });

  it('propagates provider errors instead of treating them as absence', async () => {
    const providerError = new Error('provider unavailable');
    const service = createService(jest.fn().mockRejectedValue(providerError));

    await expect((service as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'lovelace')).rejects.toBe(
      providerError,
    );
  });
});
