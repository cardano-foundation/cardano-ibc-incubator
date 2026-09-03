import { GUARDS_METADATA } from '@nestjs/common/constants';

import { GrpcAuthGuard } from '../../security/grpc-auth.guard';
import { TxController } from '../tx.controller';

describe('TxController ObserveTx', () => {
  it('is covered by the transaction controller authentication guard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, TxController) ?? [];

    expect(guards).toContain(GrpcAuthGuard);
  });

  it('delegates the hash-only request and response', async () => {
    const request = { tx_hash: 'ab'.repeat(32) };
    const response = {
      tx_hash: request.tx_hash,
      height: '0-42',
      events: [],
    };
    const submissionService = {
      observeTransaction: jest.fn().mockResolvedValue(response),
    };
    const controller = new TxController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      submissionService as any,
      {} as any,
    );

    await expect(controller.ObserveTx(request)).resolves.toBe(response);
    expect(submissionService.observeTransaction).toHaveBeenCalledWith(request);
  });
});
