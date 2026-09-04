import { SubmissionService } from '../submission.service';
import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import * as timeHelpers from '../../shared/helpers/time';

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
    peek: jest.Mock;
    takeByExpectedRoot: jest.Mock;
  };
  let ibcTreeCacheServiceMock: {
    saveAliases: jest.Mock;
    load: jest.Mock;
  };
  let historyServiceMock: {
    findTxByHash: jest.Mock;
  };
  let queryServiceMock: {
    queryPacketEventsByTxHash: jest.Mock;
    queryClientEventsByTxHash: jest.Mock;
  };

  beforeEach(() => {
    lucidServiceMock = {
      LucidImporter: {
        CML,
        SLOT_CONFIG_NETWORK: {
          Custom: { zeroTime: 0, zeroSlot: 0, slotLength: 1000 },
        },
      },
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
        if (key === 'cardanoNetwork') {
          return 'Custom';
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
      peek: jest.fn().mockReturnValue(undefined),
      takeByExpectedRoot: jest.fn().mockReturnValue(undefined),
    };

    ibcTreeCacheServiceMock = {
      saveAliases: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue(null),
    };
    historyServiceMock = { findTxByHash: jest.fn() };
    queryServiceMock = {
      queryPacketEventsByTxHash: jest.fn().mockResolvedValue({ events: [] }),
      queryClientEventsByTxHash: jest.fn().mockResolvedValue({ events: [] }),
    };

    service = new SubmissionService(
      lucidServiceMock as any,
      configServiceMock as any,
      txEventsServiceMock as any,
      ibcTreePendingUpdatesServiceMock as any,
      ibcTreeCacheServiceMock as any,
      historyServiceMock as any,
      queryServiceMock as any,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
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
    jest.spyOn(service as any, 'readConfirmedTxRoot').mockRejectedValueOnce(new Error('hoststate unavailable'));

    await expect((service as any).applyPendingIbcTreeUpdate('deadbeef', 'tx-hash-abc', 9999)).rejects.toThrow();
  });

  it('accepts a registered tree-neutral staged verification transaction without reading HostState', async () => {
    ibcTreePendingUpdatesServiceMock.take.mockReturnValueOnce({
      kind: 'tree_neutral',
      expectedNewRoot: '',
      commit: jest.fn(),
    });
    const readConfirmedTxRoot = jest.spyOn(service as any, 'readConfirmedTxRoot');

    await expect((service as any).applyPendingIbcTreeUpdate('deadbeef', 'tx-hash-abc', 9999)).resolves.toBeUndefined();

    expect(readConfirmedTxRoot).not.toHaveBeenCalled();
    expect(ibcTreeCacheServiceMock.saveAliases).not.toHaveBeenCalled();
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

  it('returns immediately after node acceptance for an eligible submit-only transaction', async () => {
    jest.spyOn(service as any, 'assertTreeNeutralSessionEligible').mockReturnValueOnce('body-hash');
    const submitToCardano = jest.spyOn(service as any, 'submitToCardano').mockResolvedValueOnce('body-hash');
    const waitForIndexedConfirmation = jest.spyOn(service as any, 'waitForIndexedConfirmation');
    const applyPendingIbcTreeUpdate = jest.spyOn(service as any, 'applyPendingIbcTreeUpdate');

    await expect(
      service.submitSignedTransaction({
        signed_tx_cbor: 'deadbeef',
        submit_only: true,
      }),
    ).resolves.toEqual({ tx_hash: 'body-hash', height: '', events: [] });

    expect(submitToCardano).toHaveBeenCalledTimes(1);
    expect(submitToCardano).toHaveBeenCalledWith(
      'deadbeef',
      expect.objectContaining({
        allowDependencyBackpressure: false,
        reconcileFirstLinkDependencyFailure: true,
      }),
    );
    expect(waitForIndexedConfirmation).not.toHaveBeenCalled();
    expect(applyPendingIbcTreeUpdate).not.toHaveBeenCalled();
    expect(ibcTreePendingUpdatesServiceMock.take).toHaveBeenCalledWith('body-hash');
  });

  it('allows long dependency retry only for a later link in a staged chain', async () => {
    jest.spyOn(service as any, 'assertTreeNeutralSessionEligible').mockReturnValueOnce('body-hash');
    const submitToCardano = jest.spyOn(service as any, 'submitToCardano').mockResolvedValueOnce('body-hash');

    await service.submitSignedTransaction({
      signed_tx_cbor: 'deadbeef',
      submit_only: true,
      has_prior_dependency: true,
    });

    expect(submitToCardano).toHaveBeenCalledWith(
      'deadbeef',
      expect.objectContaining({
        allowDependencyBackpressure: true,
        reconcileFirstLinkDependencyFailure: false,
      }),
    );
  });

  it('confirms a cleanup-final tree-neutral transaction without HostState finalization or events', async () => {
    jest.spyOn(service as any, 'assertTreeNeutralSessionEligible').mockReturnValueOnce('body-hash');
    jest.spyOn(service as any, 'submitToCardano').mockResolvedValueOnce('body-hash');
    const waitForIndexedConfirmation = jest
      .spyOn(service as any, 'waitForIndexedConfirmation')
      .mockResolvedValueOnce(1234);
    const applyPendingIbcTreeUpdate = jest.spyOn(service as any, 'applyPendingIbcTreeUpdate');

    await expect(
      service.submitSignedTransaction({
        signed_tx_cbor: 'deadbeef',
        tree_neutral: true,
        confirmation_timeout_seconds: 1800,
      }),
    ).resolves.toEqual({
      tx_hash: 'body-hash',
      height: '0-1234',
      events: [],
    });

    expect(waitForIndexedConfirmation).toHaveBeenCalledWith('body-hash', 1_800_000);
    expect(applyPendingIbcTreeUpdate).not.toHaveBeenCalled();
    expect(txEventsServiceMock.take).not.toHaveBeenCalled();
    expect(queryServiceMock.queryClientEventsByTxHash).not.toHaveBeenCalled();
    expect(ibcTreePendingUpdatesServiceMock.take).toHaveBeenCalledWith('body-hash');
  });

  it('rejects an ineligible submit-only transaction before node submission', async () => {
    jest.spyOn(service as any, 'assertTreeNeutralSessionEligible').mockImplementationOnce(() => {
      throw new Error('contains HostState NFT');
    });
    const submitToCardano = jest.spyOn(service as any, 'submitToCardano');

    await expect(
      service.submitSignedTransaction({
        signed_tx_cbor: 'deadbeef',
        submit_only: true,
      }),
    ).rejects.toThrow('contains HostState NFT');
    expect(submitToCardano).not.toHaveBeenCalled();
  });

  it('rejects a forged ordinary transaction marked tree-neutral before node submission', async () => {
    jest.spyOn(service as any, 'assertTreeNeutralSessionEligible').mockImplementationOnce(() => {
      throw new Error('not a staged-session transaction');
    });
    const submitToCardano = jest.spyOn(service as any, 'submitToCardano');

    await expect(
      service.submitSignedTransaction({
        signed_tx_cbor: 'deadbeef',
        tree_neutral: true,
      }),
    ).rejects.toThrow('not a staged-session transaction');
    expect(submitToCardano).not.toHaveBeenCalled();
  });

  it('rejects a confirmation timeout combined with submit-only', async () => {
    const submitToCardano = jest.spyOn(service as any, 'submitToCardano');

    await expect(
      service.submitSignedTransaction({
        signed_tx_cbor: 'deadbeef',
        submit_only: true,
        confirmation_timeout_seconds: 1,
      }),
    ).rejects.toThrow('not allowed with submit_only');
    expect(submitToCardano).not.toHaveBeenCalled();
  });

  it('rejects submit-only when the body hash is registered as a HostState update', () => {
    jest.spyOn(service as any, 'computeTxBodyHashHex').mockReturnValueOnce('body-hash');
    ibcTreePendingUpdatesServiceMock.peek.mockReturnValueOnce({
      kind: 'tree_update',
      expectedNewRoot: 'root',
      commit: jest.fn(),
    });

    expect(() => (service as any).assertTreeNeutralSessionEligible('deadbeef')).toThrow(
      'registered HostState tree update',
    );
  });

  it('uses the requested bounded final-chain confirmation timeout', async () => {
    const submitToCardano = jest.spyOn(service as any, 'submitToCardano').mockResolvedValueOnce('tx-hash-abc');
    const waitForIndexedConfirmation = jest
      .spyOn(service as any, 'waitForIndexedConfirmation')
      .mockResolvedValueOnce(1234);
    jest.spyOn(service as any, 'applyPendingIbcTreeUpdate').mockResolvedValueOnce(undefined);

    await service.submitSignedTransaction({
      signed_tx_cbor: 'deadbeef',
      confirmation_timeout_seconds: 30 * 60,
    });

    expect(waitForIndexedConfirmation).toHaveBeenCalledWith('tx-hash-abc', 30 * 60 * 1000);
    expect(submitToCardano).toHaveBeenCalledWith(
      'deadbeef',
      expect.objectContaining({
        allowMempoolBackpressure: true,
        allowDependencyBackpressure: false,
        reconcileFirstLinkDependencyFailure: true,
      }),
    );
  });

  it('keeps the ordinary 180-second singleton timeout', async () => {
    jest.spyOn(service as any, 'submitToCardano').mockResolvedValueOnce('tx-hash-abc');
    const waitForIndexedConfirmation = jest
      .spyOn(service as any, 'waitForIndexedConfirmation')
      .mockResolvedValueOnce(1234);
    jest.spyOn(service as any, 'applyPendingIbcTreeUpdate').mockResolvedValueOnce(undefined);

    await service.submitSignedTransaction({ signed_tx_cbor: 'deadbeef' });

    expect(waitForIndexedConfirmation).toHaveBeenCalledWith('tx-hash-abc', 180_000);
  });

  it('rejects prior-dependency retry context on an ordinary singleton', async () => {
    const submitToCardano = jest.spyOn(service as any, 'submitToCardano');

    await expect(
      service.submitSignedTransaction({
        signed_tx_cbor: 'deadbeef',
        has_prior_dependency: true,
      }),
    ).rejects.toThrow('has_prior_dependency is only valid for a staged transaction chain');

    expect(submitToCardano).not.toHaveBeenCalled();
  });

  it('recovers final client events by exact tx hash and de-duplicates combined fallback events', async () => {
    jest.spyOn(service as any, 'submitToCardano').mockResolvedValueOnce('tx-hash-abc');
    jest.spyOn(service as any, 'waitForIndexedConfirmation').mockResolvedValueOnce(1234);
    jest.spyOn(service as any, 'applyPendingIbcTreeUpdate').mockResolvedValueOnce(undefined);
    const recovered = {
      type: 'update_client',
      attributes: [{ key: 'client_id', value: '07-tendermint-0' }],
    };
    queryServiceMock.queryClientEventsByTxHash.mockResolvedValueOnce({
      events: [recovered],
    });
    queryServiceMock.queryPacketEventsByTxHash.mockResolvedValueOnce({
      events: [
        {
          type: recovered.type,
          attributes: { client_id: '07-tendermint-0' },
        },
      ],
    });

    await expect(service.submitSignedTransaction({ signed_tx_cbor: 'deadbeef' })).resolves.toEqual(
      expect.objectContaining({ events: [recovered] }),
    );
    expect(queryServiceMock.queryClientEventsByTxHash).toHaveBeenCalledWith('tx-hash-abc');
    expect(queryServiceMock.queryPacketEventsByTxHash).toHaveBeenCalledWith('tx-hash-abc');
  });

  it('rejects an unbounded confirmation timeout before node submission', async () => {
    const submitToCardano = jest.spyOn(service as any, 'submitToCardano');

    await expect(
      service.submitSignedTransaction({
        signed_tx_cbor: 'deadbeef',
        confirmation_timeout_seconds: 1801,
      }),
    ).rejects.toThrow('between 0 and 1800');
    expect(submitToCardano).not.toHaveBeenCalled();
  });

  it('retries bounded mempool backpressure without waiting for indexing', async () => {
    const submitTx = jest.fn().mockRejectedValueOnce(new Error('Mempool is full')).mockResolvedValueOnce('body-hash');
    lucidServiceMock.lucid.wallet.mockReturnValue({ submitTx });
    jest.spyOn(service as any, 'computeBackpressureDeadline').mockResolvedValue({
      deadlineMs: Date.now() + 60_000,
      validityUpperBoundSlot: 1234n,
    });
    const wait = jest.spyOn(service as any, 'waitBeforeSubmissionRetry').mockResolvedValue(undefined);

    await expect(
      (service as any).submitToCardano('deadbeef', {
        expectedTxHash: 'body-hash',
        allowMempoolBackpressure: true,
      }),
    ).resolves.toBe('body-hash');
    expect(submitTx).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(5000);
  });

  it('stops backpressure retries at the transaction validity deadline', async () => {
    const submitTx = jest.fn().mockRejectedValue(new Error('Unknown output reference'));
    lucidServiceMock.lucid.wallet.mockReturnValue({ submitTx });
    jest.spyOn(service as any, 'computeBackpressureDeadline').mockResolvedValue({
      deadlineMs: Date.now() + 1000,
      validityUpperBoundSlot: 1234n,
    });
    const wait = jest.spyOn(service as any, 'waitBeforeSubmissionRetry');

    await expect(
      (service as any).submitToCardano('deadbeef', {
        expectedTxHash: 'body-hash',
        allowDependencyBackpressure: true,
      }),
    ).rejects.toThrow('backpressure deadline reached before transaction validity upper bound slot 1234');
    expect(submitTx).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('treats an already-in-mempool resubmission idempotently', async () => {
    const submitTx = jest.fn().mockRejectedValueOnce(new Error('Transaction already in mempool'));
    lucidServiceMock.lucid.wallet.mockReturnValue({ submitTx });

    await expect(
      (service as any).submitToCardano('deadbeef', {
        expectedTxHash: 'body-hash',
        allowMempoolBackpressure: true,
      }),
    ).resolves.toBe('body-hash');
    expect(submitTx).toHaveBeenCalledTimes(1);
  });

  it('reconciles a lost first-link submit response by exact hash without resubmitting', async () => {
    jest.useFakeTimers();
    const submitTx = jest.fn().mockRejectedValueOnce(new Error('Unknown output reference'));
    lucidServiceMock.lucid.wallet.mockReturnValue({ submitTx });
    historyServiceMock.findTxByHash
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ block_no: 1234 });

    const submission = (service as any).submitToCardano('deadbeef', {
      expectedTxHash: 'body-hash',
      allowMempoolBackpressure: true,
      allowDependencyBackpressure: false,
      reconcileFirstLinkDependencyFailure: true,
    });
    const result = expect(submission).resolves.toBe('body-hash');

    await jest.advanceTimersByTimeAsync(4_000);
    await result;

    expect(historyServiceMock.findTxByHash).toHaveBeenCalledTimes(3);
    expect(historyServiceMock.findTxByHash).toHaveBeenCalledWith('body-hash');
    expect(submitTx).toHaveBeenCalledTimes(1);
  });

  it('fails a never-indexed first-link dependency input after only the short reconciliation grace', async () => {
    jest.useFakeTimers();
    const submitTx = jest.fn().mockRejectedValueOnce(new Error('BadInputsUTxO'));
    lucidServiceMock.lucid.wallet.mockReturnValue({ submitTx });
    historyServiceMock.findTxByHash.mockResolvedValue(undefined);

    const submission = (service as any).submitToCardano('deadbeef', {
      expectedTxHash: 'body-hash',
      allowMempoolBackpressure: true,
      allowDependencyBackpressure: false,
      reconcileFirstLinkDependencyFailure: true,
    });
    const result = expect(submission).rejects.toThrow(
      'not indexed during the 30-second exact-hash reconciliation grace',
    );

    await jest.advanceTimersByTimeAsync(30_000);
    await result;

    expect(submitTx).toHaveBeenCalledTimes(1);
    expect(historyServiceMock.findTxByHash).toHaveBeenCalledTimes(16);
  });

  it('derives the backpressure deadline from the signed body TTL and live node slot', async () => {
    const body = CML.TransactionBody.new(CML.TransactionInputList.new(), CML.TransactionOutputList.new(), 0n);
    body.set_ttl(1000n);
    const cbor = CML.Transaction.new(body, CML.TransactionWitnessSet.new(), true).to_cbor_hex();
    jest.spyOn(timeHelpers, 'queryNetworkTipPoint').mockResolvedValueOnce({ slot: 900, id: 'aa'.repeat(32) });
    const before = Date.now();

    const result = await (service as any).computeBackpressureDeadline(cbor);

    expect(result.validityUpperBoundSlot).toBe(1000n);
    expect(result.deadlineMs).toBeGreaterThanOrEqual(before + 100_000);
    expect(result.deadlineMs).toBeLessThanOrEqual(Date.now() + 100_000);
  });

  it('persists confirmed IBC tree snapshots by current id, root, and block height', async () => {
    const commit = jest.fn();
    ibcTreePendingUpdatesServiceMock.take.mockReturnValueOnce({
      expectedNewRoot: 'ab'.repeat(32),
      commit,
    });
    jest.spyOn(service as any, 'readConfirmedTxRoot').mockResolvedValueOnce('ab'.repeat(32));

    await (service as any).applyPendingIbcTreeUpdate('deadbeef', 'tx-hash-abc', 9999);

    expect(commit).toHaveBeenCalled();
    expect(ibcTreeCacheServiceMock.saveAliases).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['current', `root:${'ab'.repeat(32)}`, 'height:9999']),
    );
  });
});
