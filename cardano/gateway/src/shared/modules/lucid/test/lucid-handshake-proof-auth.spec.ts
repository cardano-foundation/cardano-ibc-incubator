import { LucidService } from '../lucid.service';

type FluentBuilder = {
  readFrom: jest.Mock;
  collectFrom: jest.Mock;
  mintAssets: jest.Mock;
  pay: { ToContract: jest.Mock };
};

function utxo(label: string, assets: Record<string, bigint> = {}) {
  return {
    txHash: label.padEnd(64, '0'),
    outputIndex: 0,
    address: `addr_${label}`,
    assets,
    datum: 'd87980',
  } as any;
}

function harness() {
  const builder = {} as FluentBuilder;
  builder.readFrom = jest.fn(() => builder);
  builder.collectFrom = jest.fn(() => builder);
  builder.mintAssets = jest.fn(() => builder);
  builder.pay = { ToContract: jest.fn(() => builder) };

  const references = {
    hostStateStt: utxo('host'),
    mintConnection: utxo('mint-connection'),
    spendConnection: utxo('spend-connection'),
    spendChannel: utxo('spend-channel'),
    mintChannel: utxo('mint-channel'),
    spendTransferModule: utxo('spend-transfer-module'),
    verifyProof: utxo('verify-proof'),
    receivePacket: utxo('receive-packet'),
  };
  const service = Object.create(LucidService.prototype) as LucidService;
  Object.assign(service as any, {
    LucidImporter: {
      Data: {
        Object: jest.fn(() => ({})),
        Bytes: jest.fn(() => ({})),
        to: jest.fn(() => 'encoded-auth-token'),
      },
    },
    configService: {
      get: jest.fn(() => ({
        hostStateNFT: { policyId: 'host-policy', name: 'host-name' },
        validators: {
          hostStateStt: { address: 'host-address' },
          spendConnection: { address: 'connection-address' },
          spendChannel: { address: 'channel-address' },
        },
        modules: { transfer: { address: 'transfer-address' } },
      })),
    },
    referenceScripts: references,
    newTxBuilder: jest.fn(() => builder),
  });

  return { service, builder, references };
}

describe('Lucid handshake proof authorization', () => {
  it('adds the pinned verify-proof reference and mint to ConnectionOpenTry', () => {
    const { service, builder, references } = harness();

    service.createUnsignedConnectionOpenTryTransaction(
      utxo('host-input'),
      'host-redeemer',
      'connection-token',
      utxo('client-input'),
      'connection-redeemer',
      'verify-policy',
      'verify-redeemer',
      'host-datum',
      'connection-datum',
      'signer',
    );

    expect(builder.readFrom).toHaveBeenNthCalledWith(1, [
      references.mintConnection,
      references.verifyProof,
      references.hostStateStt,
    ]);
    expect(builder.mintAssets).toHaveBeenNthCalledWith(
      1,
      { 'connection-token': 1n },
      'connection-redeemer',
    );
    expect(builder.mintAssets).toHaveBeenNthCalledWith(
      2,
      { 'verify-policy': 1n },
      'verify-redeemer',
    );
  });

  it('adds the pinned verify-proof reference and mint to ConnectionOpenConfirm', () => {
    const { service, builder, references } = harness();

    service.createUnsignedConnectionOpenConfirmTransaction(
      utxo('host-input'),
      'host-redeemer',
      'host-datum',
      utxo('connection-input'),
      'connection-redeemer',
      'connection-token',
      utxo('client-input'),
      'connection-datum',
      'verify-policy',
      'verify-redeemer',
      'signer',
    );

    expect(builder.readFrom).toHaveBeenNthCalledWith(1, [
      references.spendConnection,
      references.verifyProof,
      references.hostStateStt,
    ]);
    expect(builder.mintAssets).toHaveBeenCalledTimes(1);
    expect(builder.mintAssets).toHaveBeenCalledWith(
      { 'verify-policy': 1n },
      'verify-redeemer',
    );
  });

  it('adds the pinned verify-proof reference and mint to ChannelOpenTry', () => {
    const { service, builder, references } = harness();

    service.createUnsignedChannelOpenTryTransaction({
      moduleKey: 'transfer',
      connectionUtxo: utxo('connection-input'),
      clientUtxo: utxo('client-input'),
      moduleUtxo: utxo('module-input', { 'module-token': 1n }),
      encodedSpendModuleRedeemer: 'module-redeemer',
      encodedMintChannelRedeemer: 'channel-redeemer',
      verifyProofPolicyId: 'verify-policy',
      encodedVerifyProofRedeemer: 'verify-redeemer',
      channelTokenUnit: 'channel-token',
      encodedUpdatedHostStateDatum: 'host-datum',
      encodedHostStateRedeemer: 'host-redeemer',
      encodedChannelDatum: 'channel-datum',
      hostStateUtxo: utxo('host-input'),
    });

    expect(builder.readFrom).toHaveBeenNthCalledWith(1, [
      references.mintChannel,
      references.spendTransferModule,
      references.verifyProof,
      references.hostStateStt,
    ]);
    expect(builder.mintAssets).toHaveBeenNthCalledWith(
      1,
      { 'channel-token': 1n },
      'channel-redeemer',
    );
    expect(builder.mintAssets).toHaveBeenNthCalledWith(
      2,
      { 'verify-policy': 1n },
      'verify-redeemer',
    );
  });

  it('requires a module callback in the generic RecvPacket builder', () => {
    const { service, builder, references } = harness();
    const moduleUtxo = utxo('module-input', { 'module-token': 1n });

    service.createUnsignedRecvPacketTx({
      moduleKey: 'transfer',
      moduleUtxo,
      encodedSpendModuleRedeemer: 'module-redeemer',
      hostStateUtxo: utxo('host-input'),
      encodedHostStateRedeemer: 'host-redeemer',
      encodedUpdatedHostStateDatum: 'host-datum',
      channelUtxo: utxo('channel-input'),
      connectionUtxo: utxo('connection-input'),
      clientUtxo: utxo('client-input'),
      encodedSpendChannelRedeemer: 'channel-redeemer',
      encodedUpdatedChannelDatum: 'channel-datum',
      channelTokenUnit: 'channel-token',
      constructedAddress: 'signer',
      recvPacketPolicyId: 'recv-policy',
      channelToken: { policyId: 'channel-policy', name: 'channel-name' },
      verifyProofPolicyId: 'verify-policy',
      encodedVerifyProofRedeemer: 'verify-redeemer',
    });

    expect(builder.readFrom).toHaveBeenNthCalledWith(1, [
      references.spendChannel,
      references.spendTransferModule,
      references.receivePacket,
      references.verifyProof,
      references.hostStateStt,
    ]);
    expect(builder.collectFrom).toHaveBeenCalledWith([moduleUtxo], 'module-redeemer');
    expect(builder.pay.ToContract).toHaveBeenCalledWith(
      'transfer-address',
      { kind: 'inline', value: 'd87980' },
      { 'module-token': 1n },
    );
  });
});
