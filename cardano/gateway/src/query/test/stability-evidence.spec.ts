import { Logger } from '@nestjs/common';
import { status } from '@grpc/grpc-js';
import { HistoryService } from '../services/history.service';
import {
  loadStakeWeightedStabilityEvidenceByHeight,
  loadStakeWeightedStabilityEvidenceForTxHash,
  loadStakeWeightedStabilityHeaderEvidence,
} from '../services/stability-evidence';
import { getStabilityPolicy, StabilityPolicy } from '../services/stability-scoring';

async function expectGrpcError(
  promise: Promise<unknown>,
  code: status,
  gatewayCode: string,
): Promise<{ message: string; code: number }> {
  try {
    await promise;
  } catch (error) {
    const payload = (error as { getError?: () => { message: string; code: number } }).getError?.();
    expect(payload?.code).toBe(code);
    expect(payload?.message).toContain(gatewayCode);
    return payload!;
  }

  throw new Error(`Expected ${gatewayCode} gRPC error`);
}

describe('stability-evidence', () => {
  const policy = (overrides: Partial<StabilityPolicy> = {}): StabilityPolicy => ({
    ...getStabilityPolicy(),
    ...overrides,
  });
  const stabilityPolicy = policy({
    threshold_depth: 3n,
    threshold_unique_pools: 3n,
    threshold_unique_stake_bps: 7000n,
  });

  const anchorBlock = {
    height: 100,
    hash: 'anchor-hash',
    prevHash: 'anchor-prev',
    slotNo: 1000n,
    epochNo: 7,
    timestampUnixNs: 1_000_000_000n,
    slotLeader: 'pool-a',
  };

  const descendantBlocks = [
    {
      height: 101,
      hash: 'hash-101',
      prevHash: 'anchor-hash',
      slotNo: 1010n,
      epochNo: 7,
      timestampUnixNs: 1_100_000_000n,
      slotLeader: 'pool-a',
    },
    {
      height: 102,
      hash: 'hash-102',
      prevHash: 'hash-101',
      slotNo: 1020n,
      epochNo: 7,
      timestampUnixNs: 1_200_000_000n,
      slotLeader: 'pool-b',
    },
    {
      height: 103,
      hash: 'hash-103',
      prevHash: 'hash-102',
      slotNo: 1030n,
      epochNo: 7,
      timestampUnixNs: 1_300_000_000n,
      slotLeader: 'pool-c',
    },
  ];

  const bridgeBlocks = [
    {
      height: 98,
      hash: 'hash-98',
      prevHash: 'hash-97',
      slotNo: 980n,
      epochNo: 7,
      timestampUnixNs: 980_000_000n,
      slotLeader: 'pool-x',
    },
    {
      height: 99,
      hash: 'hash-99',
      prevHash: 'hash-98',
      slotNo: 990n,
      epochNo: 7,
      timestampUnixNs: 990_000_000n,
      slotLeader: 'pool-y',
    },
  ];

  const epochStakeDistribution = [
    {
      poolId: 'pool-a',
      stake: 500n,
      relativeStakeNumerator: 500n,
      relativeStakeDenominator: 1000n,
      vrfKeyHash: 'aa'.repeat(32),
      firstRegistrationSlot: 1n,
    },
    {
      poolId: 'pool-b',
      stake: 300n,
      relativeStakeNumerator: 300n,
      relativeStakeDenominator: 1000n,
      vrfKeyHash: 'bb'.repeat(32),
      firstRegistrationSlot: 1n,
    },
    {
      poolId: 'pool-c',
      stake: 200n,
      relativeStakeNumerator: 200n,
      relativeStakeDenominator: 1000n,
      vrfKeyHash: 'cc'.repeat(32),
      firstRegistrationSlot: 1n,
    },
  ];

  const epochVerificationContext = {
    epochNonce: '11'.repeat(32),
    slotsPerKesPeriod: 129600,
    activeSlotCoefficientNumerator: 1n,
    activeSlotCoefficientDenominator: 20n,
    maxKesEvolutions: 62,
    currentEpochStartSlot: 900n,
    currentEpochEndSlotExclusive: 1200n,
  };

  const anchorEpochContext = {
    epoch: 7,
    stakeDistribution: epochStakeDistribution,
    verificationContext: epochVerificationContext,
  };

  const historyServiceMock = {
    findLatestBlock: jest.fn().mockResolvedValue({
      height: 105,
      hash: 'latest-hash',
      prevHash: 'hash-104',
      slotNo: 1050n,
      epochNo: 7,
      timestampUnixNs: 1_500_000_000n,
      slotLeader: 'pool-e',
    }),
    findBlockByHeight: jest.fn().mockImplementation(async (height: bigint) => {
      if (height === 97n) {
        return {
          height: 97,
          hash: 'hash-97',
          prevHash: 'hash-96',
          slotNo: 970n,
          epochNo: 7,
          timestampUnixNs: 970_000_000n,
          slotLeader: 'pool-z',
        };
      }
      return anchorBlock;
    }),
    findBridgeBlocks: jest.fn().mockResolvedValue(bridgeBlocks),
    findDescendantBlocks: jest.fn().mockResolvedValue(descendantBlocks),
    findEpochContextAtBlock: jest.fn().mockResolvedValue(anchorEpochContext),
    findTransactionEvidenceByHash: jest.fn().mockResolvedValue({
      txHash: 'deadbeef',
      blockNo: 100,
      txIndex: 0,
      txCborHex: '01',
      txBodyCborHex: '02',
      redeemers: [],
    }),
  } as Partial<HistoryService>;

  describe('fresh devnet registration cutoff in both evidence loaders', () => {
    const envNames = ['CARDANO_CHAIN_ID', 'CARDANO_NETWORK_MAGIC', 'CARDANO_CHAIN_NETWORK_MAGIC', 'CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT'];
    let savedEnv: Array<[string, string | undefined]>;
    beforeEach(() => {
      savedEnv = envNames.map((name) => [name, process.env[name]]);
      envNames.forEach((name) => { delete process.env[name]; });
    });
    afterEach(() => {
      for (const [name, value] of savedEnv) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    const configure = (chainId?: string, networkMagic?: string, chainNetworkMagic?: string) => {
      [chainId, networkMagic, chainNetworkMagic].forEach((value, index) => {
        if (value !== undefined) process.env[envNames[index]] = value;
      });
    };
    const freshHistory = (firstRegistrationSlot: bigint | undefined = 1n, start = 1_767_225_600_000_000_000n): HistoryService => {
      const atStart = <T extends { slotNo: bigint }>(block: T) => ({ ...block, timestampUnixNs: start + block.slotNo * 1_000_000_000n });
      return {
        ...historyServiceMock,
        findBlockByHeight: jest.fn(async (height: bigint) => atStart(height === 97n
          ? { ...anchorBlock, height: 97, hash: 'hash-97', slotNo: 970n }
          : anchorBlock)),
        findDescendantBlocks: jest.fn(async () => descendantBlocks.map(atStart)),
        findBridgeBlocks: jest.fn(async () => bridgeBlocks.map(atStart)),
        findEpochContextAtBlock: jest.fn(async () => ({ ...anchorEpochContext,
          stakeDistribution: epochStakeDistribution.map((entry) => ({ ...entry, firstRegistrationSlot })) })),
        findFirstPoolRegistrationSlots: jest.fn(async () => new Map()),
      } as unknown as HistoryService;
    };

    for (const loader of ['height', 'header'] as const) {
      const load = (historyService = freshHistory()) => loader === 'height'
        ? loadStakeWeightedStabilityEvidenceByHeight({ historyService, height: 100n, stabilityPolicy })
        : loadStakeWeightedStabilityHeaderEvidence({ historyService, height: 100n, trustedHeight: 97n, stabilityPolicy });

      it(`${loader}: admits known slot-1 bootstrap pools with all three devnet identity settings`, async () => {
        configure('cardano-devnet', '42', '42');
        expect((await load()).descendantBlocks).toHaveLength(3);
      });

      it.each([
        ['cardano-devnet', '1', '1'], ['cardano-devnet', '2', '2'], ['cardano-devnet', '764824073', '764824073'],
        ['cardano-devnet-1', '42', '42'], [undefined, '42', '42'], ['cardano-devnet', undefined, '42'],
        ['cardano-devnet', '42', undefined], ['cardano-devnet', '42', '1'], ['cardano-devnet', '2', '42'],
      ])(`${loader}: fails closed for identity %s/%s/%s`, async (chainId, networkMagic, chainNetworkMagic) => {
        configure(chainId, networkMagic, chainNetworkMagic);
        await expectGrpcError(load(), status.FAILED_PRECONDITION, 'HEIGHT_NOT_ACCEPTED');
      });

      it(`${loader}: does not admit pools registered after bootstrap`, async () => {
        configure('cardano-devnet', '42', '42');
        await expectGrpcError(load(freshHistory(2n)), status.FAILED_PRECONDITION, 'HEIGHT_NOT_ACCEPTED');
      });

      it.each([0n, undefined])(`${loader}: still rejects missing or zero registration slots: %s`, async (slot) => {
        configure('cardano-devnet', '42', '42');
        const history = freshHistory(0n);
        if (slot === undefined) {
          (history.findEpochContextAtBlock as jest.Mock).mockResolvedValue({ ...anchorEpochContext,
            stakeDistribution: epochStakeDistribution.map((entry) => ({ ...entry, firstRegistrationSlot: undefined })) });
        }
        await expect(load(history)).rejects.toThrow('First registration slot missing');
      });

      it(`${loader}: preserves the old cutoff for a pre-January devnet genesis`, async () => {
        configure('cardano-devnet', '42', '42');
        expect((await load(freshHistory(2n, 1_767_225_500_000_000_000n))).descendantBlocks).toHaveLength(3);
      });
    }
  });

  it('loads a canonical stability evidence object from a height', async () => {
    const evidence = await loadStakeWeightedStabilityEvidenceByHeight({
      historyService: historyServiceMock as HistoryService,
      height: 100n,
      logger: { warn: jest.fn() } as unknown as Logger,
      stabilityPolicy,
    });

    expect(historyServiceMock.findBlockByHeight).toHaveBeenCalledWith(100n);
    expect(historyServiceMock.findDescendantBlocks).toHaveBeenCalledWith(100n, 12);
    expect(historyServiceMock.findEpochContextAtBlock).toHaveBeenCalledWith(anchorBlock);
    expect(evidence.anchorHeight).toBe(100n);
    expect(evidence.anchorEpoch).toBe(7);
    expect(evidence.anchorBlock).toEqual(anchorBlock);
    expect(evidence.descendantBlocks).toEqual(descendantBlocks);
    expect(evidence.epochVerificationContext).toEqual(epochVerificationContext);
    expect(evidence.metrics.qualifiedUniquePoolsCount).toBe(3);
    expect(evidence.metrics.qualifiedUniqueStakeBps).toBe(10000);
    expect(evidence.metrics.securityScoreBps).toBe(10000);
  });

  it('loads the same canonical evidence shape from a host-state tx hash', async () => {
    const evidence = await loadStakeWeightedStabilityEvidenceForTxHash({
      historyService: historyServiceMock as HistoryService,
      txHash: 'deadbeef',
      logger: { warn: jest.fn() } as unknown as Logger,
      stabilityPolicy,
    });

    expect(historyServiceMock.findTransactionEvidenceByHash).toHaveBeenCalledWith('deadbeef');
    expect(evidence.hostStateTxEvidence.txHash).toBe('deadbeef');
    expect(evidence.anchorHeight).toBe(100n);
    expect(evidence.metrics.qualifiedUniquePoolsCount).toBe(3);
  });

  it('loads bridge blocks for a stability header from trusted height to anchor', async () => {
    const evidence = await loadStakeWeightedStabilityHeaderEvidence({
      historyService: historyServiceMock as HistoryService,
      trustedHeight: 97n,
      height: 100n,
      logger: { warn: jest.fn() } as unknown as Logger,
      stabilityPolicy,
    });

    expect(historyServiceMock.findBridgeBlocks).toHaveBeenCalledWith(97n, 100n);
    expect(evidence.trustedHeight).toBe(97n);
    expect(evidence.bridgeBlocks).toEqual(bridgeBlocks);
  });

  it('returns typed not-found status when a stability header height is unknown', async () => {
    const localHistoryService = {
      ...historyServiceMock,
      findBlockByHeight: jest.fn().mockImplementation(async (height: bigint) => {
        if (height === 97n) {
          return {
            ...anchorBlock,
            height: 97,
            hash: 'trusted-hash',
            prevHash: 'hash-96',
            slotNo: 970n,
          };
        }
        return null;
      }),
    } as Partial<HistoryService>;

    await expectGrpcError(
      loadStakeWeightedStabilityHeaderEvidence({
        historyService: localHistoryService as HistoryService,
        trustedHeight: 97n,
        height: 100n,
        logger: { warn: jest.fn() } as unknown as Logger,
        stabilityPolicy,
      }),
      status.NOT_FOUND,
      'HEIGHT_NOT_FOUND',
    );
  });

  it('returns typed failed-precondition status when a stability header height is not accepted', async () => {
    const strictStabilityPolicy = policy({
      threshold_depth: 4n,
      threshold_unique_pools: 4n,
      threshold_unique_stake_bps: 9000n,
    });

    await expectGrpcError(
      loadStakeWeightedStabilityHeaderEvidence({
        historyService: historyServiceMock as HistoryService,
        trustedHeight: 97n,
        height: 100n,
        logger: { warn: jest.fn() } as unknown as Logger,
        stabilityPolicy: strictStabilityPolicy,
      }),
      status.FAILED_PRECONDITION,
      'HEIGHT_NOT_ACCEPTED',
    );
  });

  it('returns typed invalid-argument status for invalid trusted stability header heights', async () => {
    await expectGrpcError(
      loadStakeWeightedStabilityHeaderEvidence({
        historyService: historyServiceMock as HistoryService,
        trustedHeight: 100n,
        height: 100n,
        logger: { warn: jest.fn() } as unknown as Logger,
        stabilityPolicy,
      }),
      status.INVALID_ARGUMENT,
      'INVALID_TRUSTED_HEIGHT',
    );
  });

  it('returns typed failed-precondition status when stability history is incomplete', async () => {
    const localHistoryService = {
      ...historyServiceMock,
      findBridgeBlocks: jest.fn().mockResolvedValue([]),
    } as Partial<HistoryService>;

    await expectGrpcError(
      loadStakeWeightedStabilityHeaderEvidence({
        historyService: localHistoryService as HistoryService,
        trustedHeight: 97n,
        height: 100n,
        logger: { warn: jest.fn() } as unknown as Logger,
        stabilityPolicy,
      }),
      status.FAILED_PRECONDITION,
      'HISTORY_NOT_READY',
    );
  });

  it('accepts the first descendant prefix that meets thresholds within the lookahead window', async () => {
    const progressiveStabilityPolicy = policy({
      threshold_depth: 3n,
      threshold_unique_pools: 4n,
      threshold_unique_stake_bps: 9000n,
    });

    historyServiceMock.findDescendantBlocks = jest.fn().mockResolvedValue([
      ...descendantBlocks,
      {
        height: 104,
        hash: 'hash-104',
        prevHash: 'hash-103',
        slotNo: 1040n,
        epochNo: 7,
        timestampUnixNs: 1_400_000_000n,
        slotLeader: 'pool-d',
      },
      {
        height: 105,
        hash: 'hash-105',
        prevHash: 'hash-104',
        slotNo: 1200n,
        epochNo: 8,
        timestampUnixNs: 1_500_000_000n,
        slotLeader: 'pool-e',
      },
    ]);
    historyServiceMock.findEpochContextAtBlock = jest.fn().mockResolvedValue({
      epoch: 7,
      stakeDistribution: [
        { poolId: 'pool-a', stake: 250n, vrfKeyHash: 'aa'.repeat(32), firstRegistrationSlot: 1n },
        { poolId: 'pool-b', stake: 250n, vrfKeyHash: 'bb'.repeat(32), firstRegistrationSlot: 1n },
        { poolId: 'pool-c', stake: 250n, vrfKeyHash: 'cc'.repeat(32), firstRegistrationSlot: 1n },
        { poolId: 'pool-d', stake: 250n, vrfKeyHash: 'dd'.repeat(32), firstRegistrationSlot: 1n },
      ],
      verificationContext: epochVerificationContext,
    });

    const evidence = await loadStakeWeightedStabilityEvidenceByHeight({
      historyService: historyServiceMock as HistoryService,
      height: 100n,
      logger: { warn: jest.fn() } as unknown as Logger,
      stabilityPolicy: progressiveStabilityPolicy,
    });

    expect(historyServiceMock.findDescendantBlocks).toHaveBeenCalledWith(100n, 12);
    expect(evidence.descendantBlocks).toHaveLength(4);
    expect(evidence.descendantBlocks.map((block) => block.height)).toEqual([101, 102, 103, 104]);
    expect(evidence.metrics.qualifiedUniquePoolsCount).toBe(4);
    expect(evidence.metrics.qualifiedUniqueStakeBps).toBe(10000);
  });

  it('rejects descendant windows that cross an epoch boundary', async () => {
    historyServiceMock.findDescendantBlocks = jest.fn().mockResolvedValue([
      ...descendantBlocks.slice(0, 2),
      {
        ...descendantBlocks[2],
        epochNo: 8,
      },
    ]);

    await expect(
      loadStakeWeightedStabilityEvidenceByHeight({
        historyService: historyServiceMock as HistoryService,
        height: 100n,
        logger: { warn: jest.fn() } as unknown as Logger,
        stabilityPolicy,
      }),
    ).rejects.toThrow('crosses epoch boundary');
  });

  it('fails closed when epoch stake distribution is unavailable', async () => {
    historyServiceMock.findDescendantBlocks = jest.fn().mockResolvedValue(descendantBlocks);
    historyServiceMock.findEpochContextAtBlock = jest.fn().mockResolvedValue({
      epoch: 7,
      stakeDistribution: [],
      verificationContext: epochVerificationContext,
    });

    await expect(
      loadStakeWeightedStabilityEvidenceByHeight({
        historyService: historyServiceMock as HistoryService,
        height: 100n,
        logger: { warn: jest.fn() } as unknown as Logger,
        stabilityPolicy,
      }),
    ).rejects.toThrow('Epoch stake distribution unavailable');
  });

  it('fails closed when epoch verification context is unavailable', async () => {
    historyServiceMock.findDescendantBlocks = jest.fn().mockResolvedValue(descendantBlocks);
    historyServiceMock.findEpochContextAtBlock = jest.fn().mockResolvedValue({
      epoch: 7,
      stakeDistribution: epochStakeDistribution,
      verificationContext: null,
    });

    await expect(
      loadStakeWeightedStabilityEvidenceByHeight({
        historyService: historyServiceMock as HistoryService,
        height: 100n,
        logger: { warn: jest.fn() } as unknown as Logger,
        stabilityPolicy,
      }),
    ).rejects.toThrow('Epoch verification context unavailable');
  });

  it('rejects a max KES evolution count above the supported Sum6 depth', async () => {
    historyServiceMock.findDescendantBlocks = jest.fn().mockResolvedValue(descendantBlocks);
    historyServiceMock.findEpochContextAtBlock = jest.fn().mockResolvedValue({
      epoch: 7,
      stakeDistribution: epochStakeDistribution,
      verificationContext: {
        ...epochVerificationContext,
        maxKesEvolutions: 65,
      },
    });

    await expect(
      loadStakeWeightedStabilityEvidenceByHeight({
        historyService: historyServiceMock as HistoryService,
        height: 100n,
        logger: { warn: jest.fn() } as unknown as Logger,
        stabilityPolicy,
      }),
    ).rejects.toThrow('Max KES evolutions unavailable');
  });

  it('rejects stability headers that skip more than one epoch', async () => {
    historyServiceMock.findBlockByHeight = jest.fn().mockImplementation(async (height: bigint) => {
      if (height === 97n) {
        return {
          ...anchorBlock,
          height: 97,
          hash: 'trusted-hash',
          prevHash: 'hash-96',
          slotNo: 970n,
          epochNo: 5,
          timestampUnixNs: 970_000_000n,
          slotLeader: 'pool-z',
        };
      }
      return anchorBlock;
    });

    await expect(
      loadStakeWeightedStabilityHeaderEvidence({
        historyService: historyServiceMock as HistoryService,
        trustedHeight: 97n,
        height: 100n,
        logger: { warn: jest.fn() } as unknown as Logger,
        stabilityPolicy,
      }),
    ).rejects.toThrow('supports only adjacent epoch transitions');
  });

  it('allows same-epoch historical anchors when acquired epoch context is available', async () => {
    historyServiceMock.findBlockByHeight = jest.fn().mockImplementation(async (height: bigint) => {
      if (height === 97n) {
        return {
          height: 97,
          hash: 'hash-97',
          prevHash: 'hash-96',
          slotNo: 970n,
          epochNo: 7,
          timestampUnixNs: 970_000_000n,
          slotLeader: 'pool-z',
        };
      }
      return anchorBlock;
    });
    historyServiceMock.findEpochContextAtBlock = jest.fn().mockResolvedValue(anchorEpochContext);

    const evidence = await loadStakeWeightedStabilityHeaderEvidence({
      historyService: historyServiceMock as HistoryService,
      trustedHeight: 97n,
      height: 100n,
      logger: { warn: jest.fn() } as unknown as Logger,
      stabilityPolicy,
    });

    expect(evidence.anchorHeight).toBe(100n);
    expect(evidence.bridgeBlocks).toEqual(bridgeBlocks);
  });
});
