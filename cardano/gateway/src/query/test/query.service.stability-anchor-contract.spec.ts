import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ClientState as ClientStateProbabilistic,
  ConsensusState as ConsensusStateProbabilistic,
  ProbabilisticHeader,
} from '@cardano-ibc/proto-types/build/ibc/lightclients/probabilistic/v1/probabilistic';
import { QueryService } from '../services/query.service';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { MiniProtocalsService } from '../../shared/modules/mini-protocals/mini-protocals.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { DenomTraceService } from '../services/denom-trace.service';
import { HistoryService } from '../services/history.service';
import { bech32 } from 'bech32';

const STABILITY_SLOT_ORIGIN_NS = 1_700_000_000_000_000_000n;
const timestampForSlot = (slot: bigint) => STABILITY_SLOT_ORIGIN_NS + slot * 1_000_000_000n;
const operationalCertificatePoolId = (byte: number) => bech32.encode('pool', bech32.toWords(Buffer.alloc(28, byte)));
const stabilityDescendantBlocks = Array.from({ length: 24 }, (_, index) => {
  const height = 101 + index;
  const slot = 1000n + BigInt(index + 1) * 10n;
  return {
    height,
    hash: `hash-${height}`,
    prevHash: index === 0 ? 'anchor-hash' : `hash-${height - 1}`,
    slotNo: slot,
    epochNo: 7,
    timestampUnixNs: timestampForSlot(slot),
    slotLeader: `pool-${String.fromCharCode(97 + (index % 5))}`,
  };
});

describe('QueryService stability anchor contract', () => {
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
    findEpochContextAtBlock: jest.Mock;
    findOperationalCertificateCountersAtBlock: jest.Mock;
    findBridgeBlocks: jest.Mock;
    findHostStateUtxoAtOrBeforeBlockNo: jest.Mock;
    findTransactionEvidenceByHash: jest.Mock;
  };
  let miniProtocalsServiceMock: {
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
        if (key === 'cardanoLightClientMode') return 'stake-weighted-stability';
        if (key === 'cardanoChainId') return 'cardano-devnet';
        if (key === 'cardanoNetwork') return 'Preview';
        if (key === 'cardanoClientMaxClockDriftSeconds') return 17;
        if (key === 'deployment') {
          return {
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
      findLatestBlock: jest.fn().mockResolvedValue({
        height: 105,
        hash: 'latest-hash',
        prevHash: 'hash-104',
        slotNo: 1050n,
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
            slotNo: 980n,
            epochNo: 7,
            timestampUnixNs: timestampForSlot(980n),
            slotLeader: 'pool-z',
          };
        }
        return {
          height: 100,
          hash: 'anchor-hash',
          prevHash: 'prev-hash',
          slotNo: 1000n,
          epochNo: 7,
          timestampUnixNs: timestampForSlot(1000n),
          slotLeader: 'pool-a',
        };
      }),
      findDescendantBlocks: jest.fn().mockResolvedValue(stabilityDescendantBlocks),
      findEpochContextAtBlock: jest.fn().mockResolvedValue({
        epoch: 7,
        stakeDistribution: [
          { poolId: 'pool-a', stake: 200n, vrfKeyHash: 'aa'.repeat(32), firstRegistrationSlot: 1n },
          { poolId: 'pool-b', stake: 200n, vrfKeyHash: 'bb'.repeat(32), firstRegistrationSlot: 1n },
          { poolId: 'pool-c', stake: 200n, vrfKeyHash: 'cc'.repeat(32), firstRegistrationSlot: 1n },
          { poolId: 'pool-d', stake: 200n, vrfKeyHash: 'dd'.repeat(32), firstRegistrationSlot: 1n },
          { poolId: 'pool-e', stake: 200n, vrfKeyHash: 'ee'.repeat(32), firstRegistrationSlot: 1n },
        ],
        verificationContext: {
          epochNonce: '11'.repeat(32),
          slotsPerKesPeriod: 129600,
          maxKesEvolutions: 62,
          currentEpochStartSlot: 900n,
          currentEpochEndSlotExclusive: 3000n,
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
          slotNo: 990n,
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
      decodeDatum: jest.fn(),
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
      fetchBlocksCbor: jest.fn(),
      extractBlockHeaderCbor: jest.fn((blockCbor: Buffer) => Buffer.alloc(860, blockCbor[0] ?? 0)),
    };

    service = new QueryService(
      loggerMock as unknown as Logger,
      configServiceMock,
      lucidServiceMock as unknown as LucidService,
      {} as KupoService,
      historyServiceMock as unknown as HistoryService,
      miniProtocalsServiceMock as unknown as MiniProtocalsService,
      {} as MithrilService,
      {} as DenomTraceService,
      {} as any,
    );
  });

  it('rejects stability new-client creation when requested anchor height is not a HostState tx block', async () => {
    await expect(service.queryNewClient({ height: 100n } as any)).rejects.toThrow(
      'requested stability anchor height 100 is not a HostState tx block height',
    );
  });

  it('populates flattened epoch verifier fields in the initial probabilistic client payload', async () => {
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
    lucidServiceMock.decodeDatum.mockResolvedValue({
      state: {
        ibc_state_root: 'ab'.repeat(32),
      },
    });

    const response = await service.queryNewClient({ height: 100n } as any);
    const clientState = ClientStateProbabilistic.decode(response.client_state!.value);
    const consensusState = ConsensusStateProbabilistic.decode(response.consensus_state!.value);

    expect(clientState.epoch_contexts).toHaveLength(1);
    expect(clientState.epoch_nonce).toHaveLength(32);
    expect(clientState.epoch_nonce).toEqual(clientState.epoch_contexts[0].epoch_nonce);
    expect(clientState.epoch_stake_distribution).toEqual(clientState.epoch_contexts[0].stake_distribution);
    expect(clientState.slots_per_kes_period).toBe(129600n);
    expect(clientState.current_epoch_start_slot).toBe(900n);
    expect(clientState.current_epoch_end_slot_exclusive).toBe(3000n);
    expect(clientState.system_start_unix_ns).toBe(STABILITY_SLOT_ORIGIN_NS);
    expect(clientState.slot_length_ns).toBe(1_000_000_000n);
    expect(clientState.latest_checkpoint_height).toEqual(clientState.latest_height);
    expect(clientState.latest_checkpoint_block_hash).toBe('anchor-hash');
    expect(clientState.latest_checkpoint_epoch).toBe(7n);
    expect(clientState.latest_checkpoint_slot).toBe(1000n);
    expect(clientState.latest_checkpoint_timestamp).toBe(timestampForSlot(1000n));
    expect(clientState.max_clock_drift).toEqual({ seconds: 17n, nanos: 0 });
    expect(clientState.max_kes_evolutions).toBe(62n);
    expect(clientState.operational_certificate_counter_history_start_height).toEqual(clientState.latest_height);
    expect(
      clientState.latest_checkpoint_operational_certificate_counters.map((counter) => ({
        poolId: Buffer.from(counter.pool_id).toString('hex'),
        sequenceNumber: counter.sequence_number,
      })),
    ).toEqual([
      { poolId: '00'.repeat(28), sequenceNumber: 3n },
      { poolId: 'ff'.repeat(28), sequenceNumber: 9n },
    ]);
    expect(consensusState.timestamp).toBe(timestampForSlot(1000n));
    expect(historyServiceMock.findOperationalCertificateCountersAtBlock).toHaveBeenCalledWith(
      expect.objectContaining({ height: 100, hash: 'anchor-hash' }),
    );
  });

  it('rejects stability new-client creation without an exact operational certificate response', async () => {
    historyServiceMock.findHostStateUtxoAtOrBeforeBlockNo.mockResolvedValue({
      txHash: 'host-state-tx',
      datum: 'datum-cbor',
      blockNo: 100,
    });
    historyServiceMock.findOperationalCertificateCountersAtBlock.mockResolvedValue(undefined);

    await expect(service.queryNewClient({ height: 100n } as any)).rejects.toThrow(
      'operational certificate counter snapshot is unavailable',
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
        slotNo: slot,
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
    expect(header.anchor_block?.height?.revision_height).toBe(133n);
    expect(header.bridge_blocks).toHaveLength(32);
    expect(header.anchor_block?.block_cbor).toHaveLength(0);
    expect(header.anchor_block?.header_cbor).toHaveLength(860);
    expect(header.bridge_blocks.every((block) => block.block_cbor.length === 0)).toBe(true);
    expect(header.bridge_blocks.every((block) => block.header_cbor.length === 860)).toBe(true);
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
        slotNo: slot,
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
          { poolId: 'pool-a', stake: 200n, vrfKeyHash: 'aa'.repeat(32), firstRegistrationSlot: 1n },
          { poolId: 'pool-b', stake: 200n, vrfKeyHash: 'bb'.repeat(32), firstRegistrationSlot: 1n },
          { poolId: 'pool-c', stake: 200n, vrfKeyHash: 'cc'.repeat(32), firstRegistrationSlot: 1n },
          { poolId: 'pool-d', stake: 200n, vrfKeyHash: 'dd'.repeat(32), firstRegistrationSlot: 1n },
          { poolId: 'pool-e', stake: 200n, vrfKeyHash: 'ee'.repeat(32), firstRegistrationSlot: 1n },
        ],
        verificationContext: {
          epochNonce: epoch.toString(16).padStart(64, '0'),
          slotsPerKesPeriod: 129600,
          maxKesEvolutions: 62,
          currentEpochStartSlot,
          currentEpochEndSlotExclusive,
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
      expect(header.bridge_blocks.length).toBeLessThanOrEqual(32);
      expect(response.header!.value.length).toBeLessThanOrEqual(768 * 1024);
      expect(anchorEpoch - trustedEpoch).toBeLessThanOrEqual(1);
      if (anchorEpoch !== trustedEpoch) {
        expect(header.new_epoch_context?.epoch).toBe(BigInt(anchorEpoch));
      } else {
        expect(header.new_epoch_context).toBeUndefined();
      }

      if (anchorHeight < targetHeight) {
        expect(header.is_checkpoint).toBe(true);
        expect(header.host_state_tx_hash).toBe('');
        expect(header.host_state_tx_output_index).toBe(0);
      } else {
        expect(header.is_checkpoint).toBe(false);
        expect(header.host_state_tx_hash).toBe('host-state-epoch-305');
      }

      headers.push(header);
      trustedHeight = anchorHeight;
    }

    expect(trustedHeight).toBe(targetHeight);
    expect(headers.map((header) => header.anchor_block!.height!.revision_height)).toEqual([109n, 142n, 175n, 200n]);
    expect(
      headers.some(
        (header) =>
          header.is_checkpoint && epochForHeight(Number(header.anchor_block!.height!.revision_height)) === 304,
      ),
    ).toBe(true);
    expect(headers.slice(0, -1).every((header) => header.is_checkpoint && header.host_state_tx_hash === '')).toBe(true);
    expect(historyServiceMock.findHostStateUtxoAtOrBeforeBlockNo).toHaveBeenCalledTimes(1);
    expect(historyServiceMock.findHostStateUtxoAtOrBeforeBlockNo).toHaveBeenCalledWith(targetHeight);
  });

  it('keeps the maximum bounded checkpoint compact when source blocks are large', async () => {
    const blockAt = (height: number) => {
      const slot = 1000n + BigInt(height - 100) * 10n;
      return {
        height,
        hash: `hash-${height}`,
        prevHash: `hash-${height - 1}`,
        slotNo: slot,
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
      blocks.map(() => Buffer.alloc(24 * 1024, 1)),
    );

    const response = await service.queryIBCHeader({ height: 200n, trusted_height: 100n } as any);
    const header = ProbabilisticHeader.decode(response.header!.value);

    expect(header.is_checkpoint).toBe(true);
    expect(header.anchor_block!.height!.revision_height).toBe(133n);
    expect(header.bridge_blocks).toHaveLength(32);
    expect(header.anchor_block!.block_cbor).toHaveLength(0);
    expect(header.anchor_block!.header_cbor).toHaveLength(860);
    expect(response.header!.value).toHaveLength(ProbabilisticHeader.encode(header).finish().length);
    expect(response.header!.value.length).toBeLessThanOrEqual(768 * 1024);
    expect(response.header!.value.length).toBeLessThan(100_000);
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
      slotNo: 4452n,
      epochNo: 0,
      timestampUnixNs: timestampForSlot(4452n),
      slotLeader: 'pool-a',
    });
    historyServiceMock.findDescendantBlocks.mockResolvedValue([]);
    historyServiceMock.findEpochContextAtBlock.mockRejectedValue(
      new Error('Failed to acquire requested point. Target point is too old.'),
    );

    await expect(service.latestCertifiedHeight()).rejects.toThrow(/stability|accepted|epoch context/i);
  });

  it('rejects stability header generation when requested anchor height is not a HostState tx block', async () => {
    await expect(service.queryIBCHeader({ height: 100n, trusted_height: 98n } as any)).rejects.toThrow(
      'requested stability anchor height 100 is not a HostState tx block height',
    );
  });
});
