import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ICS23MerkleTree } from '@shared/helpers/ics23-merkle-tree';
import {
  TRANSFER_ESCROW_SHARD_REGISTERED_VALUE,
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

const encodedEscrowDatum = (channelId: string, denom: string) => `escrow:${channelId}:${denom}`;
const encodedModuleDatum = (root: string) => `module:${root}`;

const rootUtxo = (root: string) => ({
  txHash: 'root',
  outputIndex: 0,
  datum: encodedModuleDatum(root),
  assets: {
    lovelace: 5_000_000n,
    [TRANSFER_MODULE_IDENTIFIER]: 1n,
  },
});

const shardUtxo = (txHash = 'shard') => ({
  txHash,
  outputIndex: 0,
  datum: encodedEscrowDatum(CHANNEL_ID, PACKET_DENOM),
  assets: {
    lovelace: 10n,
    [SHARD_TOKEN_UNIT]: 1n,
  },
});

function existingRegistryRoot(): string {
  const tree = new ICS23MerkleTree();
  tree.set(transferEscrowShardRegistryKey(SHARD_TOKEN_NAME), TRANSFER_ESCROW_SHARD_REGISTERED_VALUE);
  return tree.getRoot();
}

function createService(findUtxoAt: jest.Mock): PacketService {
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
        return encodedEscrowDatum(value.channel_id, value.denom);
      }
      if (type === 'transferModule') {
        return encodedModuleDatum(value.escrow_shard_registry_root);
      }
      throw new Error(`Unexpected codec ${type}`);
    }),
    decodeDatum: jest.fn().mockImplementation(async (datum: string, type: string) => {
      if (type === 'transferModule' && datum.startsWith('module:')) {
        return { escrow_shard_registry_root: datum.slice('module:'.length) };
      }
      if (type === 'transferEscrow' && datum.startsWith('escrow:')) {
        const [, channel_id, denom] = datum.split(':');
        return { channel_id, denom };
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
  );
}

describe('PacketService escrow shard registry lookup', () => {
  it('returns a 64-sibling insertion witness and updated root for a missing shard', async () => {
    const service = createService(jest.fn().mockResolvedValue([rootUtxo('00'.repeat(32))]));

    const lookup = await (service as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'lovelace');

    expect(lookup).toMatchObject({
      kind: 'missing',
      shardTokenUnit: SHARD_TOKEN_UNIT,
      encodedDatum: encodedEscrowDatum(CHANNEL_ID, PACKET_DENOM),
      encodedUpdatedTransferModuleDatum: encodedModuleDatum(existingRegistryRoot()),
    });
    expect(lookup.registrySiblings).toHaveLength(64);
    expect(lookup.registrySiblings).toEqual(Array(64).fill('00'.repeat(32)));
  });

  it('reconstructs permanent membership from a canonical zero-balance shard', async () => {
    const canonicalShard = shardUtxo();
    const service = createService(jest.fn().mockResolvedValue([rootUtxo(existingRegistryRoot()), canonicalShard]));

    const lookup = await (service as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'lovelace');

    expect(lookup.kind).toBe('existing');
    expect(lookup.utxo).toBe(canonicalShard);
    expect(lookup.registrySiblings).toHaveLength(64);
  });

  it('rejects a requested asset mismatch and an insufficient shard balance', async () => {
    const service = createService(jest.fn().mockResolvedValue([rootUtxo(existingRegistryRoot()), shardUtxo()]));
    const missingService = createService(jest.fn().mockResolvedValue([rootUtxo('00'.repeat(32))]));

    await expect((service as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'ab'.repeat(28))).rejects.toThrow(
      /does not match escrow shard denom/,
    );
    await expect(
      (missingService as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'ab'.repeat(28)),
    ).rejects.toThrow(/does not match escrow shard denom/);
    await expect((service as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'lovelace', 11n)).rejects.toThrow(
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
    const zeroBalanceShard = {
      txHash: 'zero-balance-shard',
      outputIndex: 0,
      datum: encodedEscrowDatum(CHANNEL_ID, packetDenom),
      assets: {
        lovelace: 2_000_000n,
        [tokenUnit]: 1n,
      },
    };
    const service = createService(jest.fn().mockResolvedValue([rootUtxo(tree.getRoot()), zeroBalanceShard]));

    const lookup = await (service as any).findTransferEscrowShard(CHANNEL_ID, packetDenom, denomToken);

    expect(lookup).toMatchObject({ kind: 'existing', utxo: zeroBalanceShard });
  });

  it('rejects duplicate and malformed shard holders', async () => {
    const duplicateService = createService(
      jest.fn().mockResolvedValue([rootUtxo(existingRegistryRoot()), shardUtxo('shard-a'), shardUtxo('shard-b')]),
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
          datum: encodedEscrowDatum(CHANNEL_ID, PACKET_DENOM),
          assets: { [SHARD_POLICY_ID + 'ff']: 1n },
        },
      ]),
    );
    await expect(
      (malformedService as any).findTransferEscrowShard(CHANNEL_ID, PACKET_DENOM, 'lovelace'),
    ).rejects.toThrow(/Malformed escrow shard holder/);
  });

  it('rejects a registry root mismatch', async () => {
    const service = createService(jest.fn().mockResolvedValue([rootUtxo('11'.repeat(32)), shardUtxo()]));

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
