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

    await expect(service.getReadinessStatus()).resolves.toEqual({
      status: 'ready',
      lightClientMode: 'stake-weighted-stability',
      liveHostStateTxHash: 'ab'.repeat(32),
      proofHeight: '1234',
      detail: 'Current HostState root is ready for proof serving',
    });
  });

  it('reports not_ready when the current HostState tx is not yet provable from history', async () => {
    lucidServiceMock.findUtxoAtHostStateNFT.mockResolvedValue({ txHash: 'cd'.repeat(32) });
    (resolveProofHeightForCurrentRoot as jest.Mock).mockRejectedValueOnce(
      new Error(
        `Historical tx evidence unavailable for current live HostState tx ${'cd'.repeat(32)}`,
      ),
    );

    await expect(service.getReadinessStatus()).resolves.toEqual({
      status: 'not_ready',
      lightClientMode: 'stake-weighted-stability',
      liveHostStateTxHash: 'cd'.repeat(32),
      proofHeight: null,
      detail: `Historical tx evidence unavailable for current live HostState tx ${'cd'.repeat(32)}`,
    });
  });
});
