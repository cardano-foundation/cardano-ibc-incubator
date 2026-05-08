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
  service.lucid = {
    newTx: jest.fn().mockReturnValue(txBuilder),
  };
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

  it('creates a transfer escrow shard without increasing the module-state UTxO in native sends', () => {
    const txBuilder = createChainedTxBuilder();
    const service = createService(txBuilder);
    const denomToken = 'policy-id.native-token';
    const encodedTransferEscrowDatum = 'encoded-transfer-escrow-datum';
    const transferModuleAddress = 'addr_test1transfer_send_escrow';
    const transferModuleUtxo = {
      txHash: 'transfer-root-utxo',
      outputIndex: 0,
      assets: {
        lovelace: 5_000_000n,
        'module-policy.module-token': 1n,
        'port-policy.port-token': 1n,
      },
    } as any;

    service.createUnsignedSendPacketEscrowTx({
      hostStateUtxo: { txHash: 'host-state-utxo', outputIndex: 0, assets: {}, datum: 'host-datum' } as any,
      channelUTxO: { txHash: 'channel-utxo', outputIndex: 0, assets: {} } as any,
      connectionUTxO: { txHash: 'connection-utxo', outputIndex: 0, assets: {} } as any,
      clientUTxO: { txHash: 'client-utxo', outputIndex: 0, assets: {} } as any,
      transferModuleUTxO: transferModuleUtxo,
      encodedTransferEscrowDatum,
      encodedHostStateRedeemer: 'encoded-host-redeemer',
      encodedUpdatedHostStateDatum: 'encoded-host-datum',
      encodedSpendChannelRedeemer: 'encoded-channel-redeemer',
      encodedSpendTransferModuleRedeemer: 'encoded-transfer-redeemer',
      encodedUpdatedChannelDatum: 'encoded-channel-datum',
      channelTokenUnit: 'channel-token-unit',
      transferAmount: 12n,
      constructedAddress: 'addr_test1operator',
      sendPacketPolicyId: 'send-packet-policy-id',
      channelToken: { policyId: 'channel-policy-id', name: 'channel-token-name' },
      spendChannelAddress: 'addr_test1channel_send_escrow',
      transferModuleAddress,
      denomToken,
      walletUtxos: [{ txHash: 'wallet-utxo', outputIndex: 0, assets: { [denomToken]: 12n } }] as any,
    });

    const transferSpendCall = txBuilder.collectFrom.mock.calls.find((call: unknown[]) => {
      return call[1] === 'encoded-transfer-redeemer';
    });
    expect(transferSpendCall?.[0]).toEqual([transferModuleUtxo]);

    const transferOutputs = txBuilder.pay.ToContract.mock.calls.filter((call: unknown[]) => {
      return call[0] === transferModuleAddress;
    });
    expect(transferOutputs).toEqual(
      expect.arrayContaining([
        [
          transferModuleAddress,
          undefined,
          transferModuleUtxo.assets,
        ],
        [
          transferModuleAddress,
          { kind: 'inline', value: encodedTransferEscrowDatum },
          {
            [denomToken]: 12n,
          },
        ],
      ]),
    );
  });

  it('spends and updates the transfer escrow shard in acknowledgement native-token refunds', () => {
    const txBuilder = createChainedTxBuilder();
    const service = createService(txBuilder);
    const denomToken = 'policy-id.native-token';
    const encodedTransferEscrowDatum = 'encoded-transfer-escrow-datum';
    const transferModuleUtxo = {
      txHash: 'transfer-root-utxo',
      outputIndex: 0,
      assets: {
        lovelace: 5_000_000n,
        'module-policy.module-token': 1n,
        'port-policy.port-token': 1n,
      },
    } as any;
    const transferEscrowUtxo = {
      txHash: 'transfer-escrow-utxo',
      outputIndex: 1,
      assets: {
        lovelace: 2_000_000n,
        [denomToken]: 42n,
      },
      datum: encodedTransferEscrowDatum,
    } as any;

    service.createUnsignedAckPacketUnescrowTx({
      hostStateUtxo: { txHash: 'host-state-utxo', outputIndex: 0, assets: {}, datum: 'host-datum' } as any,
      channelUtxo: { txHash: 'channel-utxo', outputIndex: 0, assets: {} } as any,
      connectionUtxo: { txHash: 'connection-utxo', outputIndex: 0, assets: {} } as any,
      clientUtxo: { txHash: 'client-utxo', outputIndex: 0, assets: {} } as any,
      transferModuleUtxo,
      transferEscrowUtxo,
      encodedTransferEscrowDatum,
      encodedHostStateRedeemer: 'encoded-host-redeemer',
      encodedUpdatedHostStateDatum: 'encoded-host-datum',
      encodedSpendChannelRedeemer: 'encoded-channel-redeemer',
      encodedSpendTransferModuleRedeemer: 'encoded-transfer-redeemer',
      encodedUpdatedChannelDatum: 'encoded-channel-datum',
      channelTokenUnit: 'channel-token-unit',
      transferAmount: 10n,
      senderAddress: 'addr_test1sender',
      constructedAddress: 'addr_test1operator',
      ackPacketPolicyId: 'ack-policy-id',
      channelToken: { policyId: 'channel-policy-id', name: 'channel-token-name' },
      verifyProofPolicyId: 'verify-proof-policy-id',
      encodedVerifyProofRedeemer: 'encoded-verify-proof-redeemer',
      denomToken,
    });

    const transferSpendCall = txBuilder.collectFrom.mock.calls.find((call: unknown[]) => {
      return call[1] === 'encoded-transfer-redeemer';
    });
    expect(transferSpendCall?.[0]).toEqual([transferModuleUtxo, transferEscrowUtxo]);

    const transferOutputs = txBuilder.pay.ToContract.mock.calls.filter((call: unknown[]) => {
      return call[0] === deploymentConfig.modules.transfer.address;
    });
    expect(transferOutputs).toEqual(
      expect.arrayContaining([
        [
          deploymentConfig.modules.transfer.address,
          undefined,
          transferModuleUtxo.assets,
        ],
        [
          deploymentConfig.modules.transfer.address,
          { kind: 'inline', value: encodedTransferEscrowDatum },
          {
            lovelace: 2_000_000n,
            [denomToken]: 32n,
          },
        ],
      ]),
    );
  });

  it('omits an empty transfer escrow shard in timeout native-token refunds', () => {
    const txBuilder = createChainedTxBuilder();
    const service = createService(txBuilder);
    const denomToken = 'policy-id.native-token';
    const encodedTransferEscrowDatum = 'encoded-transfer-escrow-datum';
    const transferModuleAddress = 'addr_test1transfer_timeout_unescrow';
    const transferModuleUtxo = {
      txHash: 'transfer-root-utxo',
      outputIndex: 0,
      assets: {
        lovelace: 5_000_000n,
        'module-policy.module-token': 1n,
        'port-policy.port-token': 1n,
      },
    } as any;
    const transferEscrowUtxo = {
      txHash: 'transfer-escrow-utxo',
      outputIndex: 1,
      assets: {
        lovelace: 2_000_000n,
        [denomToken]: 42n,
      },
      datum: encodedTransferEscrowDatum,
    } as any;

    service.createUnsignedTimeoutPacketUnescrowTx({
      hostStateUtxo: { txHash: 'host-state-utxo', outputIndex: 0, assets: {}, datum: 'host-datum' } as any,
      channelUtxo: { txHash: 'channel-utxo', outputIndex: 0, assets: {} } as any,
      connectionUtxo: { txHash: 'connection-utxo', outputIndex: 0, assets: {} } as any,
      clientUtxo: { txHash: 'client-utxo', outputIndex: 0, assets: {} } as any,
      transferModuleUtxo,
      transferEscrowUtxo,
      encodedTransferEscrowDatum,
      encodedHostStateRedeemer: 'encoded-host-redeemer',
      encodedUpdatedHostStateDatum: 'encoded-host-datum',
      encodedSpendChannelRedeemer: 'encoded-channel-redeemer',
      encodedSpendTransferModuleRedeemer: 'encoded-transfer-redeemer',
      encodedUpdatedChannelDatum: 'encoded-channel-datum',
      channelTokenUnit: 'channel-token-unit',
      transferAmount: 42n,
      senderAddress: 'addr_test1sender',
      constructedAddress: 'addr_test1operator',
      timeoutPacketPolicyId: 'timeout-policy-id',
      channelToken: { policyId: 'channel-policy-id', name: 'channel-token-name' },
      verifyProofPolicyId: 'verify-proof-policy-id',
      encodedVerifyProofRedeemer: 'encoded-verify-proof-redeemer',
      spendChannelAddress: 'addr_test1channel_timeout_unescrow',
      transferModuleAddress,
      denomToken,
    });

    const transferSpendCall = txBuilder.collectFrom.mock.calls.find((call: unknown[]) => {
      return call[1] === 'encoded-transfer-redeemer';
    });
    expect(transferSpendCall?.[0]).toEqual([transferModuleUtxo, transferEscrowUtxo]);

    const transferOutputs = txBuilder.pay.ToContract.mock.calls.filter((call: unknown[]) => {
      return call[0] === transferModuleAddress;
    });
    expect(transferOutputs).toEqual([
      [
        transferModuleAddress,
        undefined,
        transferModuleUtxo.assets,
      ],
    ]);
    expect(transferOutputs).not.toEqual(
      expect.arrayContaining([
        [
          transferModuleAddress,
          { kind: 'inline', value: encodedTransferEscrowDatum },
          expect.anything(),
        ],
      ]),
    );
  });
});
