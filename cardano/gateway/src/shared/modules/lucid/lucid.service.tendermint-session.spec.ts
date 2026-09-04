import { LucidService } from './lucid.service';

function createBuilder(): any {
  const builder: any = {};
  builder.readFrom = jest.fn().mockReturnValue(builder);
  builder.collectFrom = jest.fn().mockReturnValue(builder);
  builder.mintAssets = jest.fn().mockReturnValue(builder);
  builder.addSignerKey = jest.fn().mockReturnValue(builder);
  builder.pay = { ToContract: jest.fn().mockReturnValue(builder) };
  return builder;
}

function createService(builder: any): any {
  const service: any = Object.create(LucidService.prototype);
  service.configService = {
    get: jest.fn().mockReturnValue({
      hostStateNFT: { policyId: 'host-policy', name: 'host-name' },
      validators: {
        hostStateStt: { address: 'addr_test1host' },
        spendClient: { address: 'addr_test1client' },
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
    spendTendermintUpdateSession: { txHash: 'session-spend-ref', outputIndex: 0 },
    mintTendermintUpdateSession: { txHash: 'session-mint-ref', outputIndex: 0 },
  };
  return service;
}

describe('LucidService staged Tendermint transaction wiring', () => {
  it('mints the session NFT from the declared seed', () => {
    const builder = createBuilder();
    const service = createService(builder);
    const seed = { txHash: 'seed', outputIndex: 1 };

    expect(
      service.createUnsignedTendermintSessionTransaction(
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

  it('spends and recreates the unique session output for one verification batch', () => {
    const builder = createBuilder();
    const service = createService(builder);
    const session = { txHash: 'session-input', outputIndex: 2 };

    service.createUnsignedAdvanceTendermintSessionTransaction(
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
      { 'session-unit': 1n },
    );
    expect(builder.addSignerKey).toHaveBeenCalledWith('signer-key-hash');
  });

  it('cancels a session by consuming it, burning its NFT, and requiring its owner', () => {
    const builder = createBuilder();
    const service = createService(builder);
    const session = { txHash: 'session-input', outputIndex: 2 };

    service.createUnsignedCancelTendermintSessionTransaction(
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

  it('atomically burns a complete session and updates client and HostState', () => {
    const builder = createBuilder();
    const service = createService(builder);
    const host = { txHash: 'host-input', outputIndex: 0, datum: 'raw-host', datumHash: 'old-hash' };
    const client = { txHash: 'client-input', outputIndex: 0 };
    const session = { txHash: 'session-input', outputIndex: 0 };

    service.createUnsignedFinalizeTendermintSessionTransaction(
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
    );

    expect(builder.readFrom).toHaveBeenCalledWith([
      service.referenceScripts.hostStateStt,
      service.referenceScripts.spendClient,
      service.referenceScripts.spendTendermintUpdateSession,
      service.referenceScripts.mintTendermintUpdateSession,
    ]);
    expect(builder.collectFrom).toHaveBeenCalledWith(
      [{ ...host, datum: 'raw-host', datumHash: undefined }],
      'host-redeemer',
    );
    expect(builder.collectFrom).toHaveBeenCalledWith([client], 'client-redeemer');
    expect(builder.collectFrom).toHaveBeenCalledWith([session], 'finalize-session');
    expect(builder.mintAssets).toHaveBeenCalledWith({ 'session-unit': -1n }, 'burn-session');
    expect(builder.pay.ToContract).toHaveBeenCalledWith(
      'addr_test1host',
      { kind: 'inline', value: 'updated-host' },
      { 'host-policyhost-name': 1n },
    );
    expect(builder.pay.ToContract).toHaveBeenCalledWith(
      'addr_test1client',
      { kind: 'inline', value: 'updated-client' },
      { 'client-unit': 1n },
    );
    expect(builder.addSignerKey).toHaveBeenCalledWith('signer-key-hash');
  });
});
