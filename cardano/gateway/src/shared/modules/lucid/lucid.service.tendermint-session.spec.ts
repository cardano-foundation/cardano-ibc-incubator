import { LucidService } from './lucid.service';

function createBuilder(): any {
  const builder: any = {};
  builder.readFrom = jest.fn().mockReturnValue(builder);
  builder.collectFrom = jest.fn().mockReturnValue(builder);
  builder.withdraw = jest.fn().mockReturnValue(builder);
  builder.mintAssets = jest.fn().mockReturnValue(builder);
  builder.addSignerKey = jest.fn().mockReturnValue(builder);
  builder.pay = { ToContract: jest.fn().mockReturnValue(builder) };
  return builder;
}

function createService(builder: any): any {
  const service: any = Object.create(LucidService.prototype);
  service.configService = {
    getOrThrow(name: string) {
      return this.get(name);
    },
    get: jest.fn().mockReturnValue({
      hostStateNFT: { policyId: 'host-policy', name: 'host-name' },
      validators: {
        hostStateStt: { address: 'addr_test1host' },
        spendClient: { address: 'addr_test1client' },
        recoverClient: { address: 'stake_test1history' },
        spendTendermintUpdateSession: {
          address: 'addr_test1session',
          scriptHash: 'session-spend-policy',
        },
        mintTendermintUpdateSession: {
          scriptHash: 'session-mint-policy',
        },
      },
    }),
  };
  service.lucid = { newTx: jest.fn().mockReturnValue(builder) };
  service.referenceScripts = {
    hostStateStt: { txHash: 'host-ref', outputIndex: 0 },
    spendClient: { txHash: 'client-ref', outputIndex: 0 },
    recoverClient: { txHash: 'history-ref', outputIndex: 0 },
    spendTendermintUpdateSession: { txHash: 'session-spend-ref', outputIndex: 0 },
    mintTendermintUpdateSession: { txHash: 'session-mint-ref', outputIndex: 0 },
  };
  return service;
}

describe('LucidService staged Tendermint transaction wiring', () => {
  it('mints the session NFT from the declared seed', async () => {
    const builder = createBuilder();
    const service = createService(builder);
    const seed = { txHash: 'seed', outputIndex: 1 };

    expect(
      await service.createUnsignedTendermintSessionTransaction(
        seed,
        'mint-redeemer',
        'initial-datum',
        'session-unit',
        'owner-key-hash',
      ),
    ).toBe(builder);

    expect(builder.readFrom).toHaveBeenCalledWith([service.referenceScripts.mintTendermintUpdateSession]);
    expect(builder.collectFrom).toHaveBeenCalledWith([seed]);
    expect(builder.mintAssets).toHaveBeenCalledWith({ 'session-unit': 1n }, 'mint-redeemer');
    expect(builder.pay.ToContract).toHaveBeenCalledWith(
      'addr_test1session',
      { kind: 'inline', value: 'initial-datum' },
      { 'session-unit': 1n },
    );
    expect(builder.addSignerKey).toHaveBeenCalledWith('owner-key-hash');
  });

  it('preserves the existing session reserve when advancing a verification batch', async () => {
    const builder = createBuilder();
    const service = createService(builder);
    // The trusted accumulator's datum shrinks when its count advances from 30 to 36.
    const session = {
      txHash: 'session-input',
      outputIndex: 2,
      assets: Object.freeze({ lovelace: 5_434_910n, 'session-unit': 1n }),
    };

    await service.createUnsignedAdvanceTendermintSessionTransaction(
      session,
      'verify-redeemer',
      'next-datum',
      'session-unit',
      'signer-key-hash',
    );

    expect(builder.readFrom).toHaveBeenCalledWith([service.referenceScripts.spendTendermintUpdateSession]);
    expect(builder.collectFrom).toHaveBeenCalledWith([session], 'verify-redeemer');
    expect(builder.pay.ToContract).toHaveBeenCalledWith(
      'addr_test1session',
      { kind: 'inline', value: 'next-datum' },
      { lovelace: 5_434_910n, 'session-unit': 1n },
    );
    expect(builder.addSignerKey).toHaveBeenCalledWith('signer-key-hash');
  });

  it('cancels a session by consuming it, burning its NFT, and requiring its owner', async () => {
    const builder = createBuilder();
    const service = createService(builder);
    const session = { txHash: 'session-input', outputIndex: 2 };

    await service.createUnsignedCancelTendermintSessionTransaction(
      session,
      'cancel-redeemer',
      'burn-redeemer',
      'session-unit',
      'owner-key-hash',
    );

    expect(builder.readFrom).toHaveBeenCalledWith([
      service.referenceScripts.spendTendermintUpdateSession,
      service.referenceScripts.mintTendermintUpdateSession,
    ]);
    expect(builder.collectFrom).toHaveBeenCalledWith([session], 'cancel-redeemer');
    expect(builder.mintAssets).toHaveBeenCalledWith({ 'session-unit': -1n }, 'burn-redeemer');
    expect(builder.addSignerKey).toHaveBeenCalledWith('owner-key-hash');
    expect(builder.pay.ToContract).not.toHaveBeenCalled();
  });

  it.each([[false, false], [true, false], [false, true], [true, true]])(
    'atomically finalizes sessions, evidence: %s, forwarded: %s', async (evidence, forwarded) => {
    const builder = createBuilder();
    const service = createService(builder);
    if (forwarded) {
      service.configService.get('deployment').validators.updateClient = { address: 'stake_test1update' };
      service.referenceScripts.updateClient = { txHash: 'update-ref', outputIndex: 0 };
    }
    const host = {
      txHash: 'host-input', outputIndex: 0, datum: 'raw-host', datumHash: 'old-hash',
      assets: { lovelace: 8_000_000n, 'host-policyhost-name': 1n, reserve: 7n },
    };
    // A revision reset can shrink the datum and its minimum ADA. The existing
    // state reserve still belongs to the continuing client output.
    const client = {
      txHash: 'client-input', outputIndex: 0,
      assets: { lovelace: 2_732_540n, 'client-unit': 1n },
    };
    const session = { txHash: 'session-input', outputIndex: 0 };
    const secondSession = { txHash: 'second-session-input', outputIndex: 0 };

    await service.createUnsignedFinalizeTendermintSessionTransaction(
      host,
      'host-redeemer',
      client,
      'client-redeemer',
      session,
      'finalize-session',
      'burn-session',
      'updated-host',
      'updated-client',
      'client-unit',
      'session-unit',
      'signer-key-hash',
      'history-redeemer',
      evidence ? [{ utxo: secondSession, tokenUnit: 'second-session-unit' }] : [],
    );

    expect(builder.readFrom).toHaveBeenCalledWith([
      service.referenceScripts.hostStateStt,
      service.referenceScripts.spendClient,
      service.referenceScripts.spendTendermintUpdateSession,
      service.referenceScripts.mintTendermintUpdateSession,
      forwarded ? service.referenceScripts.updateClient : service.referenceScripts.recoverClient,
    ]);
    expect(builder.collectFrom).toHaveBeenCalledWith(
      [{ ...host, datum: 'raw-host', datumHash: undefined }],
      'host-redeemer',
    );
    expect(builder.collectFrom).toHaveBeenCalledWith([client], 'client-redeemer');
    expect(builder.collectFrom).toHaveBeenCalledWith(
      evidence ? [session, secondSession] : [session],
      'finalize-session',
    );
    expect(builder.mintAssets).toHaveBeenCalledWith(
      evidence ? { 'session-unit': -1n, 'second-session-unit': -1n } : { 'session-unit': -1n },
      'burn-session',
    );
    expect(builder.pay.ToContract).toHaveBeenCalledWith(
      'addr_test1host',
      { kind: 'inline', value: 'updated-host' },
      host.assets,
    );
    expect(builder.pay.ToContract).toHaveBeenCalledWith(
      'addr_test1client',
      { kind: 'inline', value: 'updated-client' },
      client.assets,
    );
    expect(builder.withdraw).toHaveBeenCalledWith(
      forwarded ? 'stake_test1update' : 'stake_test1history', 0n, 'history-redeemer',
    );
    expect(builder.addSignerKey).toHaveBeenCalledWith('signer-key-hash');
  });

  it('does not fall back to recovery when configured ordinary support is incomplete', async () => {
    const builder = createBuilder();
    const service = createService(builder);
    service.configService.get('deployment').validators.updateClient = { address: 'stake_test1update' };
    await expect(service.createUnsignedFinalizeTendermintSessionTransaction(
      {}, '', {}, '', {}, '', '', '', '', '', '', '', '',
    )).rejects.toThrow('Staged Tendermint history support is not configured');
    expect(builder.readFrom).not.toHaveBeenCalled();
  });
});
