import { Logger } from '@nestjs/common';
import { HistoryService } from '../services/history.service';
import {
  loadStakeWeightedStabilityEvidenceByHeight,
  loadStakeWeightedStabilityEvidenceForTxHash,
  loadStakeWeightedStabilityHeaderEvidence,
} from '../services/stability-evidence';
import { getStabilityHeuristicParams } from '../services/stability-scoring';

describe('stability-evidence', () => {
  const heuristicParams = getStabilityHeuristicParams({
    CARDANO_STABILITY_THRESHOLD_DEPTH: '3',
    CARDANO_STABILITY_THRESHOLD_UNIQUE_POOLS: '3',
    CARDANO_STABILITY_THRESHOLD_UNIQUE_STAKE_BPS: '7000',
  } as NodeJS.ProcessEnv);

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
    { poolId: 'pool-a', stake: 500n, vrfKeyHash: 'aa'.repeat(32) },
    { poolId: 'pool-b', stake: 300n, vrfKeyHash: 'bb'.repeat(32) },
    { poolId: 'pool-c', stake: 200n, vrfKeyHash: 'cc'.repeat(32) },
  ];

  const epochVerificationContext = {
    epochNonce: '11'.repeat(32),
    slotsPerKesPeriod: 129600,
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

  it('loads a canonical stability evidence object from a height', async () => {
    const evidence = await loadStakeWeightedStabilityEvidenceByHeight({
      historyService: historyServiceMock as HistoryService,
      height: 100n,
      logger: { warn: jest.fn() } as unknown as Logger,
      heuristicParams,
    });

    expect(historyServiceMock.findBlockByHeight).toHaveBeenCalledWith(100n);
    expect(historyServiceMock.findDescendantBlocks).toHaveBeenCalledWith(100n, 12);
    expect(historyServiceMock.findEpochContextAtBlock).toHaveBeenCalledWith(anchorBlock);
    expect(evidence.anchorHeight).toBe(100n);
    expect(evidence.anchorEpoch).toBe(7);
    expect(evidence.anchorBlock).toEqual(anchorBlock);
    expect(evidence.descendantBlocks).toEqual(descendantBlocks);
    expect(evidence.epochVerificationContext).toEqual(epochVerificationContext);
    expect(evidence.metrics.uniquePoolsCount).toBe(3);
    expect(evidence.metrics.uniqueStakeBps).toBe(10000);
    expect(evidence.metrics.securityScoreBps).toBe(10000);
  });

  it('loads the same canonical evidence shape from a host-state tx hash', async () => {
    const evidence = await loadStakeWeightedStabilityEvidenceForTxHash({
      historyService: historyServiceMock as HistoryService,
      txHash: 'deadbeef',
      logger: { warn: jest.fn() } as unknown as Logger,
      heuristicParams,
    });

    expect(historyServiceMock.findTransactionEvidenceByHash).toHaveBeenCalledWith('deadbeef');
    expect(evidence.hostStateTxEvidence.txHash).toBe('deadbeef');
    expect(evidence.anchorHeight).toBe(100n);
    expect(evidence.metrics.uniquePoolsCount).toBe(3);
  });

  it('loads bridge blocks for a stability header from trusted height to anchor', async () => {
    const evidence = await loadStakeWeightedStabilityHeaderEvidence({
      historyService: historyServiceMock as HistoryService,
      trustedHeight: 97n,
      height: 100n,
      logger: { warn: jest.fn() } as unknown as Logger,
      heuristicParams,
    });

    expect(historyServiceMock.findBridgeBlocks).toHaveBeenCalledWith(97n, 100n);
    expect(evidence.trustedHeight).toBe(97n);
    expect(evidence.bridgeBlocks).toEqual(bridgeBlocks);
  });

  it('accepts the first descendant prefix that meets thresholds within the lookahead window', async () => {
    const progressiveHeuristicParams = getStabilityHeuristicParams({
      CARDANO_STABILITY_THRESHOLD_DEPTH: '3',
      CARDANO_STABILITY_THRESHOLD_UNIQUE_POOLS: '4',
      CARDANO_STABILITY_THRESHOLD_UNIQUE_STAKE_BPS: '9000',
    } as NodeJS.ProcessEnv);

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
        { poolId: 'pool-a', stake: 250n, vrfKeyHash: 'aa'.repeat(32) },
        { poolId: 'pool-b', stake: 250n, vrfKeyHash: 'bb'.repeat(32) },
        { poolId: 'pool-c', stake: 250n, vrfKeyHash: 'cc'.repeat(32) },
        { poolId: 'pool-d', stake: 250n, vrfKeyHash: 'dd'.repeat(32) },
      ],
      verificationContext: epochVerificationContext,
    });

    const evidence = await loadStakeWeightedStabilityEvidenceByHeight({
      historyService: historyServiceMock as HistoryService,
      height: 100n,
      logger: { warn: jest.fn() } as unknown as Logger,
      heuristicParams: progressiveHeuristicParams,
    });

    expect(historyServiceMock.findDescendantBlocks).toHaveBeenCalledWith(100n, 12);
    expect(evidence.descendantBlocks).toHaveLength(4);
    expect(evidence.descendantBlocks.map((block) => block.height)).toEqual([101, 102, 103, 104]);
    expect(evidence.metrics.uniquePoolsCount).toBe(4);
    expect(evidence.metrics.uniqueStakeBps).toBe(10000);
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
        heuristicParams,
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
        heuristicParams,
      }),
    ).rejects.toThrow('epoch stake distribution unavailable');
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
        heuristicParams,
      }),
    ).rejects.toThrow('Epoch verification context unavailable');
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
        heuristicParams,
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
      heuristicParams,
    });

    expect(evidence.anchorHeight).toBe(100n);
    expect(evidence.bridgeBlocks).toEqual(bridgeBlocks);
  });
});
