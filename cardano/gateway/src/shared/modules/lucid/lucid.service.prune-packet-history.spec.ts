import { LucidService } from './lucid.service';

function utxo(txHash: string, outputIndex: number) {
  return { txHash, outputIndex, address: 'addr_test1', assets: {} } as any;
}

describe('LucidService prune packet history transaction', () => {
  it('spends only HostState/channel and reads the proof context and prune scripts', () => {
    const tx: any = {};
    tx.readFrom = jest.fn().mockReturnValue(tx);
    tx.collectFrom = jest.fn().mockReturnValue(tx);
    tx.mintAssets = jest.fn().mockReturnValue(tx);
    tx.pay = { ToContract: jest.fn().mockReturnValue(tx) };

    const service: any = Object.create(LucidService.prototype);
    service.lucid = { newTx: jest.fn().mockReturnValue(tx) };
    service.configService = {
      get: jest.fn().mockReturnValue({
        hostStateNFT: { policyId: 'host-policy', name: 'host-name' },
        validators: {
          hostStateStt: { address: 'host-address' },
          spendChannel: { address: 'channel-address' },
        },
      }),
    };
    service.referenceScripts = {
      spendChannel: utxo('spend-channel-ref', 0),
      prunePacketHistory: utxo('prune-ref', 0),
      verifyProof: utxo('verify-ref', 0),
      hostStateStt: utxo('host-ref', 0),
    };
    service.LucidImporter = {
      Data: {
        Bytes: jest.fn().mockReturnValue('bytes'),
        Object: jest.fn((value: unknown) => value),
        to: jest.fn().mockReturnValue('encoded-auth-token'),
      },
    };

    const dto: any = {
      hostStateUtxo: { ...utxo('host', 0), datum: 'host-datum', datumHash: 'hash' },
      channelUtxo: utxo('channel', 0),
      connectionUtxo: utxo('connection', 0),
      clientUtxo: utxo('client', 0),
      encodedHostStateRedeemer: 'host-redeemer',
      encodedUpdatedHostStateDatum: 'updated-host',
      encodedSpendChannelRedeemer: 'channel-redeemer',
      encodedUpdatedChannelDatum: 'updated-channel',
      channelTokenUnit: 'channel-token',
      prunePacketHistoryPolicyId: 'prune-policy',
      channelToken: { policyId: 'channel-policy', name: 'channel-name' },
      verifyProofPolicyId: 'verify-policy',
      encodedVerifyProofRedeemer: 'proof-redeemer',
    };

    expect(service.createUnsignedPrunePacketHistoryTx(dto)).toBe(tx);
    expect(tx.readFrom).toHaveBeenNthCalledWith(1, [
      service.referenceScripts.spendChannel,
      service.referenceScripts.prunePacketHistory,
      service.referenceScripts.verifyProof,
      service.referenceScripts.hostStateStt,
    ]);
    expect(tx.readFrom).toHaveBeenNthCalledWith(2, [dto.connectionUtxo, dto.clientUtxo]);
    expect(tx.collectFrom).toHaveBeenCalledTimes(2);
    expect(tx.mintAssets).toHaveBeenCalledWith(
      { 'prune-policy': 1n },
      'encoded-auth-token',
    );
    expect(tx.mintAssets).toHaveBeenCalledWith(
      { 'verify-policy': 1n },
      'proof-redeemer',
    );
  });
});
