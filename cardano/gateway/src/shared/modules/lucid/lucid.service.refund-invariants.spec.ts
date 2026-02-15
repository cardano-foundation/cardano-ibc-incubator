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

const deploymentConfig = {
  hostStateNFT: {
    policyId: 'host-state-policy-id',
    name: 'host-state-name',
  },
  validators: {
    hostStateStt: {
      address: 'addr_test1hoststate',
    },
    spendChannel: {
      address: 'addr_test1channel',
    },
  },
  modules: {
    transfer: {
      address: 'addr_test1transfer',
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
  service.txFromWallet = jest.fn().mockReturnValue(txBuilder);
  service.referenceScripts = {
    spendChannel: { txHash: 'ref-spend-channel', outputIndex: 0 },
    spendTransferModule: { txHash: 'ref-spend-transfer', outputIndex: 1 },
    mintVoucher: { txHash: 'ref-mint-voucher', outputIndex: 2 },
    ackPacket: { txHash: 'ref-ack-packet', outputIndex: 3 },
    timeoutPacket: { txHash: 'ref-timeout-packet', outputIndex: 4 },
    verifyProof: { txHash: 'ref-verify-proof', outputIndex: 5 },
    hostStateStt: { txHash: 'ref-host-state', outputIndex: 6 },
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

describe('LucidService voucher refund invariants', () => {
  it('keeps transfer-module output unchanged in acknowledgement refund mint tx', () => {
    const txBuilder = createChainedTxBuilder();
    const service = createService(txBuilder);
    const transferModuleAssets = {
      lovelace: 8_000_000n,
      'aa11bb22cc33dd44ee55ff66778899aabbccddeeff00112233445566778899aaasset': 42n,
    };

    service.createUnsignedAckPacketMintTx({
      hostStateUtxo: { txHash: 'host-state-utxo', outputIndex: 0, assets: {}, datum: 'host-datum' } as any,
      channelUtxo: { txHash: 'channel-utxo', outputIndex: 0, assets: {} } as any,
      connectionUtxo: { txHash: 'connection-utxo', outputIndex: 0, assets: {} } as any,
      clientUtxo: { txHash: 'client-utxo', outputIndex: 0, assets: {} } as any,
      transferModuleUtxo: { txHash: 'transfer-utxo', outputIndex: 0, assets: transferModuleAssets } as any,
      encodedHostStateRedeemer: 'encoded-host-redeemer',
      encodedUpdatedHostStateDatum: 'encoded-host-datum',
      encodedSpendChannelRedeemer: 'encoded-channel-redeemer',
      encodedSpendTransferModuleRedeemer: 'encoded-transfer-redeemer',
      encodedMintVoucherRedeemer: 'encoded-mint-voucher-redeemer',
      encodedUpdatedChannelDatum: 'encoded-channel-datum',
      channelTokenUnit: 'channel-token-unit',
      voucherTokenUnit: 'voucher-token-unit',
      transferAmount: 1_234_567n,
      senderAddress: 'addr_test1sender',
      constructedAddress: 'addr_test1operator',
      ackPacketPolicyId: 'ack-policy-id',
      channelToken: { policyId: 'channel-policy-id', name: 'channel-token-name' },
      verifyProofPolicyId: 'verify-proof-policy-id',
      encodedVerifyProofRedeemer: 'encoded-verify-proof-redeemer',
    });

    const transferOutputCall = txBuilder.pay.ToContract.mock.calls.find((call: unknown[]) => {
      return call[0] === deploymentConfig.modules.transfer.address;
    });

    expect(transferOutputCall).toBeDefined();
    expect(transferOutputCall?.[2]).toEqual(transferModuleAssets);
    expect(transferOutputCall?.[2]?.lovelace).toBe(transferModuleAssets.lovelace);
  });

  it('keeps transfer-module output unchanged in timeout refund mint tx', () => {
    const txBuilder = createChainedTxBuilder();
    const service = createService(txBuilder);
    const transferModuleAssets = {
      lovelace: 9_500_000n,
      'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100asset': 9n,
    };
    const transferModuleAddress = 'addr_test1transfer_timeout_refund';
    const transferAmount = 3_000_000n;

    service.createUnsignedTimeoutPacketMintTx({
      hostStateUtxo: { txHash: 'host-state-utxo', outputIndex: 0, assets: {}, datum: 'host-datum' } as any,
      channelUtxo: { txHash: 'channel-utxo', outputIndex: 0, assets: {} } as any,
      transferModuleUtxo: { txHash: 'transfer-utxo', outputIndex: 0, assets: transferModuleAssets } as any,
      connectionUtxo: { txHash: 'connection-utxo', outputIndex: 0, assets: {} } as any,
      clientUtxo: { txHash: 'client-utxo', outputIndex: 0, assets: {} } as any,
      encodedHostStateRedeemer: 'encoded-host-redeemer',
      encodedUpdatedHostStateDatum: 'encoded-host-datum',
      encodedSpendChannelRedeemer: 'encoded-channel-redeemer',
      encodedSpendTransferModuleRedeemer: 'encoded-transfer-redeemer',
      encodedMintVoucherRedeemer: 'encoded-mint-voucher-redeemer',
      encodedUpdatedChannelDatum: 'encoded-channel-datum',
      transferAmount,
      senderAddress: 'addr_test1sender',
      spendChannelAddress: 'addr_test1channel_timeout_refund',
      channelTokenUnit: 'channel-token-unit',
      transferModuleAddress,
      voucherTokenUnit: 'voucher-token-unit',
      constructedAddress: 'addr_test1operator',
      timeoutPacketPolicyId: 'timeout-policy-id',
      channelToken: { policyId: 'channel-policy-id', name: 'channel-token-name' },
      verifyProofPolicyId: 'verify-proof-policy-id',
      encodedVerifyProofRedeemer: 'encoded-verify-proof-redeemer',
    });

    const transferOutputCall = txBuilder.pay.ToContract.mock.calls.find((call: unknown[]) => {
      return call[0] === transferModuleAddress;
    });

    expect(transferOutputCall).toBeDefined();
    expect(transferOutputCall?.[2]).toEqual(transferModuleAssets);
    expect(transferOutputCall?.[2]?.lovelace).toBe(transferModuleAssets.lovelace);
    expect(transferOutputCall?.[2]?.lovelace).not.toBe(transferModuleAssets.lovelace - transferAmount);
  });
});
