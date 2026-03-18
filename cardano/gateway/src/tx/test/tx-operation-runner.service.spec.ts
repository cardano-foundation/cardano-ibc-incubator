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
    expect(txEventsService.register).toHaveBeenCalledWith('txhash-create-client', syntheticEvents);
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
});
