import { LucidService } from './lucid.service';

describe('LucidService transfer escrow shard retirement', () => {
  it('burns the shard NFT and absorbs all shard ADA into the module root', () => {
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
        validators: { hostStateStt: { address: 'host-address' } },
        modules: { transfer: { address: 'module-address' } },
      }),
    };
    service.referenceScripts = {
      hostStateStt: { txHash: 'host-ref', outputIndex: 0 },
      spendTransferModule: { txHash: 'module-ref', outputIndex: 0 },
      mintTransferEscrowShard: { txHash: 'shard-ref', outputIndex: 0 },
    };
    const shardUnit = 'shard-policy-and-name';
    const dto: any = {
      hostStateUtxo: {
        txHash: 'host',
        outputIndex: 0,
        datum: 'host-datum',
        assets: { 'host-policyhost-name': 1n },
      },
      transferModuleUtxo: {
        txHash: 'module',
        outputIndex: 0,
        assets: { lovelace: 5_000_000n, moduleToken: 1n },
      },
      transferEscrowShardUtxo: {
        txHash: 'shard',
        outputIndex: 0,
        assets: { lovelace: 2_000_000n, [shardUnit]: 1n },
      },
      channelUtxo: { txHash: 'channel', outputIndex: 0, assets: {} },
      encodedHostStateRedeemer: 'host-redeemer',
      encodedUpdatedHostStateDatum: 'host-datum',
      encodedSpendTransferModuleRedeemer: 'module-redeemer',
      encodedUpdatedTransferModuleDatum: 'updated-module-datum',
      encodedMintTransferEscrowShardRedeemer: 'retire-redeemer',
      transferEscrowShardTokenUnit: shardUnit,
    };

    expect(service.createUnsignedRetireTransferEscrowShardTx(dto)).toBe(tx);
    expect(tx.collectFrom).toHaveBeenCalledWith(
      [dto.transferModuleUtxo, dto.transferEscrowShardUtxo],
      'module-redeemer',
    );
    expect(tx.readFrom).toHaveBeenLastCalledWith([dto.channelUtxo]);
    expect(tx.pay.ToContract).toHaveBeenCalledWith(
      'module-address',
      { kind: 'inline', value: 'updated-module-datum' },
      { lovelace: 7_000_000n, moduleToken: 1n },
    );
    expect(tx.mintAssets).toHaveBeenCalledWith(
      { [shardUnit]: -1n },
      'retire-redeemer',
    );
  });
});
