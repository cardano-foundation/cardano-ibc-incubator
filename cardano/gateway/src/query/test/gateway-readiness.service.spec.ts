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

  let originalTimeout: string | undefined;

  beforeEach(() => {
    originalTimeout = process.env.GATEWAY_READINESS_PROOF_TIMEOUT_MS;
    delete process.env.GATEWAY_READINESS_PROOF_TIMEOUT_MS;
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
    if (originalTimeout === undefined) delete process.env.GATEWAY_READINESS_PROOF_TIMEOUT_MS;
    else process.env.GATEWAY_READINESS_PROOF_TIMEOUT_MS = originalTimeout;
    jest.useRealTimers();
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

  function indexedHost() {
    lucidServiceMock.findUtxoAtHostStateNFT.mockResolvedValue({ txHash: 'ab'.repeat(32) });
    historyServiceMock.findLatestBlock.mockResolvedValue({ height: 4249, slotNo: 987654n });
    historyServiceMock.findTransactionEvidenceByHash.mockResolvedValue({ blockNo: 1234 });
  }

  it('reports a timeout without claiming that stability thresholds failed', async () => {
    jest.useFakeTimers();
    indexedHost();
    (resolveProofHeightForCurrentRoot as jest.Mock).mockReturnValue(new Promise(() => {}));
    const result = service.getReadinessStatus();
    await jest.advanceTimersByTimeAsync(25_000);
    const status = await result;
    expect(status).toMatchObject({
      status: 'not_ready', reason: 'proof_check_timeout', proofHeight: null,
      history: { reason: 'proof_check_timeout', indexedDescendantDepth: '3015' },
    });
    expect(status.cause).toContain('25000ms');
    expect(status.detail).toContain('stability is unconfirmed');
    expect(status.detail).not.toContain('thresholds are not met');
  });

  it('allows a slow successful proof check within the configured deadline', async () => {
    jest.useFakeTimers();
    indexedHost();
    process.env.GATEWAY_READINESS_PROOF_TIMEOUT_MS = '60000';
    service = new GatewayReadinessService(lucidServiceMock as any, historyServiceMock as any);
    (resolveProofHeightForCurrentRoot as jest.Mock).mockImplementation(() =>
      new Promise((resolve) => setTimeout(() => resolve(1234n), 38_000)));
    let completed = false;
    const result = service.getReadinessStatus().then((status) => { completed = true; return status; });
    await jest.advanceTimersByTimeAsync(25_000);
    expect(completed).toBe(false);
    await jest.advanceTimersByTimeAsync(13_000);
    await expect(result).resolves.toMatchObject({ status: 'ready', reason: 'ready', proofHeight: '1234' });
  });

  it.each(['0', '-1', '1.5', 'invalid', '300001'])('rejects invalid readiness deadline %s', (value) => {
    process.env.GATEWAY_READINESS_PROOF_TIMEOUT_MS = value;
    expect(() => new GatewayReadinessService(lucidServiceMock as any, historyServiceMock as any))
      .toThrow('GATEWAY_READINESS_PROOF_TIMEOUT_MS');
  });

});
