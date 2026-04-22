import { LucidService } from './lucid.service';

type ChainableTxBuilder = {
  readFrom: jest.Mock;
  collectFrom: jest.Mock;
  mintAssets: jest.Mock;
  pay: {
    ToContract: jest.Mock;
    ToAddress: jest.Mock;
  };
};

const buildRefUtxo = (txHash: string, outputIndex: number) => ({
  txHash,
  outputIndex,
});

const buildValidator = (name: string, outputIndex: number) => ({
  address: `addr_test1_${name}`,
  refUtxo: buildRefUtxo(`${name}-tx`, outputIndex),
});

const deploymentConfig = {
  hostStateNFT: {
    policyId: 'host-state-policy-id',
    name: 'host-state-name',
  },
  validators: {
    spendHandler: buildValidator('spend-handler', 0),
    spendClient: buildValidator('spend-client', 1),
    spendConnection: buildValidator('spend-connection', 2),
    spendChannel: {
      ...buildValidator('spend-channel', 3),
      refValidator: {
        acknowledge_packet: { scriptHash: 'ack-packet-policy-id', refUtxo: buildRefUtxo('ack-packet-tx', 4) },
        chan_close_confirm: {
          scriptHash: 'chan-close-confirm-policy-id',
          refUtxo: buildRefUtxo('close-confirm-tx', 5),
        },
        chan_close_init: { scriptHash: 'chan-close-init-policy-id', refUtxo: buildRefUtxo('close-init-tx', 6) },
        chan_open_ack: { scriptHash: 'chan-open-ack-policy-id', refUtxo: buildRefUtxo('open-ack-tx', 7) },
        chan_open_confirm: { scriptHash: 'chan-open-confirm-policy-id', refUtxo: buildRefUtxo('open-confirm-tx', 8) },
        recv_packet: { scriptHash: 'recv-packet-policy-id', refUtxo: buildRefUtxo('recv-packet-tx', 9) },
        send_packet: { scriptHash: 'send-packet-policy-id', refUtxo: buildRefUtxo('send-packet-tx', 10) },
        timeout_packet: { scriptHash: 'timeout-packet-policy-id', refUtxo: buildRefUtxo('timeout-packet-tx', 11) },
      },
    },
    spendTransferModule: buildValidator('spend-transfer-module', 12),
    spendMockModule: buildValidator('spend-mock-module', 13),
    mintIdentifier: buildValidator('mint-identifier', 14),
    mintChannelStt: buildValidator('mint-channel', 15),
    mintClientStt: buildValidator('mint-client', 16),
    mintConnectionStt: buildValidator('mint-connection', 17),
    mintVoucher: buildValidator('mint-voucher', 18),
    verifyProof: {
      ...buildValidator('verify-proof', 19),
      scriptHash: 'verify-proof-policy-id',
    },
    hostStateStt: buildValidator('host-state', 20),
  },
  modules: {
    mock: {
      address: 'addr_test1_mock',
    },
  },
};

const createChainedTxBuilder = (): ChainableTxBuilder => {
  const txBuilder = {} as ChainableTxBuilder;
  txBuilder.readFrom = jest.fn().mockReturnValue(txBuilder);
  txBuilder.collectFrom = jest.fn().mockReturnValue(txBuilder);
  txBuilder.mintAssets = jest.fn().mockReturnValue(txBuilder);
  txBuilder.pay = {
    ToContract: jest.fn().mockReturnValue(txBuilder),
    ToAddress: jest.fn().mockReturnValue(txBuilder),
  };
  return txBuilder;
};

const createService = (txBuilder: ChainableTxBuilder): any => {
  const service: any = Object.create(LucidService.prototype);

  service.configService = {
    get: jest.fn().mockReturnValue(deploymentConfig),
  };
  service.lucid = {
    newTx: jest.fn().mockReturnValue(txBuilder),
  };
  service.referenceScripts = {
    spendChannel: buildRefUtxo('ref-spend-channel', 0),
    spendMockModule: buildRefUtxo('ref-spend-mock-module', 1),
    channelOpenConfirm: buildRefUtxo('ref-channel-open-confirm', 2),
    verifyProof: buildRefUtxo('ref-verify-proof', 3),
    hostStateStt: buildRefUtxo('ref-host-state', 4),
  };
  service.LucidImporter = {
    Data: {
      Bytes: jest.fn().mockReturnValue('bytes-schema'),
      Object: jest.fn((shape: unknown) => shape),
      to: jest.fn().mockReturnValue('encoded-auth-token'),
    },
  };

  return service;
};

describe('LucidService channel open confirm wiring', () => {
  it('loads both confirm reference script out-refs from deployment config', () => {
    const configService = {
      get: jest.fn().mockReturnValue(deploymentConfig),
    };

    const service = new LucidService({} as any, {} as any, configService as any);
    const referenceScriptOutRefs = (service as any).referenceScriptOutRefs;

    expect(referenceScriptOutRefs.channelOpenConfirm).toEqual(
      deploymentConfig.validators.spendChannel.refValidator.chan_open_confirm.refUtxo,
    );
    expect(referenceScriptOutRefs.channelCloseConfirm).toEqual(
      deploymentConfig.validators.spendChannel.refValidator.chan_close_confirm.refUtxo,
    );
  });

  it('uses the confirm and verify-proof refs when building ChannelOpenConfirm transactions', () => {
    const txBuilder = createChainedTxBuilder();
    const service = createService(txBuilder);

    service.createUnsignedChannelOpenConfirmTransaction({
      hostStateUtxo: { txHash: 'host-state-utxo', outputIndex: 0, assets: {}, datum: 'host-datum' } as any,
      encodedHostStateRedeemer: 'encoded-host-redeemer',
      encodedUpdatedHostStateDatum: 'encoded-host-datum',
      channelUtxo: { txHash: 'channel-utxo', outputIndex: 0, assets: {} } as any,
      connectionUtxo: { txHash: 'connection-utxo', outputIndex: 0, assets: {} } as any,
      clientUtxo: { txHash: 'client-utxo', outputIndex: 0, assets: {} } as any,
      moduleKey: 'mock',
      moduleUtxo: { txHash: 'mock-utxo', outputIndex: 0, assets: { lovelace: 2_000_000n } } as any,
      encodedSpendChannelRedeemer: 'encoded-channel-redeemer',
      encodedSpendModuleRedeemer: 'encoded-mock-redeemer',
      channelTokenUnit: 'channel-token-unit',
      encodedUpdatedChannelDatum: 'encoded-channel-datum',
      encodedNewMockModuleDatum: 'encoded-mock-datum',
      constructedAddress: 'addr_test1operator',
      chanOpenConfirmPolicyId: 'chan-open-confirm-policy-id',
      channelToken: { policyId: 'channel-policy-id', name: 'channel-token-name' },
      verifyProofPolicyId: 'verify-proof-policy-id',
      encodedVerifyProofRedeemer: 'encoded-verify-proof-redeemer',
    });

    expect(txBuilder.readFrom).toHaveBeenCalledWith([
      service.referenceScripts.spendChannel,
      service.referenceScripts.spendMockModule,
      service.referenceScripts.channelOpenConfirm,
      service.referenceScripts.verifyProof,
      service.referenceScripts.hostStateStt,
    ]);
    expect(txBuilder.mintAssets).toHaveBeenNthCalledWith(
      1,
      {
        'chan-open-confirm-policy-id': 1n,
      },
      'encoded-auth-token',
    );
    expect(txBuilder.mintAssets).toHaveBeenNthCalledWith(
      2,
      {
        'verify-proof-policy-id': 1n,
      },
      'encoded-verify-proof-redeemer',
    );
  });

  it('uses the close-confirm and verify-proof refs when building ChannelCloseConfirm transactions', () => {
    const txBuilder = createChainedTxBuilder();
    const service = createService(txBuilder);

    service.referenceScripts.channelCloseConfirm = buildRefUtxo('ref-channel-close-confirm', 5);

    service.createUnsignedChannelCloseConfirmTransaction({
      hostStateUtxo: { txHash: 'host-state-utxo', outputIndex: 0, assets: {}, datum: 'host-datum' } as any,
      encodedHostStateRedeemer: 'encoded-host-redeemer',
      encodedUpdatedHostStateDatum: 'encoded-host-datum',
      channelUtxo: { txHash: 'channel-utxo', outputIndex: 0, assets: {} } as any,
      connectionUtxo: { txHash: 'connection-utxo', outputIndex: 0, assets: {} } as any,
      clientUtxo: { txHash: 'client-utxo', outputIndex: 0, assets: {} } as any,
      moduleKey: 'mock',
      moduleUtxo: { txHash: 'mock-utxo', outputIndex: 0, assets: { lovelace: 2_000_000n } } as any,
      encodedSpendChannelRedeemer: 'encoded-channel-redeemer',
      encodedSpendModuleRedeemer: 'encoded-mock-redeemer',
      channelTokenUnit: 'channel-token-unit',
      channelToken: { policyId: 'channel-policy-id', name: 'channel-token-name' },
      encodedUpdatedChannelDatum: 'encoded-channel-datum',
      encodedNewMockModuleDatum: 'encoded-mock-datum',
      constructedAddress: 'addr_test1operator',
      channelCloseConfirmPolicyId: 'chan-close-confirm-policy-id',
      verifyProofPolicyId: 'verify-proof-policy-id',
      encodedVerifyProofRedeemer: 'encoded-verify-proof-redeemer',
    });

    expect(txBuilder.readFrom).toHaveBeenCalledWith([
      service.referenceScripts.spendChannel,
      service.referenceScripts.spendMockModule,
      service.referenceScripts.channelCloseConfirm,
      service.referenceScripts.verifyProof,
      service.referenceScripts.hostStateStt,
    ]);
    expect(txBuilder.mintAssets).toHaveBeenNthCalledWith(
      1,
      {
        'chan-close-confirm-policy-id': 1n,
      },
      'encoded-auth-token',
    );
    expect(txBuilder.mintAssets).toHaveBeenNthCalledWith(
      2,
      {
        'verify-proof-policy-id': 1n,
      },
      'encoded-verify-proof-redeemer',
    );
  });
});
