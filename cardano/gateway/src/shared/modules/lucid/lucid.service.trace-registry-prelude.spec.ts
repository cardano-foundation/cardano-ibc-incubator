import { LucidService } from './lucid.service';

describe('LucidService trace-registry prelude', () => {
  it('registers the trace and publishes the voucher reference NFT', () => {
    const tx = {
      readFrom: jest.fn().mockReturnThis(),
      mintAssets: jest.fn().mockReturnThis(),
      pay: {
        ToContract: jest.fn().mockReturnThis(),
      },
    };
    const service = Object.create(LucidService.prototype) as any;
    service.newTxBuilder = jest.fn(() => tx);
    service.referenceScripts = {
      hostStateStt: { txHash: 'host', outputIndex: 0 },
      mintVoucher: { txHash: 'voucher', outputIndex: 0 },
    };
    service.applyTraceRegistryUpdate = jest.fn();

    const update = {
      kind: 'append',
      traceRegistryDirectoryUtxo: {},
      traceRegistryShardUtxo: {},
      traceRegistryArchivedShardWitnessUtxos: [],
      encodedTraceRegistryRedeemer: 'trace-redeemer',
      encodedUpdatedTraceRegistryDatum: 'trace-datum',
    };
    const voucher = {
      voucherReferenceTokenUnit: 'voucher-reference',
      voucherMetadataAddress: 'addr_test1metadata',
      encodedVoucherMetadataDatum: 'metadata-datum',
      encodedMintVoucherRedeemer: 'voucher-redeemer',
    };

    expect(service.createUnsignedTraceRegistryUpdateTx(update, voucher)).toBe(tx);
    expect(tx.readFrom).toHaveBeenCalledWith([
      service.referenceScripts.hostStateStt,
      service.referenceScripts.mintVoucher,
    ]);
    expect(service.applyTraceRegistryUpdate).toHaveBeenCalledWith(tx, {
      traceRegistryUpdate: update,
    });
    expect(tx.mintAssets).toHaveBeenCalledWith(
      { 'voucher-reference': 1n },
      'voucher-redeemer',
    );
    expect(tx.pay.ToContract).toHaveBeenCalledWith(
      'addr_test1metadata',
      { kind: 'inline', value: 'metadata-datum' },
      { 'voucher-reference': 1n },
    );
  });
});
