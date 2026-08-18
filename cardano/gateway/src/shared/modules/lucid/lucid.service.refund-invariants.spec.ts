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
    mintPort: {
      address: 'addr_test1mintport',
    },
    mintTransferEscrowShard: {
      address: 'addr_test1transferescrowshard',
    },
  },
  modules: {
    transfer: {
      address: 'addr_test1transfer',
    },
  },
};

const transferModuleReferenceUtxo = {
  txHash: 'transfer-root-utxo',
  outputIndex: 0,
  assets: {
    lovelace: 5_000_000n,
    'module-policy.module-token': 1n,
    'port-policy.port-token': 1n,
  },
  datum: 'transfer-root-datum',
} as any;

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
    mintPort: { txHash: 'ref-mint-port', outputIndex: 7 },
    mintTransferEscrowShard: {
      txHash: 'ref-mint-transfer-escrow-shard',
      outputIndex: 8,
    },
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
  it('spends and recreates the registered transfer-module root for recv voucher minting', () => {
    const txBuilder = createChainedTxBuilder();
    const service = createService(txBuilder);
    const transferModuleUtxo = {
      txHash: 'transfer-root-utxo',
      outputIndex: 0,
      assets: {
        lovelace: 5_000_000n,
        'module-policy.module-token': 1n,
        'port-policy.port-token': 1n,
      },
    } as any;

    service.createUnsignedRecvPacketMintTx({
      hostStateUtxo: { txHash: 'host-state-utxo', outputIndex: 0, assets: {}, datum: 'host-datum' } as any,
      channelUtxo: { txHash: 'channel-utxo', outputIndex: 0, assets: {} } as any,
      connectionUtxo: { txHash: 'connection-utxo', outputIndex: 0, assets: {} } as any,
      clientUtxo: { txHash: 'client-utxo', outputIndex: 0, assets: {} } as any,
      transferModuleUtxo,
      encodedHostStateRedeemer: 'encoded-host-redeemer',
      encodedUpdatedHostStateDatum: 'encoded-host-datum',
      encodedSpendChannelRedeemer: 'encoded-channel-redeemer',
      encodedSpendTransferModuleRedeemer: 'encoded-transfer-redeemer',
      encodedMintVoucherRedeemer: 'encoded-mint-voucher-redeemer',
      encodedUpdatedChannelDatum: 'encoded-channel-datum',
      channelTokenUnit: 'channel-token-unit',
      voucherTokenUnit: 'voucher-token-unit',
      transferAmount: 12n,
      receiverAddress: 'addr_test1receiver',
      constructedAddress: 'addr_test1operator',
      recvPacketPolicyId: 'recv-packet-policy-id',
      channelToken: { policyId: 'channel-policy-id', name: 'channel-token-name' },
      verifyProofPolicyId: 'verify-proof-policy-id',
      encodedVerifyProofRedeemer: 'encoded-verify-proof-redeemer',
    });

    expect(txBuilder.collectFrom).toHaveBeenCalledWith([transferModuleUtxo], 'encoded-transfer-redeemer');
    expect(txBuilder.pay.ToContract).toHaveBeenCalledWith(
      deploymentConfig.modules.transfer.address,
      undefined,
      transferModuleUtxo.assets,
    );
    expect(txBuilder.readFrom.mock.calls[0][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ txHash: 'ref-spend-transfer' })]),
    );
  });

  it('anchors recv unescrow shard callbacks to the registered module root reference', () => {
    const txBuilder = createChainedTxBuilder();
    const service = createService(txBuilder);
    const denomToken = 'policy-id.native-token';
    const transferEscrowShardTokenUnit = 'shard-policy.shard-token';
    const transferModuleReferenceUtxo = {
      txHash: 'transfer-root-utxo',
      outputIndex: 0,
      assets: { 'port-policy.port-token': 1n },
    } as any;
    const transferEscrowUtxo = {
      txHash: 'transfer-escrow-utxo',
      outputIndex: 1,
      assets: {
        lovelace: 2_000_000n,
        [denomToken]: 42n,
        [transferEscrowShardTokenUnit]: 1n,
      },
      datum: 'encoded-transfer-escrow-datum',
    } as any;

    service.createUnsignedRecvPacketUnescrowTx({
      hostStateUtxo: { txHash: 'host-state-utxo', outputIndex: 0, assets: {}, datum: 'host-datum' } as any,
      channelUtxo: { txHash: 'channel-utxo', outputIndex: 0, assets: {} } as any,
      connectionUtxo: { txHash: 'connection-utxo', outputIndex: 0, assets: {} } as any,
      clientUtxo: { txHash: 'client-utxo', outputIndex: 0, assets: {} } as any,
      transferModuleReferenceUtxo,
      transferEscrowUtxo,
      encodedTransferEscrowDatum: 'encoded-transfer-escrow-datum',
      transferEscrowShardTokenUnit,
      encodedHostStateRedeemer: 'encoded-host-redeemer',
      encodedUpdatedHostStateDatum: 'encoded-host-datum',
      encodedSpendChannelRedeemer: 'encoded-channel-redeemer',
      encodedSpendTransferModuleRedeemer: 'encoded-transfer-redeemer',
      encodedUpdatedChannelDatum: 'encoded-channel-datum',
      channelTokenUnit: 'channel-token-unit',
      transferAmount: 10n,
      receiverAddress: 'addr_test1receiver',
      constructedAddress: 'addr_test1operator',
      recvPacketPolicyId: 'recv-packet-policy-id',
      channelToken: { policyId: 'channel-policy-id', name: 'channel-token-name' },
      verifyProofPolicyId: 'verify-proof-policy-id',
      encodedVerifyProofRedeemer: 'encoded-verify-proof-redeemer',
      denomToken,
    });

    expect(txBuilder.collectFrom).toHaveBeenCalledWith([transferEscrowUtxo], 'encoded-transfer-redeemer');
    expect(txBuilder.readFrom).toHaveBeenCalledWith([
      expect.objectContaining({ txHash: 'connection-utxo' }),
      expect.objectContaining({ txHash: 'client-utxo' }),
      transferModuleReferenceUtxo,
    ]);
  });

  it('spends and preserves the transfer-module root for successful acknowledgements', () => {
    const txBuilder = createChainedTxBuilder();
    const service = createService(txBuilder);

    service.createUnsignedAckPacketSucceedTx({
      hostStateUtxo: { txHash: 'host-state-utxo', outputIndex: 0, assets: {}, datum: 'host-datum' } as any,
      channelUtxo: { txHash: 'channel-utxo', outputIndex: 0, assets: {} } as any,
      connectionUtxo: { txHash: 'connection-utxo', outputIndex: 0, assets: {} } as any,
      clientUtxo: { txHash: 'client-utxo', outputIndex: 0, assets: {} } as any,
      transferModuleReferenceUtxo,
      encodedHostStateRedeemer: 'encoded-host-redeemer',
      encodedUpdatedHostStateDatum: 'encoded-host-datum',
      encodedSpendChannelRedeemer: 'encoded-channel-redeemer',
      encodedSpendTransferModuleRedeemer: 'encoded-transfer-redeemer',
      encodedUpdatedChannelDatum: 'encoded-channel-datum',
      channelTokenUnit: 'channel-token-unit',
      constructedAddress: 'addr_test1operator',
      ackPacketPolicyId: 'ack-policy-id',
      channelToken: { policyId: 'channel-policy-id', name: 'channel-token-name' },
      verifyProofPolicyId: 'verify-proof-policy-id',
      encodedVerifyProofRedeemer: 'encoded-verify-proof-redeemer',
    });

    expect(txBuilder.collectFrom).toHaveBeenCalledWith(
      [transferModuleReferenceUtxo],
      'encoded-transfer-redeemer',
    );
    expect(txBuilder.pay.ToContract).toHaveBeenCalledWith(
      deploymentConfig.modules.transfer.address,
      { kind: 'inline', value: transferModuleReferenceUtxo.datum },
      transferModuleReferenceUtxo.assets,
    );
  });

  it('spends and preserves the transfer-module root in acknowledgement refund mint tx', () => {
    const txBuilder = createChainedTxBuilder();
    const service = createService(txBuilder);

    service.createUnsignedAckPacketMintTx({
      hostStateUtxo: { txHash: 'host-state-utxo', outputIndex: 0, assets: {}, datum: 'host-datum' } as any,
      channelUtxo: { txHash: 'channel-utxo', outputIndex: 0, assets: {} } as any,
      connectionUtxo: { txHash: 'connection-utxo', outputIndex: 0, assets: {} } as any,
      clientUtxo: { txHash: 'client-utxo', outputIndex: 0, assets: {} } as any,
      transferModuleReferenceUtxo,
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

    const transferSpendCall = txBuilder.collectFrom.mock.calls.find((call: unknown[]) => {
      return call[1] === 'encoded-transfer-redeemer';
    });
    const transferOutputCall = txBuilder.pay.ToContract.mock.calls.find((call: unknown[]) => {
      return call[0] === deploymentConfig.modules.transfer.address;
    });

    expect(transferSpendCall?.[0]).toEqual([transferModuleReferenceUtxo]);
    expect(transferOutputCall).toEqual([
      deploymentConfig.modules.transfer.address,
      { kind: 'inline', value: transferModuleReferenceUtxo.datum },
      transferModuleReferenceUtxo.assets,
    ]);
  });

  it('spends and preserves the transfer-module root in timeout refund mint tx', () => {
    const txBuilder = createChainedTxBuilder();
    const service = createService(txBuilder);

    service.createUnsignedTimeoutPacketMintTx({
      hostStateUtxo: { txHash: 'host-state-utxo', outputIndex: 0, assets: {}, datum: 'host-datum' } as any,
      channelUtxo: { txHash: 'channel-utxo', outputIndex: 0, assets: {} } as any,
      connectionUtxo: { txHash: 'connection-utxo', outputIndex: 0, assets: {} } as any,
      clientUtxo: { txHash: 'client-utxo', outputIndex: 0, assets: {} } as any,
      transferModuleReferenceUtxo,
      encodedHostStateRedeemer: 'encoded-host-redeemer',
      encodedUpdatedHostStateDatum: 'encoded-host-datum',
      encodedSpendChannelRedeemer: 'encoded-channel-redeemer',
      encodedSpendTransferModuleRedeemer: 'encoded-transfer-redeemer',
      encodedMintVoucherRedeemer: 'encoded-mint-voucher-redeemer',
      encodedUpdatedChannelDatum: 'encoded-channel-datum',
      transferAmount: 3_000_000n,
      senderAddress: 'addr_test1sender',
      spendChannelAddress: 'addr_test1channel_timeout_refund',
      channelTokenUnit: 'channel-token-unit',
      voucherTokenUnit: 'voucher-token-unit',
      constructedAddress: 'addr_test1operator',
      timeoutPacketPolicyId: 'timeout-policy-id',
      channelToken: { policyId: 'channel-policy-id', name: 'channel-token-name' },
      verifyProofPolicyId: 'verify-proof-policy-id',
      encodedVerifyProofRedeemer: 'encoded-verify-proof-redeemer',
    });

    const transferSpendCall = txBuilder.collectFrom.mock.calls.find((call: unknown[]) => {
      return call[1] === 'encoded-transfer-redeemer';
    });
    const transferOutputCall = txBuilder.pay.ToContract.mock.calls.find((call: unknown[]) => {
      return call[0] === deploymentConfig.modules.transfer.address;
    });

    expect(transferSpendCall?.[0]).toEqual([transferModuleReferenceUtxo]);
    expect(transferOutputCall).toEqual([
      deploymentConfig.modules.transfer.address,
      { kind: 'inline', value: transferModuleReferenceUtxo.datum },
      transferModuleReferenceUtxo.assets,
    ]);
  });

  it('creates a transfer escrow shard by referencing the module root and minting the shard NFT', () => {
    const txBuilder = createChainedTxBuilder();
    const service = createService(txBuilder);
    const denomToken = 'policy-id.native-token';
    const transferEscrowShardTokenUnit = 'mint-port-policy.shard-token';
    const encodedTransferEscrowDatum = 'encoded-transfer-escrow-datum';
    const transferModuleAddress = 'addr_test1transfer_send_escrow';
    const transferModuleReferenceUtxo = {
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
      transferModuleReferenceUtxo,
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
      receiverAddress: 'addr_test1receiver',
      transferEscrowShardTokenUnit,
      encodedMintTransferEscrowShardRedeemer: 'encoded-shard-create-redeemer',
      walletUtxos: [{ txHash: 'wallet-utxo', outputIndex: 0, assets: { [denomToken]: 12n } }] as any,
    });

    const transferSpendCall = txBuilder.collectFrom.mock.calls.find((call: unknown[]) => {
      return call[1] === 'encoded-transfer-redeemer';
    });
    expect(transferSpendCall).toBeUndefined();
    expect(txBuilder.readFrom).toHaveBeenCalledWith([transferModuleReferenceUtxo]);
    expect(txBuilder.mintAssets).toHaveBeenCalledWith(
      { [transferEscrowShardTokenUnit]: 1n },
      'encoded-shard-create-redeemer',
    );

    const transferOutputs = txBuilder.pay.ToContract.mock.calls.filter((call: unknown[]) => {
      return call[0] === transferModuleAddress;
    });
    expect(transferOutputs).toEqual([
      [
        transferModuleAddress,
        { kind: 'inline', value: encodedTransferEscrowDatum },
        {
          [denomToken]: 12n,
          [transferEscrowShardTokenUnit]: 1n,
        },
      ],
    ]);
  });

  it('spends and updates the transfer escrow shard in acknowledgement native-token refunds', () => {
    const txBuilder = createChainedTxBuilder();
    const service = createService(txBuilder);
    const denomToken = 'policy-id.native-token';
    const transferEscrowShardTokenUnit = 'mint-port-policy.shard-token';
    const encodedTransferEscrowDatum = 'encoded-transfer-escrow-datum';
    const transferEscrowUtxo = {
      txHash: 'transfer-escrow-utxo',
      outputIndex: 1,
      assets: {
        lovelace: 2_000_000n,
        [denomToken]: 42n,
        [transferEscrowShardTokenUnit]: 1n,
      },
      datum: encodedTransferEscrowDatum,
    } as any;

    service.createUnsignedAckPacketUnescrowTx({
      hostStateUtxo: { txHash: 'host-state-utxo', outputIndex: 0, assets: {}, datum: 'host-datum' } as any,
      channelUtxo: { txHash: 'channel-utxo', outputIndex: 0, assets: {} } as any,
      connectionUtxo: { txHash: 'connection-utxo', outputIndex: 0, assets: {} } as any,
      clientUtxo: { txHash: 'client-utxo', outputIndex: 0, assets: {} } as any,
      transferEscrowUtxo,
      transferModuleReferenceUtxo,
      encodedTransferEscrowDatum,
      transferEscrowShardTokenUnit,
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
    expect(transferSpendCall?.[0]).toEqual([transferEscrowUtxo]);
    expect(txBuilder.readFrom).toHaveBeenCalledWith(
      expect.arrayContaining([transferModuleReferenceUtxo]),
    );

    const transferOutputs = txBuilder.pay.ToContract.mock.calls.filter((call: unknown[]) => {
      return call[0] === deploymentConfig.modules.transfer.address;
    });
    expect(transferOutputs).toEqual([
      [
        deploymentConfig.modules.transfer.address,
        { kind: 'inline', value: encodedTransferEscrowDatum },
        {
          lovelace: 2_000_000n,
          [denomToken]: 32n,
          [transferEscrowShardTokenUnit]: 1n,
        },
      ],
    ]);
  });

  it('omits an empty transfer escrow shard in timeout native-token refunds', () => {
    const txBuilder = createChainedTxBuilder();
    const service = createService(txBuilder);
    const denomToken = 'policy-id.native-token';
    const transferEscrowShardTokenUnit = 'mint-port-policy.shard-token';
    const encodedTransferEscrowDatum = 'encoded-transfer-escrow-datum';
    const transferModuleAddress = 'addr_test1transfer_timeout_unescrow';
    const transferEscrowUtxo = {
      txHash: 'transfer-escrow-utxo',
      outputIndex: 1,
      assets: {
        lovelace: 2_000_000n,
        [denomToken]: 42n,
        [transferEscrowShardTokenUnit]: 1n,
      },
      datum: encodedTransferEscrowDatum,
    } as any;

    service.createUnsignedTimeoutPacketUnescrowTx({
      hostStateUtxo: { txHash: 'host-state-utxo', outputIndex: 0, assets: {}, datum: 'host-datum' } as any,
      channelUtxo: { txHash: 'channel-utxo', outputIndex: 0, assets: {} } as any,
      connectionUtxo: { txHash: 'connection-utxo', outputIndex: 0, assets: {} } as any,
      clientUtxo: { txHash: 'client-utxo', outputIndex: 0, assets: {} } as any,
      transferEscrowUtxo,
      transferModuleReferenceUtxo,
      encodedTransferEscrowDatum,
      transferEscrowShardTokenUnit,
      encodedMintTransferEscrowShardRedeemer: 'encoded-shard-burn-redeemer',
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
    expect(transferSpendCall?.[0]).toEqual([transferEscrowUtxo]);
    expect(txBuilder.readFrom).toHaveBeenCalledWith(
      expect.arrayContaining([transferModuleReferenceUtxo]),
    );
    expect(txBuilder.mintAssets).toHaveBeenCalledWith(
      { [transferEscrowShardTokenUnit]: -1n },
      'encoded-shard-burn-redeemer',
    );

    const transferOutputs = txBuilder.pay.ToContract.mock.calls.filter((call: unknown[]) => {
      return call[0] === transferModuleAddress;
    });
    expect(transferOutputs).toEqual([]);
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
