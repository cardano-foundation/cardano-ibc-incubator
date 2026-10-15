import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { QueryIBCHeaderRequest, QueryIBCHeaderResponse } from '@cardano-ibc/proto-types/build/ibc/core/types/v1/query';
import * as grpc from '@grpc/grpc-js';
import { Cbor, CborArray, CborBytes, CborUInt } from '@harmoniclabs/cbor';
import { createPacketStateMock } from '../../shared/testing/packet-state-test-mock';
import { createTestTreeStore } from '../../shared/testing/ibc-tree-test-store';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ClientState as ClientStateProbabilistic,
  ProbabilisticHeader,
  ProbabilisticBlock,
  EpochContext,
} from '@cardano-ibc/proto-types/build/ibc/lightclients/probabilistic/v1/probabilistic';
import { QueryService } from '../services/query.service';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { MiniProtocalsService } from '../../shared/modules/mini-protocals/mini-protocals.service';
import { DenomTraceService } from '../services/denom-trace.service';
import { HistoryService } from '../services/history.service';
import { bech32 } from 'bech32';

// Settlement fixtures begin after more than six months of registration history.
const MATURE_POOL_SLOT = 20_000_000n;
const STABILITY_SLOT_ORIGIN_NS = 1_700_000_000_000_000_000n;
const timestampForSlot = (slot: bigint) => STABILITY_SLOT_ORIGIN_NS + (MATURE_POOL_SLOT + slot) * 1_000_000_000n;
const operationalCertificatePoolId = (byte: number) => bech32.encode('pool', bech32.toWords(Buffer.alloc(28, byte)));
const stabilityDescendantBlocks = Array.from({ length: 24 }, (_, index) => {
  const height = 101 + index;
  const slot = 1000n + BigInt(index + 1) * 10n;
  return {
    height,
    hash: `hash-${height}`,
    prevHash: index === 0 ? 'anchor-hash' : `hash-${height - 1}`,
    slotNo: MATURE_POOL_SLOT + slot,
    epochNo: 7,
    timestampUnixNs: timestampForSlot(slot),
    slotLeader: `pool-${String.fromCharCode(97 + (index % 5))}`,
  };
});

let service: QueryService;
let loggerMock: {
  log: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
};
let lucidServiceMock: {
  decodeDatum: jest.Mock;
  findUtxoAtHostStateNFT: jest.Mock;
  LucidImporter: {
    SLOT_CONFIG_NETWORK: {
      Preview: {
        zeroTime: number;
        slotLength: number;
      };
    };
  };
};
let historyServiceMock: {
  findLatestBlock: jest.Mock;
  findBlockByHeight: jest.Mock;
  findDescendantBlocks: jest.Mock;
  findObservedPoolProductionAtBlock: jest.Mock;
  findEpochContextAtBlock: jest.Mock;
  findOperationalCertificateCountersAtBlock: jest.Mock;
  findBridgeBlocks: jest.Mock;
  findHostStateUtxoAtOrBeforeBlockNo: jest.Mock;
  findTransactionEvidenceByHash: jest.Mock;
};
let miniProtocalsServiceMock: {
  fetchBlockCbor: jest.Mock;
  fetchBlocksCbor: jest.Mock;
  extractBlockHeaderCbor: jest.Mock;
};

beforeEach(() => {
  loggerMock = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const configServiceMock = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'ogmiosEndpoint') return 'ws://bootstrap-node';
      if (key === 'cardanoPoolRegistryCheckpointFile') return '/trusted/pool-registry.json';
      if (key === 'cardanoRandomnessStabilisationWindowSlots') return '100';
      if (key === 'cardanoChainId') return 'cardano-devnet';
      if (key === 'cardanoNetwork') return 'Preview';
      if (key === 'cardanoClientMaxClockDriftSeconds') return 17;
      if (key === 'deployment') {
        return {
          packetState: { state: { scriptHash: 'cc'.repeat(28) }, laneCount: 16 },
          hostStateNFT: {
            policyId: 'a'.repeat(56),
            name: 'b'.repeat(64),
          },
        };
      }
      return undefined;
    }),
  } as unknown as ConfigService;

  historyServiceMock = {
    findObservedPoolProductionAtBlock: jest.fn().mockImplementation(async (point) => ({ epoch: BigInt(point.epochNo), pools: ['pool-a', 'pool-b', 'pool-c', 'pool-d', 'pool-e'].map((pool_id) => ({ pool_id, completed_epochs_bitmap: 1, produced_current_epoch: false })) })),
    findLatestBlock: jest.fn().mockResolvedValue({
      height: 105,
      hash: 'latest-hash',
      prevHash: 'hash-104',
      slotNo: MATURE_POOL_SLOT + 1050n,
      epochNo: 7,
      timestampUnixNs: timestampForSlot(1050n),
      slotLeader: 'pool-e',
    }),
    findBlockByHeight: jest.fn().mockImplementation(async (height: bigint) => {
      if (height === 98n) {
        return {
          height: 98,
          hash: 'hash-98',
          prevHash: 'hash-97',
          slotNo: MATURE_POOL_SLOT + 980n,
          epochNo: 7,
          timestampUnixNs: timestampForSlot(980n),
          slotLeader: 'pool-z',
        };
      }
      return {
        height: 100,
        hash: 'anchor-hash',
        prevHash: 'prev-hash',
        slotNo: MATURE_POOL_SLOT + 1000n,
        epochNo: 7,
        timestampUnixNs: timestampForSlot(1000n),
        slotLeader: 'pool-a',
      };
    }),
    findDescendantBlocks: jest.fn().mockResolvedValue(stabilityDescendantBlocks),
    findEpochContextAtBlock: jest.fn().mockResolvedValue({
      epoch: 7,
      stakeDistribution: [
        {
          poolId: 'pool-a',
          stake: 200n,
          relativeStakeNumerator: 1n,
          relativeStakeDenominator: 5n,
          vrfKeyHash: 'aa'.repeat(32),
          firstRegistrationSlot: 1n,
        },
        {
          poolId: 'pool-b',
          stake: 200n,
          relativeStakeNumerator: 1n,
          relativeStakeDenominator: 5n,
          vrfKeyHash: 'bb'.repeat(32),
          firstRegistrationSlot: 1n,
        },
        {
          poolId: 'pool-c',
          stake: 200n,
          relativeStakeNumerator: 1n,
          relativeStakeDenominator: 5n,
          vrfKeyHash: 'cc'.repeat(32),
          firstRegistrationSlot: 1n,
        },
        {
          poolId: 'pool-d',
          stake: 200n,
          relativeStakeNumerator: 1n,
          relativeStakeDenominator: 5n,
          vrfKeyHash: 'dd'.repeat(32),
          firstRegistrationSlot: 1n,
        },
        {
          poolId: 'pool-e',
          stake: 200n,
          relativeStakeNumerator: 1n,
          relativeStakeDenominator: 5n,
          vrfKeyHash: 'ee'.repeat(32),
          firstRegistrationSlot: 1n,
        },
      ],
      verificationContext: {
        epochNonce: '11'.repeat(32),
        slotsPerKesPeriod: 129600,
        activeSlotCoefficientNumerator: 1n,
        activeSlotCoefficientDenominator: 20n,
        maxKesEvolutions: 62,
        currentEpochStartSlot: MATURE_POOL_SLOT + 900n,
        currentEpochEndSlotExclusive: MATURE_POOL_SLOT + 3000n,
      },
    }),
    findOperationalCertificateCountersAtBlock: jest.fn().mockResolvedValue(
      new Map([
        [operationalCertificatePoolId(0xff), 9n],
        [operationalCertificatePoolId(0), 3n],
        [operationalCertificatePoolId(0x11), 0n],
      ]),
    ),
    findBridgeBlocks: jest.fn().mockResolvedValue([
      {
        height: 99,
        hash: 'hash-99',
        prevHash: 'hash-98',
        slotNo: MATURE_POOL_SLOT + 990n,
        epochNo: 7,
        timestampUnixNs: timestampForSlot(990n),
        slotLeader: 'pool-z',
      },
    ]),
    findHostStateUtxoAtOrBeforeBlockNo: jest.fn().mockResolvedValue({
      txHash: 'host-state-tx',
      txId: 1,
      outputIndex: 0,
      address: 'addr_test1...',
      assetsPolicy: 'a'.repeat(56),
      assetsName: 'b'.repeat(64),
      datumHash: 'cd'.repeat(32),
      datum: 'datum-cbor',
      blockNo: 99,
      blockId: 99,
      index: 0,
    }),
    findTransactionEvidenceByHash: jest.fn().mockResolvedValue({
      txHash: 'host-state-tx',
      blockNo: 99,
      txIndex: 0,
      txCborHex: '01',
      txBodyCborHex: '02',
      redeemers: [],
    }),
  };

  lucidServiceMock = {
    decodeDatum: jest.fn().mockResolvedValue({ state: { ibc_state_root: 'ab'.repeat(32) } }),
    findUtxoAtHostStateNFT: jest.fn(),
    LucidImporter: {
      SLOT_CONFIG_NETWORK: {
        Preview: {
          zeroTime: 1_700_000_000_000,
          slotLength: 1_000,
        },
      },
    },
  };
  miniProtocalsServiceMock = {
    fetchBlockCbor: jest.fn().mockResolvedValue(Buffer.from([0])),
    fetchBlocksCbor: jest.fn().mockImplementation(async (blocks: unknown[]) => blocks.map(() => Buffer.from([1]))),
    extractBlockHeaderCbor: jest.fn((blockCbor: Buffer) =>
      blockCbor[0] === 0
        ? Buffer.from(
            Cbor.encode(
              new CborArray([
                new CborArray([new CborUInt(100), new CborUInt(MATURE_POOL_SLOT + 1000n), new CborBytes(Buffer.alloc(32, 5))]),
                new CborBytes(new Uint8Array()),
              ]),
            ).toBuffer(),
          )
        : Buffer.alloc(860, blockCbor[0] ?? 0),
    ),
  };

  service = new QueryService(
    loggerMock as unknown as Logger,
    configServiceMock,
    lucidServiceMock as unknown as LucidService,
    {} as KupoService,
    historyServiceMock as unknown as HistoryService,
    miniProtocalsServiceMock as unknown as MiniProtocalsService,
    {} as DenomTraceService,
    {} as any,
    createTestTreeStore(),
    createPacketStateMock() as any,
  );
});

describe('QueryService stability anchor contract', () => {
  it('requires a trusted bootstrap bundle instead of returning an inline client', async () => {
    await expect(service.queryNewClient({ height: 100n } as any)).rejects.toThrow('trusted bootstrap bundle');
    expect(historyServiceMock.findOperationalCertificateCountersAtBlock).not.toHaveBeenCalled();
  });

  it('rejects an unsupported destination storage format before building evidence', async () => {
    const client = ClientStateProbabilistic.fromPartial({ storage_version: 0 });
    await expect(service.queryIBCHeader({ height: 101n, trusted_height: 100n,
      probabilistic_client_state: ClientStateProbabilistic.encode(client).finish() } as any))
      .rejects.toThrow('Unsupported probabilistic client storage format');
  });










  it.each([null, undefined])('rejects an epoch rollover with an unobserved pool whose registration slot is %s', async (missing) => {
    const table = await historyServiceMock.findEpochContextAtBlock();
    table.stakeDistribution.push({
      ...table.stakeDistribution[0],
      poolId: 'pool-f',
      firstRegistrationSlot: missing,
    });
    for (const entry of table.stakeDistribution) entry.relativeStakeDenominator = 6n;
    const anchor = await historyServiceMock.findBlockByHeight(100n);
    historyServiceMock.findBlockByHeight.mockImplementation(async (height: bigint) =>
      height === 99n
        ? { ...anchor, height: 99, epochNo: 6, slotNo: MATURE_POOL_SLOT + 990n }
        : anchor,
    );
    historyServiceMock.findEpochContextAtBlock.mockImplementation(async (block: { epochNo: number }) =>
      block.epochNo === 6
        ? { ...table, epoch: 6, verificationContext: {
            ...table.verificationContext,
            currentEpochStartSlot: MATURE_POOL_SLOT,
            currentEpochEndSlotExclusive: MATURE_POOL_SLOT + 1000n,
          } }
        : table,
    );
    historyServiceMock.findBridgeBlocks.mockResolvedValue([]);

    await expect(service.queryIBCHeader({ height: 100n, trusted_height: 99n } as any)).rejects.toThrow(
      'First registration slot unavailable for pool pool-f in epoch 7',
    );
  });







  it('normalizes equal trusted and anchor heights to the previous trusted block for stability headers', async () => {
    historyServiceMock.findHostStateUtxoAtOrBeforeBlockNo.mockResolvedValue({
      txHash: 'host-state-tx',
      txId: 1,
      outputIndex: 0,
      address: 'addr_test1...',
      assetsPolicy: 'a'.repeat(56),
      assetsName: 'b'.repeat(64),
      datumHash: 'cd'.repeat(32),
      datum: 'datum-cbor',
      blockNo: 100,
      blockId: 100,
      index: 0,
    });
    historyServiceMock.findBridgeBlocks.mockResolvedValue([]);
    miniProtocalsServiceMock.fetchBlocksCbor.mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => Buffer.from([index + 1])),
    );

    const response = await service.queryIBCHeader({ height: 100n, trusted_height: 100n } as any);
    const header = ProbabilisticHeader.decode(response.header!.value);

    expect(header.trusted_height?.revision_height).toBe(99n);
    expect(header.anchor_block?.height?.revision_height).toBe(100n);
    expect(header.anchor_block?.block_cbor).toEqual(Buffer.from([1]));
    expect(header.anchor_block?.header_cbor).toHaveLength(0);
    expect(header.descendant_blocks.every((block) => block.block_cbor.length === 0)).toBe(true);
    expect(header.descendant_blocks.every((block) => block.header_cbor.length === 860)).toBe(true);
  });

  it('selects an idle maintenance checkpoint from source blocks without a new proof anchor', async () => {
    historyServiceMock.findLatestBlock.mockResolvedValue({ height: 124 });
    historyServiceMock.findHostStateUtxoAtOrBeforeBlockNo.mockResolvedValue(null);
    historyServiceMock.findBridgeBlocks.mockResolvedValue([]);
    miniProtocalsServiceMock.fetchBlocksCbor.mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => Buffer.from([index + 1])),
    );
    const context = ClientStateProbabilistic.fromPartial({ storage_version: 2,
      slot_length_ns: 1_000_000_000n,
      current_epoch: 7n,
      latest_checkpoint_height: { revision_height: 99n },
      latest_checkpoint_settlement_credit: { epoch: 7n, reference: ['pool-a', 'pool-b', 'pool-c', 'pool-d', 'pool-e'].map((pool_id) => ({ pool_id, numerator: Uint8Array.of(1), denominator: Uint8Array.of(5) })) },
      latest_checkpoint_pool_production: { epoch: 7n, pools: ['pool-a', 'pool-b', 'pool-c', 'pool-d', 'pool-e'].map((pool_id) => ({ pool_id, completed_epochs_bitmap: 1, produced_current_epoch: false })) },
    });
    const latestProof = jest.spyOn(service, 'latestCertifiedHeight');
    const response = await service.queryIBCHeader({ height: 0n, trusted_height: 99n, checkpoint_only: true, probabilistic_client_state: ClientStateProbabilistic.encode(context).finish() });
    const header = ProbabilisticHeader.decode(response.header!.value);
    expect(header.is_checkpoint).toBe(true);
    expect(header.anchor_block?.height?.revision_height).toBe(100n);
    expect(header.host_state_tx_hash).toBe('');
    expect(header.new_epoch_context).toBeUndefined();
    expect(latestProof).not.toHaveBeenCalled();
    historyServiceMock.findLatestBlock.mockResolvedValue({ height: 123 });
    expect((await service.queryIBCHeader({ height: 0n, trusted_height: 99n, checkpoint_only: true, probabilistic_client_state: ClientStateProbabilistic.encode(context).finish() })).header).toBeUndefined();
  });

  it('serves exact rootless challenge evidence when the real block has no HostState transaction', async () => {
    historyServiceMock.findHostStateUtxoAtOrBeforeBlockNo.mockResolvedValue(null);
    historyServiceMock.findBridgeBlocks.mockResolvedValue([]);
    miniProtocalsServiceMock.fetchBlocksCbor.mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => Buffer.from([index + 1])),
    );
    const context = ClientStateProbabilistic.fromPartial({ storage_version: 2,
      slot_length_ns: 1_000_000_000n,
      current_epoch: 7n,
      latest_checkpoint_height: { revision_height: 99n },
      latest_checkpoint_settlement_credit: { epoch: 7n, reference: ['pool-a', 'pool-b', 'pool-c', 'pool-d', 'pool-e'].map((pool_id) => ({ pool_id, numerator: Uint8Array.of(1), denominator: Uint8Array.of(5) })) },
      latest_checkpoint_pool_production: { epoch: 7n, pools: ['pool-a', 'pool-b', 'pool-c', 'pool-d', 'pool-e'].map((pool_id) => ({ pool_id, completed_epochs_bitmap: 1, produced_current_epoch: false })) },
    });
    const response = await service.queryIBCHeader({ height: 100n, trusted_height: 99n, checkpoint_only: true, probabilistic_client_state: ClientStateProbabilistic.encode(context).finish() });
    const header = ProbabilisticHeader.decode(response.header!.value);
    expect(header.is_checkpoint).toBe(true);
    expect(header.anchor_block?.height?.revision_height).toBe(100n);
    expect(header.anchor_block?.block_cbor).toEqual(Buffer.from([1]));
    expect(header.anchor_block?.header_cbor).toHaveLength(0);
    expect(header.host_state_tx_hash).toBe('');
    expect(header.new_epoch_context).toBeUndefined();
    expect(historyServiceMock.findHostStateUtxoAtOrBeforeBlockNo).not.toHaveBeenCalled();
  });

  it('uses the destination credit reference when deciding whether an update can settle', async () => {
    historyServiceMock.findBridgeBlocks.mockResolvedValue([]);
    const client = ClientStateProbabilistic.fromPartial({ storage_version: 2,
      slot_length_ns: 1_000_000_000n,
      current_epoch: 7n,
      latest_checkpoint_height: { revision_height: 99n },
      latest_checkpoint_settlement_credit: { epoch: 7n, reference: [] },
      latest_checkpoint_pool_production: { epoch: 7n, pools: ['pool-a', 'pool-b', 'pool-c', 'pool-d', 'pool-e'].map((pool_id) => ({ pool_id, completed_epochs_bitmap: 1, produced_current_epoch: false })) },
    });
    // These five producers have enough submitted stake, but only 250 basis
    // points of settlement credit against this destination reference.
    await expect(
      service.queryIBCHeader({
        height: 100n,
        trusted_height: 99n,
        checkpoint_only: true,
        probabilistic_client_state: ClientStateProbabilistic.encode(client).finish(),
      }),
    ).rejects.toThrow('qualified unique stake');
    client.latest_checkpoint_height!.revision_height = 98n;
    await expect(
      service.queryIBCHeader({
        height: 100n,
        trusted_height: 99n,
        checkpoint_only: true,
        probabilistic_client_state: ClientStateProbabilistic.encode(client).finish(),
      }),
    ).rejects.toThrow('does not match trusted_height');
  });

  it('fits a minimum root update by keeping full CBOR only on its HostState anchor', async () => {
    historyServiceMock.findHostStateUtxoAtOrBeforeBlockNo.mockResolvedValue({
      txHash: 'host-state-tx',
      txId: 1,
      outputIndex: 0,
      address: 'addr_test1...',
      assetsPolicy: 'a'.repeat(56),
      assetsName: 'b'.repeat(64),
      datumHash: 'cd'.repeat(32),
      datum: 'datum-cbor',
      blockNo: 100,
      blockId: 100,
      index: 0,
    });
    historyServiceMock.findBridgeBlocks.mockResolvedValue([]);
    const fullBlockWitnesses = Array.from({ length: 25 }, (_, index) => Buffer.alloc(32 * 1024, index + 1));
    miniProtocalsServiceMock.fetchBlocksCbor.mockResolvedValue(fullBlockWitnesses);

    const response = await service.queryIBCHeader({ height: 100n, trusted_height: 99n } as any);
    const header = ProbabilisticHeader.decode(response.header!.value);
    const legacyHeader: ProbabilisticHeader = {
      ...header,
      anchor_block: {
        ...header.anchor_block!,
        block_cbor: fullBlockWitnesses[0],
        header_cbor: new Uint8Array(),
      },
      descendant_blocks: header.descendant_blocks.map((block, index) => ({
        ...block,
        block_cbor: fullBlockWitnesses[index + 1],
        header_cbor: new Uint8Array(),
      })),
    };

    expect(header.anchor_block!.block_cbor).toHaveLength(32 * 1024);
    expect(header.anchor_block!.header_cbor).toHaveLength(0);
    expect(header.descendant_blocks.every((block) => block.block_cbor.length === 0)).toBe(true);
    expect(header.descendant_blocks.every((block) => block.header_cbor.length === 860)).toBe(true);
    expect(response.header!.value.length).toBeLessThan(209_715);
    expect(ProbabilisticHeader.encode(legacyHeader).finish().length).toBeGreaterThan(768 * 1024);
  });

  it('returns a bounded rootless checkpoint when the requested HostState height is far ahead', async () => {
    const blockAt = (height: number) => {
      const slot = 1000n + BigInt(height - 100) * 10n;
      return {
        height,
        hash: `hash-${height}`,
        prevHash: `hash-${height - 1}`,
        slotNo: MATURE_POOL_SLOT + slot,
        epochNo: 7,
        timestampUnixNs: timestampForSlot(slot),
        slotLeader: `pool-${String.fromCharCode(97 + (height % 5))}`,
      };
    };

    historyServiceMock.findBlockByHeight.mockImplementation(async (height: bigint) => blockAt(Number(height)));
    historyServiceMock.findBridgeBlocks.mockImplementation(async (trustedHeight: bigint, anchorHeight: bigint) =>
      Array.from({ length: Number(anchorHeight - trustedHeight - 1n) }, (_, index) =>
        blockAt(Number(trustedHeight) + index + 1),
      ),
    );
    historyServiceMock.findDescendantBlocks.mockImplementation(async (anchorHeight: bigint) =>
      Array.from({ length: 24 }, (_, index) => blockAt(Number(anchorHeight) + index + 1)),
    );
    miniProtocalsServiceMock.fetchBlocksCbor.mockImplementation(async (blocks: unknown[]) =>
      blocks.map((_, index) => Buffer.from([index + 1])),
    );

    const response = await service.queryIBCHeader({ height: 200n, trusted_height: 100n } as any);
    const header = ProbabilisticHeader.decode(response.header!.value);

    expect(header.is_checkpoint).toBe(true);
    expect(header.trusted_height?.revision_height).toBe(100n);
    expect(header.anchor_block?.height?.revision_height).toBe(197n);
    expect(header.bridge_blocks).toHaveLength(96);
    expect(header.anchor_block?.block_cbor).toHaveLength(1);
    expect(header.anchor_block?.header_cbor).toHaveLength(0);
    expect(header.bridge_blocks.every((block) => block.block_cbor.length === 1)).toBe(true);
    expect(header.bridge_blocks.every((block) => block.header_cbor.length === 0)).toBe(true);
    expect(header.descendant_blocks.every((block) => block.block_cbor.length === 0)).toBe(true);
    expect(header.descendant_blocks.every((block) => block.header_cbor.length === 860)).toBe(true);
    expect(header.host_state_tx_hash).toBe('');
    expect(header.host_state_tx_output_index).toBe(0);
    expect(historyServiceMock.findHostStateUtxoAtOrBeforeBlockNo).not.toHaveBeenCalled();
  });

  it('resumes across an entirely idle epoch before returning the next HostState root', async () => {
    const targetHeight = 200n;
    const epochForHeight = (height: number) => {
      if (height <= 133) return 303;
      if (height <= 199) return 304;
      return 305;
    };
    const blockAt = (height: number) => {
      const slot = BigInt(height * 10);
      return {
        height,
        hash: `hash-${height}`,
        prevHash: `hash-${height - 1}`,
        slotNo: MATURE_POOL_SLOT + slot,
        epochNo: epochForHeight(height),
        timestampUnixNs: timestampForSlot(slot),
        slotLeader: `pool-${String.fromCharCode(97 + (height % 5))}`,
      };
    };
    const epochContext = (epoch: number) => {
      const [currentEpochStartSlot, currentEpochEndSlotExclusive] =
        epoch === 303 ? [1000n, 1340n] : epoch === 304 ? [1340n, 2000n] : [2000n, 4000n];
      return {
        epoch,
        stakeDistribution: [
          {
            poolId: 'pool-a',
            stake: 200n,
            relativeStakeNumerator: 1n,
            relativeStakeDenominator: 5n,
            vrfKeyHash: 'aa'.repeat(32),
            firstRegistrationSlot: 1n,
          },
          {
            poolId: 'pool-b',
            stake: 200n,
            relativeStakeNumerator: 1n,
            relativeStakeDenominator: 5n,
            vrfKeyHash: 'bb'.repeat(32),
            firstRegistrationSlot: 1n,
          },
          {
            poolId: 'pool-c',
            stake: 200n,
            relativeStakeNumerator: 1n,
            relativeStakeDenominator: 5n,
            vrfKeyHash: 'cc'.repeat(32),
            firstRegistrationSlot: 1n,
          },
          {
            poolId: 'pool-d',
            stake: 200n,
            relativeStakeNumerator: 1n,
            relativeStakeDenominator: 5n,
            vrfKeyHash: 'dd'.repeat(32),
            firstRegistrationSlot: 1n,
          },
          {
            poolId: 'pool-e',
            stake: 200n,
            relativeStakeNumerator: 1n,
            relativeStakeDenominator: 5n,
            vrfKeyHash: 'ee'.repeat(32),
            firstRegistrationSlot: 1n,
          },
        ],
        verificationContext: {
          epochNonce: epoch.toString(16).padStart(64, '0'),
          slotsPerKesPeriod: 129600,
          activeSlotCoefficientNumerator: 1n,
          activeSlotCoefficientDenominator: 20n,
          maxKesEvolutions: 62,
          currentEpochStartSlot: MATURE_POOL_SLOT + currentEpochStartSlot,
          currentEpochEndSlotExclusive: MATURE_POOL_SLOT + currentEpochEndSlotExclusive,
        },
      };
    };

    historyServiceMock.findBlockByHeight.mockImplementation(async (height: bigint) => blockAt(Number(height)));
    historyServiceMock.findBridgeBlocks.mockImplementation(async (trustedHeight: bigint, anchorHeight: bigint) =>
      Array.from({ length: Number(anchorHeight - trustedHeight - 1n) }, (_, index) =>
        blockAt(Number(trustedHeight) + index + 1),
      ),
    );
    historyServiceMock.findDescendantBlocks.mockImplementation(async (anchorHeight: bigint, limit: number) =>
      Array.from({ length: limit }, (_, index) => blockAt(Number(anchorHeight) + index + 1)),
    );
    historyServiceMock.findEpochContextAtBlock.mockImplementation(async (block: { epochNo: number }) =>
      epochContext(block.epochNo),
    );
    historyServiceMock.findHostStateUtxoAtOrBeforeBlockNo.mockImplementation(async (height: bigint) => {
      expect(height).toBe(targetHeight);
      return {
        txHash: 'host-state-epoch-305',
        txId: 2,
        outputIndex: 0,
        address: 'addr_test1...',
        assetsPolicy: 'a'.repeat(56),
        assetsName: 'b'.repeat(64),
        datumHash: 'ef'.repeat(32),
        datum: 'datum-cbor',
        blockNo: Number(targetHeight),
        blockId: Number(targetHeight),
        index: 0,
      };
    });
    miniProtocalsServiceMock.fetchBlocksCbor.mockImplementation(async (blocks: unknown[]) =>
      blocks.map((_, index) => Buffer.from([index + 1])),
    );

    const headers: ProbabilisticHeader[] = [];
    let trustedHeight = 100n;
    for (let attempt = 0; attempt < 10 && trustedHeight < targetHeight; attempt += 1) {
      const response = await service.queryIBCHeader({ height: targetHeight, trusted_height: trustedHeight } as any);
      const header = ProbabilisticHeader.decode(response.header!.value);
      const anchorHeight = header.anchor_block!.height!.revision_height;
      const trustedEpoch = epochForHeight(Number(trustedHeight));
      const anchorEpoch = epochForHeight(Number(anchorHeight));

      expect(anchorHeight).toBeGreaterThan(trustedHeight);
      expect(anchorHeight).toBeLessThanOrEqual(targetHeight);
      expect(header.bridge_blocks).toHaveLength(Number(anchorHeight - trustedHeight - 1n));
      expect(header.bridge_blocks.length).toBeLessThanOrEqual(96);
      expect(response.header!.value.length).toBeLessThanOrEqual(768 * 1024);
      expect(anchorEpoch - trustedEpoch).toBeLessThanOrEqual(1);
      if (anchorEpoch !== trustedEpoch) {
        expect(header.new_epoch_context?.epoch).toBe(BigInt(anchorEpoch));
      } else {
        if (header.new_epoch_context) { expect(header.new_epoch_context.epoch).toBe(BigInt(anchorEpoch + 1)); expect(header.descendant_blocks.some((block) => block.epoch === BigInt(anchorEpoch + 1))).toBe(true); }
      }

      if (anchorHeight < targetHeight) {
        expect(header.is_checkpoint).toBe(true);
        expect(header.host_state_tx_hash).toBe('');
        expect(header.host_state_tx_output_index).toBe(0);
      } else {
        expect(header.is_checkpoint).toBe(false);
        expect(header.host_state_tx_hash).toBe('');
      }

      headers.push(header);
      trustedHeight = anchorHeight;
    }

    expect(trustedHeight).toBe(targetHeight);
    expect(headers.map((header) => header.anchor_block!.height!.revision_height)).toEqual([175n, 200n]);
    expect(
      headers.some(
        (header) =>
          header.is_checkpoint && epochForHeight(Number(header.anchor_block!.height!.revision_height)) === 304,
      ),
    ).toBe(true);
    expect(headers.slice(0, -1).every((header) => header.is_checkpoint && header.host_state_tx_hash === '')).toBe(true);
    expect(historyServiceMock.findHostStateUtxoAtOrBeforeBlockNo).not.toHaveBeenCalled();
  });

  it.each([
 { bodyBytes: 24 * 1024 },
 { bodyBytes: 40 * 1024 },
 ])('builds a complete logical workload with $bodyBytes-byte bodies', async ({ bodyBytes }) => {
    const blockAt = (height: number) => {
      const slot = 1000n + BigInt(height - 100) * 10n;
      return {
        height,
        hash: `hash-${height}`,
        prevHash: `hash-${height - 1}`,
        slotNo: MATURE_POOL_SLOT + slot,
        epochNo: 7,
        timestampUnixNs: timestampForSlot(slot),
        slotLeader: `pool-${String.fromCharCode(97 + (height % 5))}`,
      };
    };

    historyServiceMock.findBlockByHeight.mockImplementation(async (height: bigint) => blockAt(Number(height)));
    historyServiceMock.findBridgeBlocks.mockImplementation(async (trustedHeight: bigint, anchorHeight: bigint) =>
      Array.from({ length: Number(anchorHeight - trustedHeight - 1n) }, (_, index) =>
        blockAt(Number(trustedHeight) + index + 1),
      ),
    );
    historyServiceMock.findDescendantBlocks.mockImplementation(async (anchorHeight: bigint) =>
      Array.from({ length: 24 }, (_, index) => blockAt(Number(anchorHeight) + index + 1)),
    );
    miniProtocalsServiceMock.fetchBlocksCbor.mockImplementation(async (blocks: unknown[]) =>
      blocks.map(() => Buffer.alloc(bodyBytes, 1)),
    );

    const response = await service.queryIBCHeader({ height: 200n, trusted_height: 100n } as any);
    const header = ProbabilisticHeader.decode(response.header!.value);

    expect(header.is_checkpoint).toBe(true);
    const distance = Number(header.anchor_block!.height!.revision_height - 100n);
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBe(97);
    expect(header.bridge_blocks).toHaveLength(distance - 1);
    expect(header.anchor_block!.block_cbor).toHaveLength(bodyBytes);
    expect(header.anchor_block!.header_cbor).toHaveLength(0);
    expect(
      header.bridge_blocks.every((block) => block.block_cbor.length === bodyBytes && block.header_cbor.length === 0),
    ).toBe(true);
    expect(response.header!.value).toHaveLength(ProbabilisticHeader.encode(header).finish().length);
    expect(response.header!.value.length).toBeGreaterThan(900_000);
    expect(miniProtocalsServiceMock.fetchBlocksCbor).toHaveBeenCalledTimes(1);
  });

  it('does not return the live HostState tx height as latest stability height when the root was not accepted', async () => {
    lucidServiceMock.findUtxoAtHostStateNFT.mockResolvedValue({
      txHash: 'live-host-state-tx',
      outputIndex: 0,
      datum: 'datum-cbor',
    });
    historyServiceMock.findTransactionEvidenceByHash.mockResolvedValue({
      txHash: 'live-host-state-tx',
      blockNo: 1136,
      txIndex: 0,
      txCborHex: '',
      txBodyCborHex: '',
      redeemers: [],
    });
    historyServiceMock.findHostStateUtxoAtOrBeforeBlockNo.mockResolvedValue({
      txHash: 'live-host-state-tx',
      txId: 1,
      outputIndex: 0,
      address: 'addr_test1...',
      assetsPolicy: 'a'.repeat(56),
      assetsName: 'b'.repeat(64),
      datumHash: 'cd'.repeat(32),
      datum: 'datum-cbor',
      blockNo: 1136,
      blockId: 1136,
      index: 0,
    });
    historyServiceMock.findBlockByHeight.mockResolvedValue({
      height: 1136,
      hash: 'hash-1136',
      prevHash: 'hash-1135',
      slotNo: MATURE_POOL_SLOT + 4452n,
      epochNo: 0,
      timestampUnixNs: timestampForSlot(4452n),
      slotLeader: 'pool-a',
    });
    historyServiceMock.findDescendantBlocks.mockResolvedValue([]);
    historyServiceMock.findEpochContextAtBlock.mockRejectedValue(
      new Error('Failed to acquire requested point. Target point is too old.'),
    );

    await expect(service.latestCertifiedHeight()).rejects.toThrow('Failed to acquire requested point');
  });

  it('authenticates full blocks at an anchor without a HostState write', async () => {
    const response = await service.queryIBCHeader({ height: 100n, trusted_height: 98n } as any);
    const header = ProbabilisticHeader.decode(response.header!.value);
    expect(header.anchor_block?.block_cbor).toHaveLength(1);
    expect(header.bridge_blocks.every((block) => block.block_cbor.length === 1)).toBe(true);
    expect(header.host_state_tx_hash).toBe('');
    expect(historyServiceMock.findHostStateUtxoAtOrBeforeBlockNo).not.toHaveBeenCalled();
  });

  it('keeps the logical catch-up window for staged observations with large bodies', async () => {
    const blockAt = (height: number) => {
      const slot = 1000n + BigInt(height - 100) * 10n;
      return { height, hash: `hash-${height}`, prevHash: `hash-${height - 1}`, slotNo: MATURE_POOL_SLOT + slot,
        epochNo: 7, timestampUnixNs: timestampForSlot(slot), slotLeader: `pool-${String.fromCharCode(97 + (height % 5))}` };
    };
    historyServiceMock.findBlockByHeight.mockImplementation(async (height: bigint) => blockAt(Number(height)));
    historyServiceMock.findBridgeBlocks.mockImplementation(async (trusted: bigint, anchor: bigint) =>
      Array.from({ length: Number(anchor - trusted - 1n) }, (_, index) => blockAt(Number(trusted) + index + 1)));
    historyServiceMock.findDescendantBlocks.mockImplementation(async (anchor: bigint) =>
      Array.from({ length: 24 }, (_, index) => blockAt(Number(anchor) + index + 1)));
    miniProtocalsServiceMock.fetchBlocksCbor.mockImplementation(async (blocks: unknown[]) =>
      blocks.map(() => Buffer.alloc(80 * 1024, 1)));
    const context = ClientStateProbabilistic.fromPartial({ storage_version: 2, current_epoch: 7n,
      slot_length_ns: 1_000_000_000n, latest_checkpoint_height: { revision_height: 100n },
      latest_checkpoint_settlement_credit: { epoch: 7n, reference: ['pool-a', 'pool-b', 'pool-c', 'pool-d', 'pool-e'].map((pool_id) => ({ pool_id, numerator: Uint8Array.of(1), denominator: Uint8Array.of(5) })) },
      latest_checkpoint_pool_production: { epoch: 7n, pools: ['pool-a', 'pool-b', 'pool-c', 'pool-d', 'pool-e'].map((pool_id) => ({ pool_id, completed_epochs_bitmap: 1, produced_current_epoch: false })) },
    });
    const response = await service.queryIBCHeader({ height: 200n, trusted_height: 100n, checkpoint_only: false,
      probabilistic_client_state: ClientStateProbabilistic.encode(context).finish() });
    const header = ProbabilisticHeader.decode(response.header!.value);
    expect(header.anchor_block!.height!.revision_height).toBe(197n);
    expect(header.bridge_blocks).toHaveLength(96);
    expect(response.header!.value.length).toBeGreaterThan(5 * 1024 * 1024 / 2);
    expect(header.descendant_blocks).toHaveLength(24);
    expect(header.descendant_blocks.every((block) => block.block_cbor.length === 0)).toBe(true);
    expect(historyServiceMock.findObservedPoolProductionAtBlock).not.toHaveBeenCalled();
  });
});

describe('historical Hermes challenge request', () => {
  const fixture = JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        '../../../../../cosmos/cardano-probabilistic-light-client-core/testdata/challenge-settlement.json',
      ),
      'utf8',
    ),
  );

  it('requires saved context instead of falling back to observer estimates', async () => {
    await expect(
      service.queryIBCHeader({
        height: 100n,
        trusted_height: 99n,
        checkpoint_only: true,
        probabilistic_client_state: new Uint8Array(),
      }),
    ).rejects.toThrow('Historical destination client context is required');
    expect(historyServiceMock.findObservedPoolProductionAtBlock).not.toHaveBeenCalled();
  });

  it('serves enough descendants under the historical production and capped credit rules', async () => {
    // Start with the protobuf request from the Hermes challenge test. Its
    // epoch is restored from the pre-proposal rootless snapshot. Advance the
    // fixture chain point so its producers also meet the rolling age rule.
    const request = QueryIBCHeaderRequest.decode(Buffer.from(fixture.request_hex, 'hex'));
    const context = ClientStateProbabilistic.decode(request.probabilistic_client_state);
    context.storage_version = 2;
    context.latest_checkpoint_slot += MATURE_POOL_SLOT;
    context.latest_checkpoint_timestamp = timestampForSlot(990n);
    context.epoch_contexts[0].epoch_start_slot += MATURE_POOL_SLOT;
    context.epoch_contexts[0].epoch_end_slot_exclusive += MATURE_POOL_SLOT;
    request.probabilistic_client_state = ClientStateProbabilistic.encode(context).finish();
    expect(context.current_epoch).toBe(7n);
    expect(context.latest_checkpoint_height?.revision_height).toBe(99n);
    expect(context.latest_checkpoint_settlement_credit?.reference).toEqual([]);
    historyServiceMock.findBridgeBlocks.mockResolvedValue([]);
    historyServiceMock.findEpochContextAtBlock.mockResolvedValue({
      epoch: 7,
      stakeDistribution: context.epoch_contexts[0].stake_distribution.map((row) => ({
        poolId: row.pool_id,
        stake: row.stake,
        relativeStakeNumerator: row.relative_stake_numerator,
        relativeStakeDenominator: row.relative_stake_denominator,
        vrfKeyHash: Buffer.from(row.vrf_key_hash).toString('hex'),
        firstRegistrationSlot: row.first_registration_slot,
      })),
      verificationContext: {
        epochNonce: '11'.repeat(32),
        slotsPerKesPeriod: 129600,
        activeSlotCoefficientNumerator: 1n,
        activeSlotCoefficientDenominator: 20n,
        maxKesEvolutions: 62,
        currentEpochStartSlot: MATURE_POOL_SLOT + 900n,
        currentEpochEndSlotExclusive: MATURE_POOL_SLOT + 3000n,
      },
    });
    const descendants = (producers: string[]) =>
      producers.map((slotLeader, index) => ({
        ...stabilityDescendantBlocks[index % 24],
        height: 101 + index,
        hash: `hash-${101 + index}`,
        prevHash: index === 0 ? 'anchor-hash' : `hash-${100 + index}`,
        slotNo: MATURE_POOL_SLOT + 1010n + BigInt(index) * 10n,
        timestampUnixNs: timestampForSlot(1010n + BigInt(index) * 10n),
        slotLeader,
      }));
    historyServiceMock.findDescendantBlocks.mockResolvedValue(descendants(fixture.short_descendants));
    await expect(service.queryIBCHeader(request)).rejects.toThrow('qualified unique stake');
    historyServiceMock.findDescendantBlocks.mockResolvedValue(descendants(fixture.long_descendants));
    miniProtocalsServiceMock.fetchBlocksCbor.mockImplementation(async (blocks: unknown[]) =>
      blocks.map((_, index) => Buffer.from([index + 1])),
    );
    const response = await service.queryIBCHeader(request);
    const header = ProbabilisticHeader.decode(response.header!.value);
    expect(header.is_checkpoint).toBe(true);
    expect(header.anchor_block?.height?.revision_height).toBe(100n);
    expect(header.descendant_blocks).toHaveLength(fixture.long_descendants.length);
    expect(historyServiceMock.findObservedPoolProductionAtBlock).not.toHaveBeenCalled();
  });
});

// These witnesses also run through native verification and both SDK keepers.
describe('native epoch-boundary catch-up', () => {
  for (const name of ['size', 'count', 'control', 'combined']) {
    it(`advances the ${name} case within the supported encoded budget`, async () => {
      const path = resolve(process.cwd(), '../../cosmos/cardano-probabilistic-light-client-core/testdata');
      const fixture = JSON.parse(gunzipSync(readFileSync(`${path}/native-boundary-${name}.json.gz`)).toString());
      const original = ProbabilisticHeader.fromJSON(fixture.header);
      const client = ClientStateProbabilistic.fromJSON(fixture.size_client ?? fixture.client);
      client.storage_version = 2;
      const trustedHeight = client.latest_checkpoint_height!.revision_height;
      const fullBlocks = [...original.bridge_blocks, original.anchor_block!, ...original.descendant_blocks];
      const records = fullBlocks.map((block) => ({
        height: Number(block.height!.revision_height), hash: block.hash,
        prevHash: '', slotNo: block.slot, epochNo: Number(block.epoch), timestampUnixNs: block.timestamp,
        slotLeader: client.epoch_stake_distribution[(name === 'count' || name === 'combined') && block.epoch === 7n
          ? (block.height!.revision_height < 977n ? Number(block.height!.revision_height - 966n) : 0)
          : Number((block.height!.revision_height - 967n) % 11n)].pool_id,
      }));
      const trusted = { height: Number(trustedHeight), hash: client.latest_checkpoint_block_hash,
        slotNo: client.latest_checkpoint_slot, epochNo: 7, timestampUnixNs: client.latest_checkpoint_timestamp,
        slotLeader: client.epoch_stake_distribution[0].pool_id, prevHash: '' };
      historyServiceMock.findBlockByHeight.mockImplementation(async (height) => records.find((block) => BigInt(block.height) === height) ?? (height === trustedHeight ? trusted : null));
      historyServiceMock.findBridgeBlocks.mockImplementation(async (from, to) => records.filter((block) => BigInt(block.height) > from && BigInt(block.height) < to));
      historyServiceMock.findDescendantBlocks.mockImplementation(async (height, limit) => records.filter((block) => BigInt(block.height) > height).slice(0, limit));
      historyServiceMock.findEpochContextAtBlock.mockImplementation(async (block) => {
        const context = (block.epochNo === 8 ? original.new_epoch_context : client.epoch_contexts[0])!;
        return {
          epoch: block.epochNo,
          stakeDistribution: context.stake_distribution.map((entry) => ({
            poolId: entry.pool_id, stake: entry.stake, relativeStakeNumerator: entry.relative_stake_numerator,
            relativeStakeDenominator: entry.relative_stake_denominator, vrfKeyHash: Buffer.from(entry.vrf_key_hash).toString('hex'), firstRegistrationSlot: entry.first_registration_slot,
          })),
          verificationContext: {
            epochNonce: Buffer.from(context.epoch_nonce).toString('hex'), slotsPerKesPeriod: Number(context.slots_per_kes_period),
            activeSlotCoefficientNumerator: 1n, activeSlotCoefficientDenominator: 20n, maxKesEvolutions: 62,
            currentEpochStartSlot: context.epoch_start_slot, currentEpochEndSlotExclusive: context.epoch_end_slot_exclusive,
          },
        };
      });
      miniProtocalsServiceMock.fetchBlocksCbor.mockImplementation(async (blocks: Array<{ hash: string }>) => blocks.map((block) => Buffer.from(fullBlocks.find((witness) => witness.hash === block.hash)!.block_cbor)));
      miniProtocalsServiceMock.extractBlockHeaderCbor.mockImplementation((body, hash) => MiniProtocalsService.prototype.extractBlockHeaderCbor(body, hash));
      const response = await service.queryStabilityIBCHeader({
        height: 1031n, trusted_height: trustedHeight, checkpoint_only: false,
        probabilistic_client_state: ClientStateProbabilistic.encode(client).finish(),
      });
      const header = ProbabilisticHeader.decode(response.header!.value);
      expect(header.anchor_block!.epoch).toBe(8n);
      expect(header.is_checkpoint).toBe(true);
      expect(header.descendant_blocks.length).toBeGreaterThanOrEqual(24);
      expect(response.header!.value.length).toBeLessThanOrEqual(12 * 1024 * 1024);
      if (name === 'control') expect(response.header!.value.length).toBeLessThan(768 * 1024);
      else expect(response.header!.value.length).toBeGreaterThan(768 * 1024);
      if (name === 'count') expect(header.bridge_blocks.length).toBeGreaterThan(32);
      if (name === 'combined') { expect(header.anchor_block!.height!.revision_height).toBe(1007n); expect(header.new_epoch_context!.epoch).toBe(8n); }
      if (process.env.UPDATE_NATIVE_BOUNDARY_FIXTURE === '1') writeFileSync(`${path}/gateway-boundary-${name}.pb.gz`, gzipSync(response.header!.value));
      expect(Buffer.from(response.header!.value)).toEqual(gunzipSync(readFileSync(`${path}/gateway-boundary-${name}.pb.gz`)));

    });
  }
});


describe('bounded boundary workload', () => {
  const workloads = [40, 80, 96].flatMap((kib) =>
    [34, 64, 96].flatMap((tail) => [0, 12, 24].map((delay) => ({ kib, tail, delay }))),
  );
  it.each(workloads)(
    'advances with $tail tail blocks, $kib KiB bodies and $delay delayed qualified blocks',
    async ({ kib, tail, delay }) => {
      const path = resolve(process.cwd(), '../../cosmos/cardano-probabilistic-light-client-core/testdata');
      const fixture = JSON.parse(gunzipSync(readFileSync(`${path}/native-boundary-combined.json.gz`)).toString());
      const client = ClientStateProbabilistic.fromJSON(fixture.client);
      client.storage_version = 2;
      const original = ProbabilisticHeader.fromJSON(fixture.header);
      const trusted = 966;
      const firstNext = trusted + tail + 1;
      const context = (epoch: number) => {
        const row = epoch === 7 ? client.epoch_contexts[0] : original.new_epoch_context!;
        return {
          epoch,
          stakeDistribution: row.stake_distribution.map((entry) => ({
            poolId: entry.pool_id,
            stake: entry.stake,
            relativeStakeNumerator: entry.relative_stake_numerator,
            relativeStakeDenominator: entry.relative_stake_denominator,
            vrfKeyHash: Buffer.from(entry.vrf_key_hash).toString('hex'),
            firstRegistrationSlot: entry.first_registration_slot,
          })),
          verificationContext: {
            epochNonce: Buffer.from(row.epoch_nonce).toString('hex'),
            slotsPerKesPeriod: Number(row.slots_per_kes_period),
            maxKesEvolutions: 62,
            activeSlotCoefficientNumerator: 1n,
            activeSlotCoefficientDenominator: 20n,
            currentEpochStartSlot: row.epoch_start_slot,
            currentEpochEndSlotExclusive: row.epoch_end_slot_exclusive,
          },
        };
      };
      const at = (height: number) => {
        const epoch = height < firstNext ? 7 : 8;
        const slot = client.current_epoch_end_slot_exclusive + BigInt(height - firstNext) * 10n;
        const index = epoch === 7 || height < firstNext + delay ? 0 : (height - firstNext - delay) % 11;
        return {
          height,
          hash: `block-${height}`,
          prevHash: `block-${height - 1}`,
          slotNo: slot,
          epochNo: epoch,
          timestampUnixNs: client.system_start_unix_ns + slot * client.slot_length_ns,
          slotLeader: client.epoch_stake_distribution[index].pool_id,
        };
      };
      client.latest_checkpoint_slot = at(trusted).slotNo;
      client.latest_checkpoint_timestamp = at(trusted).timestampUnixNs;
      historyServiceMock.findBlockByHeight.mockImplementation(async (height) => at(Number(height)));
      historyServiceMock.findBridgeBlocks.mockImplementation(async (from: bigint, to: bigint) =>
        Array.from({ length: Number(to - from - 1n) }, (_, i) => at(Number(from) + i + 1)),
      );
      historyServiceMock.findDescendantBlocks.mockImplementation(async (height, limit) =>
        Array.from({ length: limit }, (_, i) => at(Number(height) + i + 1)),
      );
      historyServiceMock.findEpochContextAtBlock.mockImplementation(async (block) => context(block.epochNo));
      miniProtocalsServiceMock.fetchBlocksCbor.mockImplementation(async (blocks) =>
        blocks.map(() => Buffer.alloc(kib * 1024)),
      );
      miniProtocalsServiceMock.extractBlockHeaderCbor.mockImplementation(() => Buffer.alloc(1000));
      const attempt = service.queryStabilityIBCHeader({
        height: BigInt(firstNext),
        trusted_height: 966n,
        checkpoint_only: false,
        probabilistic_client_state: ClientStateProbabilistic.encode(client).finish(),
      });
      const response = await attempt;
      const header = ProbabilisticHeader.decode(response.header!.value);
      expect(header.anchor_block!.height!.revision_height).toBeGreaterThan(966n);
      expect(response.header!.value.length).toBeLessThanOrEqual(97 * (96 * 1024 + 512) + 31 * 2048 + 2_000_000);
      expect(1 + header.bridge_blocks.length + header.descendant_blocks.length).toBeLessThanOrEqual(128);
      if (header.anchor_block!.epoch === 7n) {
        expect(header.new_epoch_context!.epoch).toBe(8n);
        expect(
          [...header.bridge_blocks, header.anchor_block!].reduce((sum, block) => sum + block.block_cbor.length, 0),
        ).toBeLessThanOrEqual(97 * 96 * 1024);
      }
    },
  );
});

// Opt-in process used by the native Injective checkpoint acceptance driver.
// QueryService and the gRPC wire are real. Signed history replaces external
// Cardano history and block-body services in this disposable fixture.
(process.env.CHECKPOINT_ACCEPTANCE_DIR ? it : it.skip)(
  'serves signed idle history for the Hermes checkpoint acceptance worker',
  async () => {
    const root = process.env.CHECKPOINT_ACCEPTANCE_DIR!;
    const client = ClientStateProbabilistic.decode(readFileSync(`${root}/source-client.pb`));
    const history = JSON.parse(readFileSync(`${root}/gateway-history.json`, 'utf8'));
    let blocks = history.blocks.map((entry: any) => ProbabilisticBlock.decode(Buffer.from(entry.protobuf, 'hex')));
    let contexts = [
      client.epoch_contexts[0],
      ...history.contexts.map((raw: string) => EpochContext.decode(Buffer.from(raw, 'hex'))),
    ];
    const recordsFor = (items: any[]) =>
      items.map((block: any) => ({
        height: Number(block.height.revision_height),
        hash: block.hash,
        prevHash: '',
        slotNo: block.slot,
        epochNo: Number(block.epoch),
        timestampUnixNs: block.timestamp,
        slotLeader: client.epoch_stake_distribution[Number((block.height.revision_height - 967n) % 11n)].pool_id,
      }));
    let records = recordsFor(blocks);
    const sourceText = readFileSync(`${root}/source-history.json`, 'utf8').replace(
      /(:\s*)([0-9]{16,})(?=[,}])/g,
      '$1"$2"',
    );
    const later = JSON.parse(sourceText).Later;
    let switched = false;
    const selectBranch = () => {
      if (process.env.CHECKPOINT_GATEWAY_WITNESS === '1' && existsSync(`${root}/witness-fork`) && !switched) {
        blocks = later.Blocks.map((block: any) => ProbabilisticBlock.fromJSON(block));
        contexts = [client.epoch_contexts[0], ...later.Contexts.map((context: any) => EpochContext.fromJSON(context))];
        records = recordsFor(blocks);
        switched = true;
      }
    };
    const trusted = {
      height: 966,
      hash: client.latest_checkpoint_block_hash,
      prevHash: '',
      slotNo: client.latest_checkpoint_slot,
      epochNo: 7,
      timestampUnixNs: client.latest_checkpoint_timestamp,
      slotLeader: client.epoch_stake_distribution[0].pool_id,
    };
    const visible = () => Number(readFileSync(`${root}/source-tip`, 'utf8').trim());
    historyServiceMock.findLatestBlock.mockImplementation(
      async () => records.find((block: any) => block.height === visible()) ?? trusted,
    );
    historyServiceMock.findBlockByHeight.mockImplementation(async (height: bigint) =>
      height === 966n
        ? trusted
        : (records.find((block: any) => BigInt(block.height) === height && block.height <= visible()) ?? null),
    );
    historyServiceMock.findBridgeBlocks.mockImplementation(async (from: bigint, to: bigint) =>
      records.filter(
        (block: any) => BigInt(block.height) > from && BigInt(block.height) < to && block.height <= visible(),
      ),
    );
    historyServiceMock.findDescendantBlocks.mockImplementation(async (height: bigint, limit: number) =>
      records.filter((block: any) => BigInt(block.height) > height && block.height <= visible()).slice(0, limit),
    );
    historyServiceMock.findEpochContextAtBlock.mockImplementation(async (block: any) => {
      const context = contexts.find((context: any) => context.epoch === BigInt(block.epochNo));
      return {
        epoch: block.epochNo,
        stakeDistribution: context.stake_distribution.map((row: any) => ({
          poolId: row.pool_id,
          stake: row.stake,
          relativeStakeNumerator: row.relative_stake_numerator,
          relativeStakeDenominator: row.relative_stake_denominator,
          vrfKeyHash: Buffer.from(row.vrf_key_hash).toString('hex'),
          firstRegistrationSlot: row.first_registration_slot,
        })),
        verificationContext: {
          epochNonce: Buffer.from(context.epoch_nonce).toString('hex'),
          slotsPerKesPeriod: Number(context.slots_per_kes_period),
          activeSlotCoefficientNumerator: client.active_slot_coefficient_numerator,
          activeSlotCoefficientDenominator: client.active_slot_coefficient_denominator,
          maxKesEvolutions: Number(client.max_kes_evolutions),
          currentEpochStartSlot: context.epoch_start_slot,
          currentEpochEndSlotExclusive: context.epoch_end_slot_exclusive,
        },
      };
    });
    miniProtocalsServiceMock.fetchBlocksCbor.mockImplementation(async (requested: Array<{ hash: string }>) =>
      requested.map((block) => Buffer.from(blocks.find((witness: any) => witness.hash === block.hash).block_cbor)),
    );
    miniProtocalsServiceMock.extractBlockHeaderCbor.mockImplementation((body, hash) =>
      MiniProtocalsService.prototype.extractBlockHeaderCbor(body, hash),
    );
    const get = (service as any).configService.get as jest.Mock;
    const fallback = get.getMockImplementation()!;
    get.mockImplementation((key) =>
      key === 'cardanoRandomnessStabilisationWindowSlots'
        ? String(client.randomness_stabilisation_window_slots)
        : fallback(key),
    );
    const server = new grpc.Server();
    const method = {
      path: '/ibc.core.types.v1.Query/IBCHeader',
      requestStream: false,
      responseStream: false,
      requestSerialize: (value: any) => Buffer.from(QueryIBCHeaderRequest.encode(value).finish()),
      requestDeserialize: (bytes: Buffer) => QueryIBCHeaderRequest.decode(bytes),
      responseSerialize: (value: any) => Buffer.from(QueryIBCHeaderResponse.encode(value).finish()),
      responseDeserialize: (bytes: Buffer) => QueryIBCHeaderResponse.decode(bytes),
    };
    server.addService(
      { IBCHeader: method },
      {
        IBCHeader: async (call: any, callback: any) => {
          try {
            selectBranch();
            const response = await service.queryStabilityIBCHeader(call.request);
            if (response.header) {
              const header = ProbabilisticHeader.decode(response.header.value);
              appendFileSync(
                `${root}/gateway-${process.env.CHECKPOINT_GATEWAY_PORT ?? '15001'}.jsonl`,
                JSON.stringify({
                  trusted: String(header.trusted_height?.revision_height),
                  anchor: String(header.anchor_block?.height?.revision_height),
                  checkpoint: header.is_checkpoint,
                  epoch: String(header.new_epoch_context?.epoch ?? ''),
                }) + '\n',
              );
            }
            callback(null, response);
          } catch (error) {
            console.error(error);
            callback({ code: grpc.status.FAILED_PRECONDITION, message: String(error) });
          }
        },
      },
    );
    await new Promise<void>((resolve, reject) =>
      server.bindAsync(
        `127.0.0.1:${process.env.CHECKPOINT_GATEWAY_PORT ?? '15001'}`,
        grpc.ServerCredentials.createInsecure(),
        (error: Error) => (error ? reject(error) : resolve()),
      ),
    );
    writeFileSync(`${root}/gateway-${process.env.CHECKPOINT_GATEWAY_PORT ?? '15001'}.ready`, 'ready');
    try {
      while (!existsSync(`${root}/gateway.stop`)) await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      server.forceShutdown();
    }
  },
  12 * 3_600_000,
);
