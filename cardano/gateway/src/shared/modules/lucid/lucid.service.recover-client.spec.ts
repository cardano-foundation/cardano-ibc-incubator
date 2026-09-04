import { LucidService } from './lucid.service';

describe('LucidService recover client wiring', () => {
  function setup() {
    const txBuilder: any = {};
    txBuilder.readFrom = jest.fn().mockReturnValue(txBuilder);
    txBuilder.collectFrom = jest.fn().mockReturnValue(txBuilder);
    txBuilder.withdraw = jest.fn().mockReturnValue(txBuilder);
    txBuilder.addSignerKey = jest.fn().mockReturnValue(txBuilder);
    txBuilder.pay = { ToContract: jest.fn().mockReturnValue(txBuilder) };

    const service: any = Object.create(LucidService.prototype);
    service.configService = {
      get: jest.fn().mockReturnValue({
        hostStateNFT: { policyId: 'host-policy', name: 'host-token' },
        validators: {
          hostStateStt: { address: 'addr_test1host' },
          spendClient: { address: 'addr_test1client' },
          recoverClient: { address: 'stake_test1recovery' },
        },
      }),
    };
    service.lucid = { newTx: jest.fn().mockReturnValue(txBuilder) };
    service.referenceScripts = {
      hostStateStt: { txHash: 'host-ref', outputIndex: 0 },
      spendClient: { txHash: 'client-ref', outputIndex: 0 },
      recoverClient: { txHash: 'recovery-ref', outputIndex: 0 },
    };

    return { service, txBuilder };
  }

  it('spends the subject, reads the substitute and invokes the recovery withdrawal', () => {
    const { service, txBuilder } = setup();
    const host = { txHash: 'host', outputIndex: 0, datum: 'host-datum', datumHash: 'hash' };
    const subject = { txHash: 'subject', outputIndex: 0 };
    const substitute = { txHash: 'substitute', outputIndex: 0 };

    const result = service.createUnsignedRecoverClientTransaction(
      host,
      'host-redeemer',
      subject,
      'subject-redeemer',
      substitute,
      'withdrawal-redeemer',
      'new-host-datum',
      'new-subject-datum',
      'subject-unit',
      'signer-key-hash',
    );

    expect(result).toBe(txBuilder);
    expect(txBuilder.readFrom).toHaveBeenCalledWith([
      service.referenceScripts.hostStateStt,
      service.referenceScripts.spendClient,
      service.referenceScripts.recoverClient,
      substitute,
    ]);
    expect(txBuilder.collectFrom).toHaveBeenNthCalledWith(
      1,
      [{ ...host, datum: 'host-datum', datumHash: undefined }],
      'host-redeemer',
    );
    expect(txBuilder.collectFrom).toHaveBeenNthCalledWith(2, [subject], 'subject-redeemer');
    expect(txBuilder.withdraw).toHaveBeenCalledWith('stake_test1recovery', 0n, 'withdrawal-redeemer');
    expect(txBuilder.addSignerKey).toHaveBeenCalledWith('signer-key-hash');
  });

  it('fails clearly when the recovery validator is absent from the deployment', () => {
    const { service } = setup();
    service.configService.get.mockReturnValue({
      hostStateNFT: { policyId: 'host-policy', name: 'host-token' },
      validators: {
        hostStateStt: { address: 'addr_test1host' },
        spendClient: { address: 'addr_test1client' },
      },
    });
    service.referenceScripts.recoverClient = undefined;

    expect(() => service.createUnsignedRecoverClientTransaction({}, '', {}, '', {}, '', '', '', '', '')).toThrow(
      'Tendermint client recovery is not configured',
    );
  });
});
