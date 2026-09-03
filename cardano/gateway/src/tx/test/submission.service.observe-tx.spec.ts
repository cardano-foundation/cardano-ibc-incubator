import { IbcTreePendingUpdatesService } from '../../shared/services/ibc-tree-pending-updates.service';
import { SubmissionService } from '../submission.service';

describe('SubmissionService ObserveTx', () => {
  const txHash = 'ab'.repeat(32);
  const otherTxHash = 'cd'.repeat(32);
  const confirmedRoot = '12'.repeat(32);
  const txCborHex = '84a0a0f5f6';
  const txBodyCborHex = 'a0';
  const hostStateDatumCborHex = 'd87980';

  let service: SubmissionService;
  let lucidService: {
    LucidImporter: { CML: Record<string, any> };
    decodeDatum: jest.Mock;
  };
  let pendingUpdates: IbcTreePendingUpdatesService;
  let historyService: {
    findTransactionEvidenceByHash: jest.Mock;
  };
  let txEventsService: {
    take: jest.Mock;
    takeByExpectedRoot: jest.Mock;
  };
  let queryService: {
    queryPacketEventsByTxHash: jest.Mock;
  };
  let previousCacheSetting: string | undefined;

  const evidence = () => ({
    txHash,
    blockNo: 4321,
    blockHash: 'ef'.repeat(32),
    slotNo: 123n,
    txIndex: 0,
    txCborHex,
    txBodyCborHex,
    redeemers: [],
    hostStateOutputIndex: 0,
    hostStateDatum: hostStateDatumCborHex,
    hostStateRoot: confirmedRoot,
  });

  beforeEach(() => {
    previousCacheSetting = process.env.IBC_TREE_CACHE_ENABLED;
    process.env.IBC_TREE_CACHE_ENABLED = 'false';

    pendingUpdates = new IbcTreePendingUpdatesService();
    const hostStateOutput = {
      amount: () => ({
        has_multiassets: () => true,
        multi_asset: () => ({ get: () => 1n }),
      }),
      datum: () => ({
        as_datum: () => ({ to_cbor_hex: (): string => hostStateDatumCborHex }),
      }),
    };
    const transactionBody = {
      to_cbor_hex: () => txBodyCborHex,
      outputs: () => ({
        len: () => 1,
        get: () => hostStateOutput,
      }),
    };
    const CML = {
      Transaction: {
        from_cbor_hex: jest.fn((value: string) => {
          if (value !== txCborHex) throw new Error('not a full transaction');
          return { body: () => transactionBody, is_valid: () => true };
        }),
      },
      TransactionBody: {
        from_cbor_hex: jest.fn((value: string) => {
          if (value === txBodyCborHex) return transactionBody;
          if (value === 'a1') return { to_cbor_hex: (): string => 'a1' };
          throw new Error('not a transaction body');
        }),
      },
      ScriptHash: { from_hex: jest.fn((value: string) => value) },
      AssetName: { from_hex: jest.fn((value: string) => value) },
      hash_transaction: jest.fn(() => ({ to_hex: () => txHash })),
    };
    lucidService = {
      LucidImporter: { CML },
      decodeDatum: jest.fn().mockResolvedValue({
        state: { ibc_state_root: confirmedRoot },
      }),
    };
    historyService = {
      findTransactionEvidenceByHash: jest.fn().mockResolvedValue(evidence()),
    };
    txEventsService = {
      take: jest.fn().mockReturnValue([
        {
          type: 'send_packet',
          attributes: [{ key: 'packet_sequence', value: '7' }],
        },
      ]),
      takeByExpectedRoot: jest.fn(),
    };
    queryService = {
      queryPacketEventsByTxHash: jest.fn().mockResolvedValue({ events: [] }),
    };

    service = new SubmissionService(
      lucidService as any,
      {
        get: jest.fn().mockReturnValue({
          hostStateNFT: { policyId: '11'.repeat(28), name: 'host-state' },
        }),
      } as any,
      txEventsService as any,
      pendingUpdates,
      { saveAliases: jest.fn() } as any,
      historyService as any,
      queryService as any,
    );
  });

  afterEach(() => {
    if (previousCacheSetting === undefined) {
      delete process.env.IBC_TREE_CACHE_ENABLED;
    } else {
      process.env.IBC_TREE_CACHE_ENABLED = previousCacheSetting;
    }
  });

  it('observes a full-transaction history record and commits the exact pending update', async () => {
    const commit = jest.fn();
    pendingUpdates.register(txHash, { expectedNewRoot: confirmedRoot, commit });

    await expect(service.observeTransaction({ tx_hash: txHash })).resolves.toEqual({
      tx_hash: txHash,
      height: '0-4321',
      events: [
        {
          type: 'send_packet',
          attributes: [{ key: 'packet_sequence', value: '7' }],
        },
      ],
    });

    expect(historyService.findTransactionEvidenceByHash).toHaveBeenCalledWith(txHash);
    expect(lucidService.LucidImporter.CML.Transaction.from_cbor_hex).toHaveBeenCalledWith(txCborHex);
    expect(lucidService.LucidImporter.CML.hash_transaction).toHaveBeenCalled();
    expect(lucidService.decodeDatum).toHaveBeenCalledWith(hostStateDatumCborHex, 'host_state');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(pendingUpdates.peek(txHash)).toBeUndefined();
  });

  it('observes Yaci body-only transaction_cbor evidence safely', async () => {
    const commit = jest.fn();
    pendingUpdates.register(txHash, { expectedNewRoot: confirmedRoot, commit });
    historyService.findTransactionEvidenceByHash.mockResolvedValue({
      ...evidence(),
      txCborHex: txBodyCborHex,
    });

    await expect(service.observeTransaction({ tx_hash: txHash })).resolves.toMatchObject({
      tx_hash: txHash,
      height: '0-4321',
    });

    expect(lucidService.LucidImporter.CML.Transaction.from_cbor_hex).toHaveBeenCalledWith(txBodyCborHex);
    expect(lucidService.LucidImporter.CML.TransactionBody.from_cbor_hex).toHaveBeenCalledWith(txBodyCborHex);
    expect(lucidService.decodeDatum).toHaveBeenCalledWith(hostStateDatumCborHex, 'host_state');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('rejects a confirmed full transaction envelope marked invalid', async () => {
    const commit = jest.fn();
    pendingUpdates.register(txHash, { expectedNewRoot: confirmedRoot, commit });
    lucidService.LucidImporter.CML.Transaction.from_cbor_hex.mockReturnValueOnce({
      body: () => ({ to_cbor_hex: () => txBodyCborHex }),
      is_valid: () => false,
    });

    await expect(service.observeTransaction({ tx_hash: txHash })).rejects.toThrow('marked invalid');

    expect(commit).not.toHaveBeenCalled();
    expect(pendingUpdates.peek(txHash)).toBeDefined();
  });

  it.each(['', 'ab', 'AB'.repeat(32), `${'ab'.repeat(31)}zz`, ` ${txHash}`])(
    'rejects non-canonical transaction hash %p before querying history',
    async (invalidHash) => {
      await expect(service.observeTransaction({ tx_hash: invalidHash })).rejects.toThrow(
        'canonical lowercase 32-byte hexadecimal',
      );
      expect(historyService.findTransactionEvidenceByHash).not.toHaveBeenCalled();
    },
  );

  it('rejects evidence whose confirmed transaction body hashes differently', async () => {
    const commit = jest.fn();
    pendingUpdates.register(txHash, { expectedNewRoot: confirmedRoot, commit });
    lucidService.LucidImporter.CML.hash_transaction.mockReturnValue({
      to_hex: () => otherTxHash,
    });

    await expect(service.observeTransaction({ tx_hash: txHash })).rejects.toThrow(
      'Confirmed transaction body hash mismatch',
    );

    expect(commit).not.toHaveBeenCalled();
    expect(pendingUpdates.peek(txHash)).toBeDefined();
  });

  it('rejects inconsistent transaction and transaction-body evidence', async () => {
    const commit = jest.fn();
    pendingUpdates.register(txHash, { expectedNewRoot: confirmedRoot, commit });
    historyService.findTransactionEvidenceByHash.mockResolvedValue({
      ...evidence(),
      txBodyCborHex: 'a1',
    });

    await expect(service.observeTransaction({ tx_hash: txHash })).rejects.toThrow(
      'History transaction/body CBOR mismatch',
    );
    expect(commit).not.toHaveBeenCalled();
  });

  it('will not finalize an update matched only by HostState root', async () => {
    const commit = jest.fn();
    pendingUpdates.register(otherTxHash, { expectedNewRoot: confirmedRoot, commit });

    await expect(service.observeTransaction({ tx_hash: txHash })).rejects.toThrow('Missing exact pending IBC update');

    expect(commit).not.toHaveBeenCalled();
    expect(pendingUpdates.peek(otherTxHash)).toBeDefined();
    expect(historyService.findTransactionEvidenceByHash).not.toHaveBeenCalled();
    expect(txEventsService.take).not.toHaveBeenCalled();
  });

  it('retains the pending update when the confirmed HostState root does not match', async () => {
    const commit = jest.fn();
    pendingUpdates.register(txHash, { expectedNewRoot: confirmedRoot, commit });
    historyService.findTransactionEvidenceByHash.mockResolvedValue({
      ...evidence(),
      hostStateRoot: otherTxHash,
    });
    lucidService.decodeDatum.mockResolvedValue({
      state: { ibc_state_root: otherTxHash },
    });

    await expect(service.observeTransaction({ tx_hash: txHash })).rejects.toThrow('Confirmed tx root mismatch');

    expect(commit).not.toHaveBeenCalled();
    expect(pendingUpdates.peek(txHash)).toBeDefined();
  });

  it('coalesces concurrent calls and serves later retries from the completed result', async () => {
    let releaseEvidence!: (value: ReturnType<typeof evidence>) => void;
    historyService.findTransactionEvidenceByHash.mockReturnValue(
      new Promise((resolve) => {
        releaseEvidence = resolve;
      }),
    );
    const commit = jest.fn();
    pendingUpdates.register(txHash, { expectedNewRoot: confirmedRoot, commit });

    const first = service.observeTransaction({ tx_hash: txHash });
    const concurrent = service.observeTransaction({ tx_hash: txHash });
    releaseEvidence(evidence());

    const [firstResponse, concurrentResponse] = await Promise.all([first, concurrent]);
    const retryResponse = await service.observeTransaction({ tx_hash: txHash });

    expect(concurrentResponse).toEqual(firstResponse);
    expect(retryResponse).toEqual(firstResponse);
    expect(historyService.findTransactionEvidenceByHash).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(txEventsService.take).toHaveBeenCalledTimes(1);
  });

  it('keeps the exact pending entry retryable when its commit callback fails', async () => {
    const commit = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('transient tree commit failure');
      })
      .mockImplementationOnce(() => undefined);
    const pending = { expectedNewRoot: confirmedRoot, commit };
    pendingUpdates.register(txHash, pending);

    await expect(service.observeTransaction({ tx_hash: txHash })).rejects.toThrow('transient tree commit failure');
    expect(pendingUpdates.peek(txHash)).toBe(pending);

    await expect(service.observeTransaction({ tx_hash: txHash })).resolves.toMatchObject({
      tx_hash: txHash,
      height: '0-4321',
    });
    expect(commit).toHaveBeenCalledTimes(2);
    expect(pendingUpdates.peek(txHash)).toBeUndefined();
  });

  it('does not consume a pending registration replaced while confirmation is in flight', async () => {
    let releaseEvidence!: (value: ReturnType<typeof evidence>) => void;
    historyService.findTransactionEvidenceByHash.mockReturnValue(
      new Promise((resolve) => {
        releaseEvidence = resolve;
      }),
    );
    const firstCommit = jest.fn();
    const replacementCommit = jest.fn();
    pendingUpdates.register(txHash, {
      expectedNewRoot: confirmedRoot,
      commit: firstCommit,
    });

    const observation = service.observeTransaction({ tx_hash: txHash });
    const replacement = {
      expectedNewRoot: confirmedRoot,
      commit: replacementCommit,
    };
    pendingUpdates.register(txHash, replacement);
    releaseEvidence(evidence());

    await expect(observation).rejects.toThrow('changed during finalization');
    expect(firstCommit).not.toHaveBeenCalled();
    expect(replacementCommit).not.toHaveBeenCalled();
    expect(pendingUpdates.peek(txHash)).toBe(replacement);
  });
});
