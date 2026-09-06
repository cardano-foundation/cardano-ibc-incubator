import { createTestTreeContext, createTestTreeStore } from '../../shared/testing/ibc-tree-test-store';
import { SubmissionService } from '../submission.service';
import { ICS23MerkleTree } from '../../shared/helpers/ics23-merkle-tree';

describe('SubmissionService confirmation strictness regressions', () => {
  let service: SubmissionService;
  let lucidServiceMock: {
    LucidImporter: Record<string, unknown>;
    lucid: {
      wallet: jest.Mock;
      awaitTx: jest.Mock;
    };
    findUtxoAtHostStateNFT: jest.Mock;
    decodeDatum: jest.Mock;
  };
  let configServiceMock: {
    get: jest.Mock;
  };
  let txEventsServiceMock: {
    take: jest.Mock;
  };
  let ibcTreePendingUpdatesServiceMock: {
    take: jest.Mock;
  };
  let ibcTreeCacheServiceMock: {
    saveAliases: jest.Mock;
  };
  let historyServiceMock: {
    findTxByHash: jest.Mock;
  };
  let queryServiceMock: {
    queryPacketEventsByTxHash: jest.Mock;
  };

  beforeEach(() => {
    lucidServiceMock = {
      LucidImporter: {},
      lucid: {
        wallet: jest.fn().mockReturnValue({
          submitTx: jest.fn().mockResolvedValue('tx-hash-abc'),
        }),
        awaitTx: jest.fn().mockResolvedValue(false),
      },
      findUtxoAtHostStateNFT: jest.fn(),
      decodeDatum: jest.fn(),
    };

    configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ogmiosEndpoint') {
          return 'ws://localhost:1337';
        }
        if (key === 'deployment') {
          return {
            hostStateNFT: {
              policyId: 'policy-id',
              name: 'token-name',
            },
          };
        }
        return undefined;
      }),
    };

    txEventsServiceMock = {
      take: jest.fn().mockReturnValue([]),
    };

    ibcTreePendingUpdatesServiceMock = {
      take: jest.fn().mockReturnValue(undefined),
    };

    ibcTreeCacheServiceMock = {
      saveAliases: jest.fn().mockResolvedValue(undefined),
    };
    historyServiceMock = { findTxByHash: jest.fn() };
    queryServiceMock = { queryPacketEventsByTxHash: jest.fn().mockResolvedValue({ events: [] }) };

    service = new SubmissionService(
      lucidServiceMock as any,
      configServiceMock as any,
      txEventsServiceMock as any,
      ibcTreePendingUpdatesServiceMock as any,
      ibcTreeCacheServiceMock as any,
      historyServiceMock as any,
      queryServiceMock as any,
      createTestTreeStore(),
    );
  });

  it('fails hard when history indexing confirmation times out', async () => {
    await expect((service as any).waitForIndexedConfirmation('tx-timeout', 0)).rejects.toThrow(
      'history indexing timeout',
    );
  });

  it('does not finalize denom traces if on-chain root verification fails', async () => {
    ibcTreePendingUpdatesServiceMock.take.mockReturnValueOnce({
      expectedNewRoot: 'expected-root',
      commit: jest.fn(),
    });
    jest.spyOn(service as any, 'readConfirmedTxHostState').mockRejectedValueOnce(new Error('hoststate unavailable'));

    await expect((service as any).applyPendingIbcTreeUpdate('deadbeef', 'tx-hash-abc', 9999)).rejects.toThrow();
  });

  it('does not return submit success when confirmation status is unknown', async () => {
    jest.spyOn(service as any, 'submitToCardano').mockResolvedValueOnce('tx-hash-abc');
    jest.spyOn(service as any, 'waitForIndexedConfirmation').mockRejectedValueOnce(new Error('not confirmed'));

    await expect(
      service.submitSignedTransaction({
        signed_tx_cbor: 'deadbeef',
      } as any),
    ).rejects.toThrow('not confirmed');
    expect(historyServiceMock.findTxByHash).not.toHaveBeenCalled();
  });

  it('persists the exact confirmed snapshot separately from current state', async () => {
    const fixture = createTestTreeContext();
    const tree = new ICS23MerkleTree();
    tree.set('ports/transfer', '01');
    const current = await fixture.restore(tree);
    (service as any).ibcTreeStore = fixture.store;
    const commit = jest.fn().mockResolvedValue({ published: true, snapshot: current });
    ibcTreePendingUpdatesServiceMock.take.mockReturnValueOnce({ expectedNewRoot: current.root, commit });
    jest.spyOn(service as any, 'readConfirmedTxHostState').mockResolvedValueOnce({ root: current.root, outputIndex: 0 });

    await (service as any).applyPendingIbcTreeUpdate('deadbeef', current.hostState.txHash, 9999);

    expect(commit).toHaveBeenCalledWith(current.hostState);
    expect(ibcTreeCacheServiceMock.saveAliases).toHaveBeenCalledWith(
      expect.anything(), [`root:${current.root}`, `host-state:${current.hostState.txHash}#0`], current.hostState,
    );
    expect(ibcTreeCacheServiceMock.saveAliases).toHaveBeenLastCalledWith(
      expect.anything(), ['current'], current.hostState,
    );
  });
});
