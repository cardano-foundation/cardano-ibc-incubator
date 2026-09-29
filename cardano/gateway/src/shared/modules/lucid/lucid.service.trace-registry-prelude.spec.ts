import { LucidService } from './lucid.service';

describe('LucidService unsupported trace-registry prelude', () => {
  it('fails before constructing a transaction that cannot satisfy the voucher policy', async () => {
    const service = Object.create(LucidService.prototype) as any;
    service.newTxBuilder = jest.fn();
    await expect(service.createUnsignedTraceRegistryUpdateTx({ kind: 'append' }, {}))
      .rejects.toThrow('first-seen voucher receive must atomically spend RecvPacket');
    expect(service.newTxBuilder).not.toHaveBeenCalled();
  });
});
