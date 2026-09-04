import { TRANSACTION_SET_COLLATERAL } from '~@/config/constant.config';

import { TxOperationRunnerService } from '../tx-operation-runner.service';

describe('TxOperationRunnerService', () => {
  const makeService = () => {
    const walletSelectionState = {
      nextScopeId: 0,
      activeScopeId: null as number | null,
      explicitSelectionScopeId: null as number | null,
    };
    const lucidService = {
      beginWalletSelectionScope: jest.fn(() => {
        const scopeId = ++walletSelectionState.nextScopeId;
        walletSelectionState.activeScopeId = scopeId;
        walletSelectionState.explicitSelectionScopeId = null;
        return scopeId;
      }),
      assertWalletSelectionScopeSatisfied: jest.fn((scopeId: number, operationName: string) => {
        if (
          walletSelectionState.activeScopeId !== scopeId ||
          walletSelectionState.explicitSelectionScopeId !== scopeId
        ) {
          throw new Error(`${operationName} failed: no explicit address-backed wallet context was selected before complete()`);
        }
      }),
      endWalletSelectionScope: jest.fn((scopeId: number) => {
        if (walletSelectionState.activeScopeId === scopeId) {
          walletSelectionState.activeScopeId = null;
          walletSelectionState.explicitSelectionScopeId = null;
        }
      }),
      selectWalletFromAddress: jest.fn(() => {
        walletSelectionState.explicitSelectionScopeId = walletSelectionState.activeScopeId;
      }),
    } as any;
    const walletContextService = {
      selectWalletFromAddressWithRetry: jest.fn(async () => {
        lucidService.selectWalletFromAddress();
      }),
    } as any;
    const txEventsService = {
      register: jest.fn(),
    } as any;
    const ibcTreePendingUpdatesService = {
      register: jest.fn(),
    } as any;

    const service = new TxOperationRunnerService(
      lucidService,
      walletContextService,
      txEventsService,
      ibcTreePendingUpdatesService,
    );

    return {
      service,
      lucidService,
      walletContextService,
      txEventsService,
      ibcTreePendingUpdatesService,
    };
  };

  it('completes tx and registers pending update/events for refresh wallet mode', async () => {
    const {
      service,
      lucidService,
      walletContextService,
      txEventsService,
      ibcTreePendingUpdatesService,
    } = makeService();

    const completedTx = {
      toCBOR: jest.fn().mockReturnValue('84a30081825820deadbeef'),
      toHash: jest.fn().mockReturnValue('txhash-create-client'),
    };

    const complete = jest.fn().mockResolvedValue(completedTx);
    const txBuilder = { complete } as any;

    const pendingTreeUpdate = {
      expectedNewRoot: 'abc123',
      commit: jest.fn(),
    };
    const syntheticEvents = [
      {
        type: 'create_client',
        attributes: [{ key: 'client_id', value: '07-tendermint-0' }],
      },
    ];

    const result = await service.run({
      operationName: 'createClient',
      unsignedTx: txBuilder,
      validity: {
        apply: () => txBuilder,
      },
      wallet: {
        mode: 'refresh_from_address',
        address: 'addr_test1xyz',
        context: 'createClient',
      },
      pendingTreeUpdate,
      syntheticEvents,
    });

    expect(walletContextService.selectWalletFromAddressWithRetry).toHaveBeenCalledWith(
      'addr_test1xyz',
      'createClient',
    );
    expect(lucidService.beginWalletSelectionScope).toHaveBeenCalledTimes(1);
    expect(lucidService.assertWalletSelectionScopeSatisfied).toHaveBeenCalledTimes(1);
    expect(lucidService.endWalletSelectionScope).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith({
      localUPLCEval: false,
      setCollateral: TRANSACTION_SET_COLLATERAL,
    });
    expect(ibcTreePendingUpdatesService.register).toHaveBeenCalledWith(
      'txhash-create-client',
      pendingTreeUpdate,
    );
    expect(txEventsService.register).toHaveBeenCalledWith(
      'txhash-create-client',
      syntheticEvents,
      'abc123',
    );
    expect(result.unsignedTxHash).toBe('txhash-create-client');
    expect(result.unsignedTxCbor).toBe('84a30081825820deadbeef');
    expect(result.unsignedTxBytes).toEqual(new Uint8Array(Buffer.from('84a30081825820deadbeef', 'utf-8')));
  });

  it('runs custom wallet hook and returns extra response fields', async () => {
    const {
      service,
      lucidService,
      walletContextService,
      txEventsService,
      ibcTreePendingUpdatesService,
    } = makeService();

    const customWalletHook = jest.fn().mockImplementation(async () => {
      lucidService.selectWalletFromAddress();
    });
    const txBuilder = {
      complete: jest.fn().mockResolvedValue({
        toCBOR: () => 'deadbeef',
        toHash: () => 'txhash-send-packet',
      }),
    } as any;

    const result = await service.run({
      operationName: 'sendPacket',
      unsignedTx: txBuilder,
      validity: {
        apply: () => txBuilder,
      },
      wallet: {
        mode: 'custom_before_complete',
        run: customWalletHook,
      },
      extraResponseFields: {
        result: 'RESPONSE_RESULT_TYPE_UNSPECIFIED',
      },
    });

    expect(customWalletHook).toHaveBeenCalledTimes(1);
    expect(walletContextService.selectWalletFromAddressWithRetry).not.toHaveBeenCalled();
    expect(ibcTreePendingUpdatesService.register).not.toHaveBeenCalled();
    expect(txEventsService.register).not.toHaveBeenCalled();
    expect(result.extraResponseFields).toEqual({
      result: 'RESPONSE_RESULT_TYPE_UNSPECIFIED',
    });
  });

  it('fails hard when no explicit wallet selection happened before complete', async () => {
    const { service } = makeService();

    const txBuilder = {
      complete: jest.fn(),
    } as any;

    await expect(
      service.run({
        operationName: 'recvPacket',
        unsignedTx: txBuilder,
        validity: {
          apply: () => txBuilder,
        },
        wallet: {
          mode: 'custom_before_complete',
          run: async () => {},
        },
      }),
    ).rejects.toThrow('recvPacket failed: no explicit address-backed wallet context was selected before complete()');
    expect(txBuilder.complete).not.toHaveBeenCalled();
  });

  it('propagates complete() errors after explicit wallet selection', async () => {
    const { service, lucidService } = makeService();

    const expectedError = new Error('completion failed');
    const txBuilder = {
      complete: jest.fn().mockRejectedValue(expectedError),
    } as any;

    await expect(
      service.run({
        operationName: 'recvPacket',
        unsignedTx: txBuilder,
        validity: {
          apply: () => txBuilder,
        },
        wallet: {
          mode: 'custom_before_complete',
          run: async () => {
            lucidService.selectWalletFromAddress();
          },
        },
      }),
    ).rejects.toBe(expectedError);
  });

  it('rebuilds a fresh unsigned tx for retry attempts when configured', async () => {
    const { service, lucidService } = makeService();

    const transientError = new Error('kupmios transport error');
    const completedTx = {
      toCBOR: jest.fn().mockReturnValue('84a30081825820deadbeef'),
      toHash: jest.fn().mockReturnValue('txhash-connection-open-ack'),
    };

    const txBuilderFirst = {
      complete: jest.fn().mockRejectedValue(transientError),
    } as any;
    const txBuilderSecond = {
      complete: jest.fn().mockResolvedValue(completedTx),
    } as any;
    const rebuildUnsignedTx = jest.fn().mockResolvedValue(txBuilderSecond);
    const validityApply = jest.fn().mockImplementation((builder) => builder);

    const result = await service.run({
      operationName: 'connectionOpenAck',
      unsignedTx: txBuilderFirst,
      rebuildUnsignedTx,
      validity: {
        apply: validityApply,
      },
      wallet: {
        mode: 'custom_before_complete',
        run: async () => {
          lucidService.selectWalletFromAddress();
        },
      },
      completeRetry: {
        maxAttempts: 2,
        isRetryable: (error) => error === transientError,
        getDelayMs: () => 0,
      },
    });

    expect(txBuilderFirst.complete).toHaveBeenCalledTimes(1);
    expect(txBuilderSecond.complete).toHaveBeenCalledTimes(1);
    expect(rebuildUnsignedTx).toHaveBeenCalledTimes(1);
    expect(validityApply).toHaveBeenNthCalledWith(1, txBuilderFirst);
    expect(validityApply).toHaveBeenNthCalledWith(2, txBuilderSecond);
    expect(result.unsignedTxHash).toBe('txhash-connection-open-ack');
  });

  it('does not retry a mutable tx builder without a fresh rebuild callback', async () => {
    const { service, lucidService } = makeService();

    const retryableError = new Error('completion timeout');
    const txBuilder = {
      complete: jest.fn().mockRejectedValue(retryableError),
    } as any;
    const onRetry = jest.fn();

    await expect(
      service.run({
        operationName: 'timeoutPacket',
        unsignedTx: txBuilder,
        validity: {
          apply: () => txBuilder,
        },
        wallet: {
          mode: 'custom_before_complete',
          run: async () => {
            lucidService.selectWalletFromAddress();
          },
        },
        completeRetry: {
          maxAttempts: 2,
          isRetryable: () => true,
          getDelayMs: () => 0,
          onRetry,
        },
      }),
    ).rejects.toBe(retryableError);

    expect(txBuilder.complete).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('registers the pending tree update from the successful rebuilt attempt', async () => {
    const { service, lucidService, ibcTreePendingUpdatesService } = makeService();

    const transientError = new Error('kupmios timeout');
    const pendingTreeUpdateFirst = {
      expectedNewRoot: 'first-root',
      commit: jest.fn(),
    };
    const pendingTreeUpdateSecond = {
      expectedNewRoot: 'second-root',
      commit: jest.fn(),
    };
    let currentPendingTreeUpdate = pendingTreeUpdateFirst;
    const completedTx = {
      toCBOR: jest.fn().mockReturnValue('84a30081825820feedface'),
      toHash: jest.fn().mockReturnValue('txhash-timeout-packet'),
    };
    const txBuilderFirst = {
      complete: jest.fn().mockRejectedValue(transientError),
    } as any;
    const txBuilderSecond = {
      complete: jest.fn().mockResolvedValue(completedTx),
    } as any;
    const rebuildUnsignedTx = jest.fn().mockImplementation(async () => {
      currentPendingTreeUpdate = pendingTreeUpdateSecond;
      return txBuilderSecond;
    });

    await service.run({
      operationName: 'timeoutPacket',
      unsignedTx: txBuilderFirst,
      rebuildUnsignedTx,
      validity: {
        apply: (builder) => builder,
      },
      wallet: {
        mode: 'custom_before_complete',
        run: async () => {
          lucidService.selectWalletFromAddress();
        },
      },
      completeRetry: {
        maxAttempts: 2,
        isRetryable: (error) => error === transientError,
        getDelayMs: () => 0,
      },
      pendingTreeUpdate: () => currentPendingTreeUpdate,
    });

    expect(rebuildUnsignedTx).toHaveBeenCalledTimes(1);
    expect(ibcTreePendingUpdatesService.register).toHaveBeenCalledWith(
      'txhash-timeout-packet',
      pendingTreeUpdateSecond,
    );
  });

  it('holds one completion lock while threading wallet inputs through a transaction chain', async () => {
    const {
      service,
      lucidService,
      walletContextService,
      txEventsService,
      ibcTreePendingUpdatesService,
    } = makeService();
    const firstWalletInputs = [{ txHash: 'wallet-change-1', outputIndex: 0 }];
    const secondWalletInputs = [{ txHash: 'wallet-change-2', outputIndex: 0 }];
    const firstDerived = [{ txHash: 'first', outputIndex: 0 }];
    const secondDerived = [{ txHash: 'second', outputIndex: 0 }];
    const firstCompleted = { toCBOR: () => '01', toHash: () => 'first-hash' };
    const secondCompleted = { toCBOR: () => '02', toHash: () => 'second-hash' };
    const firstBuilder = {
      chain: jest.fn().mockResolvedValue([firstWalletInputs, firstDerived, firstCompleted]),
    } as any;
    const secondBuilder = {
      chain: jest.fn().mockResolvedValue([secondWalletInputs, secondDerived, secondCompleted]),
    } as any;
    const firstPending = { kind: 'tree_neutral' as const, expectedNewRoot: '', commit: jest.fn() };
    const finalPending = { expectedNewRoot: 'final-root', commit: jest.fn() };
    const finalEvents = [{ type: 'update_client', attributes: [] }];

    const result = await service.runChain({
      operationName: 'updateClientChain',
      wallet: {
        mode: 'refresh_from_address',
        address: 'addr_test1chain',
        context: 'updateClientChain',
      },
      build: async ({ complete }) => {
        const first = await complete({
          operationName: 'first',
          unsignedTx: firstBuilder,
          validity: { apply: (builder) => builder },
          pendingTreeUpdate: firstPending,
        });
        expect(first.derivedOutputs).toBe(firstDerived);
        await complete({
          operationName: 'second',
          unsignedTx: secondBuilder,
          validity: { apply: (builder) => builder },
          pendingTreeUpdate: finalPending,
          syntheticEvents: finalEvents,
        });
        return 'built';
      },
    });

    expect(result.value).toBe('built');
    expect(result.links.map((link) => link.unsignedTxHash)).toEqual(['first-hash', 'second-hash']);
    expect(firstBuilder.chain).toHaveBeenCalledWith({
      localUPLCEval: false,
      setCollateral: TRANSACTION_SET_COLLATERAL,
    });
    expect(secondBuilder.chain).toHaveBeenCalledWith({
      localUPLCEval: false,
      setCollateral: TRANSACTION_SET_COLLATERAL,
      presetWalletInputs: firstWalletInputs,
    });
    expect(walletContextService.selectWalletFromAddressWithRetry).toHaveBeenCalledTimes(1);
    expect(lucidService.beginWalletSelectionScope).toHaveBeenCalledTimes(1);
    expect(lucidService.endWalletSelectionScope).toHaveBeenCalledTimes(1);
    expect(lucidService.selectWalletFromAddress).toHaveBeenCalledWith('addr_test1chain', firstWalletInputs);
    expect(ibcTreePendingUpdatesService.register.mock.calls).toEqual([
      ['first-hash', firstPending],
      ['second-hash', finalPending],
    ]);
    expect(txEventsService.register).toHaveBeenCalledWith('second-hash', finalEvents, 'final-root');
  });

  it('does not register partial chain metadata when a later link fails', async () => {
    const { service, lucidService, ibcTreePendingUpdatesService } = makeService();
    const firstBuilder = {
      chain: jest.fn().mockResolvedValue([
        [],
        [],
        { toCBOR: () => '01', toHash: () => 'first-hash' },
      ]),
    } as any;
    const failure = new Error('second chain link failed');
    const secondBuilder = { chain: jest.fn().mockRejectedValue(failure) } as any;

    await expect(
      service.runChain({
        operationName: 'failedChain',
        wallet: {
          mode: 'custom_before_complete',
          run: async () => lucidService.selectWalletFromAddress(),
        },
        build: async ({ complete }) => {
          await complete({
            operationName: 'first',
            unsignedTx: firstBuilder,
            validity: { apply: (builder) => builder },
            pendingTreeUpdate: { kind: 'tree_neutral', expectedNewRoot: '', commit: jest.fn() },
          });
          await complete({
            operationName: 'second',
            unsignedTx: secondBuilder,
            validity: { apply: (builder) => builder },
          });
        },
      }),
    ).rejects.toBe(failure);

    expect(ibcTreePendingUpdatesService.register).not.toHaveBeenCalled();
    expect(lucidService.endWalletSelectionScope).toHaveBeenCalledTimes(1);
  });
});
