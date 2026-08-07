import * as LucidImporter from '@lucid-evolution/lucid';

import { LucidService } from './lucid.service';

describe('LucidService HostState heartbeat wiring', () => {
  it('keeps the Heartbeat constructor index aligned with the Aiken redeemer', async () => {
    const service: any = Object.create(LucidService.prototype);
    service.LucidImporter = LucidImporter;

    await expect(service.encode('Heartbeat', 'host_state_redeemer')).resolves.toBe(
      'd9050380',
    );
  });

  it('spends and recreates only HostState with the heartbeat redeemer', () => {
    const txBuilder: any = {};
    txBuilder.readFrom = jest.fn().mockReturnValue(txBuilder);
    txBuilder.collectFrom = jest.fn().mockReturnValue(txBuilder);
    txBuilder.addSignerKey = jest.fn().mockReturnValue(txBuilder);
    txBuilder.pay = {
      ToContract: jest.fn().mockReturnValue(txBuilder),
    };

    const service: any = Object.create(LucidService.prototype);
    service.configService = {
      get: jest.fn().mockReturnValue({
        hostStateNFT: { policyId: 'host-policy', name: 'host-token' },
        validators: { hostStateStt: { address: 'addr_test1hoststate' } },
      }),
    };
    service.lucid = { newTx: jest.fn().mockReturnValue(txBuilder) };
    service.referenceScripts = {
      hostStateStt: { txHash: 'host-ref', outputIndex: 0 },
    };

    const hostStateUtxo = {
      txHash: 'host-input',
      outputIndex: 0,
      datum: 'raw-host-datum',
      datumHash: 'ignored-datum-hash',
    };
    const result = service.createUnsignedHostStateHeartbeatTransaction(
      hostStateUtxo,
      'encoded-heartbeat',
      'encoded-updated-host-datum',
      'signer-key-hash',
    );

    expect(result).toBe(txBuilder);
    expect(txBuilder.readFrom).toHaveBeenCalledWith([service.referenceScripts.hostStateStt]);
    expect(txBuilder.collectFrom).toHaveBeenCalledWith(
      [
        {
          ...hostStateUtxo,
          datum: 'raw-host-datum',
          datumHash: undefined,
        },
      ],
      'encoded-heartbeat',
    );
    expect(txBuilder.pay.ToContract).toHaveBeenCalledWith(
      'addr_test1hoststate',
      { kind: 'inline', value: 'encoded-updated-host-datum' },
      { 'host-policyhost-token': 1n },
    );
    expect(txBuilder.addSignerKey).toHaveBeenCalledWith('signer-key-hash');
  });
});
