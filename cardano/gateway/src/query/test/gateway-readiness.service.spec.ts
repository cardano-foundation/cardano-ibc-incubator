import { GatewayReadinessService } from '../services/gateway-readiness.service';
import { resolveProofHeightForCurrentRoot } from '../services/proof-context';

jest.mock('../services/proof-context', () => ({
  resolveProofHeightForCurrentRoot: jest.fn(),
}));

describe('GatewayReadinessService', () => {
  let service: GatewayReadinessService;
  let lucidServiceMock: { findUtxoAtHostStateNFT: jest.Mock };
  let historyServiceMock: {
    findTransactionEvidenceByHash: jest.Mock;
    findTxByHash: jest.Mock;
    findLatestBlock: jest.Mock;
  };

  beforeEach(() => {
    lucidServiceMock = {
      findUtxoAtHostStateNFT: jest.fn(),
    };
    historyServiceMock = {
      findTransactionEvidenceByHash: jest.fn(),
      findTxByHash: jest.fn(),
      findLatestBlock: jest.fn(),
    };

    service = new GatewayReadinessService(lucidServiceMock as any, historyServiceMock as any);
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
    expect(lucidServiceMock.findUtxoAtHostStateNFT).toHaveBeenCalledWith(0n);
    expect(resolveProofHeightForCurrentRoot).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'health/ready',
        maxAttempts: 1,
        delayMs: 0,
      }),
    );
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
