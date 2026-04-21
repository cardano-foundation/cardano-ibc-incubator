import { ConfigService } from '@nestjs/config';
import { GatewayReadinessService } from '../services/gateway-readiness.service';
import { resolveProofHeightForCurrentRoot } from '../services/proof-context';

jest.mock('../services/proof-context', () => ({
  resolveProofHeightForCurrentRoot: jest.fn(),
}));

describe('GatewayReadinessService', () => {
  let service: GatewayReadinessService;
  let configServiceMock: { get: jest.Mock };
  let lucidServiceMock: { findUtxoAtHostStateNFT: jest.Mock };
  let mithrilServiceMock: Record<string, unknown>;
  let historyServiceMock: {
    findTransactionEvidenceByHash: jest.Mock;
    findTxByHash: jest.Mock;
    findLatestBlock: jest.Mock;
  };

  beforeEach(() => {
    configServiceMock = {
      get: jest.fn().mockReturnValue('stake-weighted-stability'),
    };
    lucidServiceMock = {
      findUtxoAtHostStateNFT: jest.fn(),
    };
    mithrilServiceMock = {};
    historyServiceMock = {
      findTransactionEvidenceByHash: jest.fn(),
      findTxByHash: jest.fn(),
      findLatestBlock: jest.fn(),
    };

    service = new GatewayReadinessService(
      configServiceMock as unknown as ConfigService,
      lucidServiceMock as any,
      mithrilServiceMock as any,
      historyServiceMock as any,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('reports ready when current HostState tx evidence is present', async () => {
    lucidServiceMock.findUtxoAtHostStateNFT.mockResolvedValue({ txHash: 'ab'.repeat(32) });
    (resolveProofHeightForCurrentRoot as jest.Mock).mockResolvedValueOnce(1234n);
    historyServiceMock.findLatestBlock.mockResolvedValue({
      height: 1258,
      slotNo: 987654n,
    });
    historyServiceMock.findTransactionEvidenceByHash.mockResolvedValue({
      blockNo: 1234,
    });

    await expect(service.getReadinessStatus()).resolves.toEqual({
      status: 'ready',
      reason: 'ready',
      lightClientMode: 'stake-weighted-stability',
      liveHostStateTxHash: 'ab'.repeat(32),
      proofHeight: '1234',
      detail: 'Current HostState root is ready for proof serving',
      history: {
        backend: 'yaci',
        reason: 'ready',
        latestIndexedBlock: '1258',
        latestIndexedSlot: '987654',
        liveHostStateTxBlock: '1234',
        indexedDescendantDepth: '24',
        requiredDescendantDepth: '24',
        message: 'Yaci has indexed the current HostState tx at block 1234 and Gateway has accepted it for proof serving.',
      },
    });
  });

  it('reports not_ready when the current HostState tx is not yet provable from history', async () => {
    lucidServiceMock.findUtxoAtHostStateNFT.mockResolvedValue({ txHash: 'cd'.repeat(32) });
    historyServiceMock.findLatestBlock.mockResolvedValue({
      height: 1000,
      slotNo: 123456n,
    });
    historyServiceMock.findTransactionEvidenceByHash.mockResolvedValue(null);
    historyServiceMock.findTxByHash.mockResolvedValue(null);
    (resolveProofHeightForCurrentRoot as jest.Mock).mockRejectedValueOnce(
      new Error(
        `Historical tx evidence unavailable for current live HostState tx ${'cd'.repeat(32)}`,
      ),
    );

    await expect(service.getReadinessStatus()).resolves.toEqual({
      status: 'not_ready',
      reason: 'waiting_for_yaci_history',
      lightClientMode: 'stake-weighted-stability',
      liveHostStateTxHash: 'cd'.repeat(32),
      proofHeight: null,
      detail:
        `Yaci has indexed through block 1000, but has not indexed the current HostState tx ${'cd'.repeat(32)}. ` +
        'Keep Yaci running until bridge history reaches that transaction.',
      cause: `Historical tx evidence unavailable for current live HostState tx ${'cd'.repeat(32)}`,
      history: {
        backend: 'yaci',
        reason: 'waiting_for_yaci_history',
        latestIndexedBlock: '1000',
        latestIndexedSlot: '123456',
        liveHostStateTxBlock: null,
        indexedDescendantDepth: null,
        requiredDescendantDepth: '24',
        message:
          `Yaci has indexed through block 1000, but has not indexed the current HostState tx ${'cd'.repeat(32)}. ` +
          'Keep Yaci running until bridge history reaches that transaction.',
      },
    });
  });
});
