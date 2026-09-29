import { ConfigService } from '@nestjs/config';
import * as Lucid from '@lucid-evolution/lucid';

import { ICS23MerkleTree } from '../../helpers/ics23-merkle-tree';
import { IbcTreeStateStore } from '../../helpers/ibc-state-root';
import { LucidService } from './lucid.service';

const hash = (value: number) => value.toString(16).padStart(2, '0').repeat(28);
const record = (...fields: Lucid.Data[]) => new Lucid.Constr(0, fields);
const scriptAddress = (value: number) => Lucid.credentialToAddress('Custom', { type: 'Script', hash: hash(value) });
const rawAddress = (value: number) => record(new Lucid.Constr(1, [hash(value)]), new Lucid.Constr(1, []));

function txBuilder() {
  const builder: any = {};
  for (const method of ['readFrom', 'collectFrom', 'withdraw', 'mintAssets', 'addSignerKey']) {
    builder[method] = jest.fn().mockReturnValue(builder);
  }
  builder.pay = { ToContract: jest.fn().mockReturnValue(builder) };
  return builder;
}

function fixture(initialMask: bigint) {
  let mask = initialMask;
  const addresses = [1, 2, 3, 4, 5].map(scriptAddress);
  const registryUnit = hash(9) + Buffer.from('ibc_implementation_registry').toString('hex');
  const compatibility = 'ab'.repeat(32);
  const hostStateUnit = hash(8) + Buffer.from('ibc_host_state').toString('hex');
  const deployment: any = {
    deploymentMode: 'upgradeable',
    migration: {
      profile: 'cardano-ibc-compatible-v3',
      registryUnit,
      registryAddress: scriptAddress(10),
      generation: '1',
      compatibility,
      originalAddresses: addresses,
    },
    hostStateNFT: { policyId: hash(8), name: Buffer.from('ibc_host_state').toString('hex') },
    validators: {
      hostStateStt: { address: addresses[0] },
      spendClient: { address: addresses[1] },
      spendConnection: { address: addresses[2] },
      spendChannel: { address: addresses[3] },
      spendTransferModule: { address: addresses[4] },
      mintClientStt: { scriptHash: hash(11) },
      mintConnectionStt: { scriptHash: hash(12) },
      mintChannelStt: { scriptHash: hash(13) },
      mintTransferEscrowShard: { scriptHash: hash(14) },
      recoverClient: { address: scriptAddress(18) },
    },
    modules: { transfer: { address: addresses[4] } },
  };
  const registryUtxo = () => ({
    txHash: '99'.repeat(32),
    outputIndex: 0,
    address: scriptAddress(10),
    assets: { [registryUnit]: 1n },
    datum: Lucid.Data.to(
      record(
        record(hash(9), registryUnit.slice(56)),
        hash(8),
        record(hash(11), hash(12), hash(13), hash(14), rawAddress(15)),
        record([hash(16)], 1n, 86_400_000n),
        0n,
        record(1n, [1, 2, 3, 4, 5].map(rawAddress), compatibility),
        new Lucid.Constr(0, []),
        record(record([hash(17)], 1n), 0n, mask, new Lucid.Constr(1, [])),
      ),
    ),
  });
  const tree = new ICS23MerkleTree();
  const hostStateUtxo: any = {
    txHash: '88'.repeat(32),
    outputIndex: 0,
    address: addresses[0],
    assets: { [hostStateUnit]: 1n },
    datum: 'host-state-datum',
  };
  const lucid: any = {
    config: () => ({ network: 'Custom' }),
    utxoByUnit: jest.fn(async () => registryUtxo()),
    utxosAt: jest.fn(async () => [hostStateUtxo]),
    newTx: jest.fn(() => txBuilder()),
  };
  const service: any = Object.create(LucidService.prototype);
  service.LucidImporter = Lucid;
  service.lucid = lucid;
  service.configService = new ConfigService({ deployment });
  service.referenceScripts = {
    hostStateStt: { txHash: '01'.repeat(32), outputIndex: 0 },
    spendClient: { txHash: '02'.repeat(32), outputIndex: 0 },
    recoverClient: { txHash: '03'.repeat(32), outputIndex: 0 },
  };
  service.decodeDatum = jest.fn(async () => ({
    state: { ibc_state_root: tree.getRoot() },
    control: { port_registry: new Map() },
  }));
  const kupo = {
    queryAllClientUtxos: jest.fn(async () => []),
    queryAllConnectionUtxos: jest.fn(async () => []),
    queryAllChannelUtxos: jest.fn(async () => []),
  };
  const store = new IbcTreeStateStore(
    {
      network: 'Custom',
      hostStateNFT: deployment.hostStateNFT,
      clientPolicyId: deployment.validators.mintClientStt.scriptHash,
    },
    kupo,
    service,
  );
  const findHostState = jest.spyOn(service, 'findUtxoAtHostStateNFT');
  return {
    deployment,
    findHostState,
    hostStateUtxo,
    registryUtxo,
    service,
    setMask: (next: bigint) => {
      mask = next;
    },
    store,
    tree,
  };
}

describe('Gateway emergency restriction wiring', () => {
  const clientUtxo: any = { txHash: '77'.repeat(32), outputIndex: 0, assets: { client: 1n }, datum: 'client' };

  it.each([1n, 9n])('builds client maintenance and heartbeat transactions under restriction mask %s', async (mask) => {
    const test = fixture(mask);
    await test.store.restoreTreeFromCache(test.tree);

    const clientHostState = await test.service.findUtxoAtHostStateNFT(2n);
    await expect(test.store.getAlignedSnapshot()).resolves.toMatchObject({ root: test.tree.getRoot() });
    const clientTx = await test.service.createUnsignedUpdateClientTransaction(
      clientHostState,
      'update-client',
      clientUtxo,
      'spend-client',
      'updated-host-state',
      'updated-client',
      'client-token',
      test.deployment.validators.spendClient.address,
      'history-witness',
    );

    const heartbeatHostState = await test.service.findUtxoAtHostStateNFT(4n);
    await expect(test.store.getAlignedSnapshot()).resolves.toMatchObject({ root: test.tree.getRoot() });
    const heartbeatTx = await test.service.createUnsignedHostStateHeartbeatTransaction(
      heartbeatHostState,
      'heartbeat',
      'updated-host-state',
      hash(20),
    );

    await expect(test.service.findUtxoAtHostStateNFT()).rejects.toThrow('emergency-restricted');
    await expect(
      test.service.createUnsignedRecvPacketTx({ hostStateUtxo: test.hostStateUtxo } as never),
    ).rejects.toThrow('emergency-restricted');
    expect(test.findHostState.mock.calls.some(([restriction]) => restriction === 0n)).toBe(true);
    expect(clientTx.readFrom).toHaveBeenCalledWith([test.registryUtxo()]);
    expect(heartbeatTx.readFrom).toHaveBeenCalledWith([test.registryUtxo()]);
  });

  it('rejects client maintenance and heartbeat with their independent masks', async () => {
    const test = fixture(2n);
    await expect(test.service.findUtxoAtHostStateNFT(2n)).rejects.toThrow('emergency-restricted');
    await expect(
      test.service.createUnsignedUpdateClientTransaction(
        test.hostStateUtxo,
        'update-client',
        clientUtxo,
        'spend-client',
        'updated-host-state',
        'updated-client',
        'client-token',
        test.deployment.validators.spendClient.address,
        'history-witness',
      ),
    ).rejects.toThrow('emergency-restricted');

    test.setMask(4n);
    await expect(test.service.findUtxoAtHostStateNFT(4n)).rejects.toThrow('emergency-restricted');
    await expect(
      test.service.createUnsignedHostStateHeartbeatTransaction(
        test.hostStateUtxo,
        'heartbeat',
        'updated-host-state',
        hash(20),
      ),
    ).rejects.toThrow('emergency-restricted');
  });
});
