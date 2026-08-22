import * as LucidImporter from '@lucid-evolution/lucid';

import { LucidService } from './lucid.service';

function utxo(txHash: string, assets: Record<string, bigint>, datum?: string) {
  return {
    txHash,
    outputIndex: 0,
    address: 'addr_test1script',
    assets,
    datum,
  } as any;
}

function setup() {
  const tx: any = {};
  tx.readFrom = jest.fn().mockReturnValue(tx);
  tx.collectFrom = jest.fn().mockReturnValue(tx);
  tx.mintAssets = jest.fn().mockReturnValue(tx);
  tx.addSignerKey = jest.fn().mockReturnValue(tx);
  tx.pay = {
    ToContract: jest.fn().mockReturnValue(tx),
    ToAddress: jest.fn().mockReturnValue(tx),
  };
  const deployment = {
    hostStateNFT: { policyId: 'host-policy', name: 'host-name' },
    validators: {
      hostStateStt: { address: 'host-address' },
      spendClient: { address: 'client-address' },
      spendConnection: { address: 'connection-address' },
      spendChannel: { address: 'channel-address' },
      mintLifecycleCreationMarker: { scriptHash: 'creation-policy' },
      mintLifecycleReclamationMarker: { scriptHash: 'reclamation-policy' },
      mintLifecycleOperationalMarker: { scriptHash: 'operational-policy' },
      mintLifecyclePacketMarker: { scriptHash: 'packet-policy' },
    },
    modules: {
      transfer: { address: 'transfer-module-address' },
      mock: { address: 'mock-module-address' },
    },
  };
  const service: any = Object.create(LucidService.prototype);
  service.lucid = { newTx: jest.fn().mockReturnValue(tx) };
  service.LucidImporter = LucidImporter;
  service.configService = { get: jest.fn().mockReturnValue(deployment) };
  service.referenceScripts = {
    hostStateStt: utxo('host-ref', {}),
    spendClient: utxo('client-ref', {}),
    mintClient: utxo('mint-client-ref', {}),
    spendConnection: utxo('connection-ref', {}),
    mintConnection: utxo('mint-connection-ref', {}),
    spendChannel: utxo('channel-ref', {}),
    mintChannel: utxo('mint-channel-ref', {}),
    mintLifecycleCreationMarker: utxo('creation-marker-ref', {}),
    mintLifecycleReclamationMarker: utxo('reclamation-marker-ref', {}),
    mintLifecycleOperationalMarker: utxo('operational-marker-ref', {}),
    mintLifecyclePacketMarker: utxo('packet-marker-ref', {}),
    spendTransferModule: utxo('transfer-ref', {}),
    spendMockModule: utxo('mock-ref', {}),
    verifyProof: utxo('proof-ref', {}),
    channelCloseInit: utxo('channel-close-init-ref', {}),
  };
  return { service, tx };
}

describe('LucidService core lifecycle transaction builders', () => {
  it('adds one normal-update receipt for client, connection, and channel updates', () => {
    const { service, tx } = setup();
    const markerUnit = `operational-policy${Buffer.from('ibc_lifecycle').toString('hex')}`;
    const host = utxo(
      'host',
      {
        'host-policyhost-name': 1n,
        [markerUnit]: 2n,
      },
      'host-datum',
    );
    const client = utxo('client', { client: 1n }, 'client-datum');
    const connection = utxo('connection', { connection: 1n }, 'connection-datum');
    const channel = utxo('channel', { channel: 1n }, 'channel-datum');
    const module = utxo('module', { module: 1n });

    service.createUnsignedUpdateClientTransaction(
      host,
      'host-update-client',
      client,
      'client-update',
      'new-host',
      'new-client',
      'client-unit',
      '',
    );
    service.createUnsignedConnectionOpenAckTransaction({
      hostStateUtxo: host,
      connectionUtxo: connection,
      clientUtxo: client,
      encodedHostStateRedeemer: 'host-update-connection',
      encodedSpendConnectionRedeemer: 'connection-update',
      encodedUpdatedHostStateDatum: 'new-host',
      encodedUpdatedConnectionDatum: 'new-connection',
      connectionTokenUnit: 'connection-unit',
      verifyProofPolicyId: 'proof-policy',
      encodedVerifyProofRedeemer: 'proof-redeemer',
    });
    service.createUnsignedChannelCloseInitTransaction({
      hostStateUtxo: host,
      channelUtxo: channel,
      connectionUtxo: connection,
      clientUtxo: client,
      moduleUtxo: module,
      moduleKey: 'mock',
      encodedHostStateRedeemer: 'host-update-channel',
      encodedSpendChannelRedeemer: 'channel-update',
      encodedSpendModuleRedeemer: 'module-callback',
      encodedUpdatedHostStateDatum: 'new-host',
      encodedUpdatedChannelDatum: 'new-channel',
      channelTokenUnit: 'channel-unit',
      channelCloseInitPolicyId: 'close-policy',
      channelToken: { policyId: '11'.repeat(28), name: 'aa' },
    });

    const markerMints = tx.mintAssets.mock.calls.filter(
      ([assets]: [Record<string, bigint>]) => assets[markerUnit] === 1n,
    );
    expect(markerMints).toHaveLength(3);
    expect(tx.readFrom).toHaveBeenCalledWith([
      expect.objectContaining({ txHash: 'operational-marker-ref' }),
    ]);
    expect(tx.pay.ToContract).toHaveBeenCalledWith(
      'host-address',
      { kind: 'inline', value: 'new-host' },
      expect.objectContaining({ [markerUnit]: 3n }),
    );
  });

  it('mints one creation receipt in every client, connection, and channel creation builder', () => {
    const { service, tx } = setup();
    const markerUnit = `creation-policy${Buffer.from('ibc_lifecycle').toString('hex')}`;
    const host = utxo(
      'host',
      {
        lovelace: 2_000_000n,
        'host-policyhost-name': 1n,
        [markerUnit]: 4n,
      },
      'host-datum',
    );
    const client = utxo('client', { client: 1n }, 'client-datum');
    const connection = utxo('connection', { connection: 1n }, 'connection-datum');
    const module = utxo('module', { port: 1n, module: 1n });

    service.createUnsignedCreateClientTransaction(
      host,
      'host-create-client',
      'client-unit',
      'mint-client',
      'new-host',
      'new-client',
      '',
    );
    for (const build of [
      service.createUnsignedConnectionOpenInitTransaction.bind(service),
      service.createUnsignedConnectionOpenTryTransaction.bind(service),
    ]) {
      build(
        host,
        'host-create-connection',
        'connection-unit',
        client,
        'mint-connection',
        'new-host',
        'new-connection',
        '',
      );
    }
    const channelDto = {
      hostStateUtxo: host,
      connectionUtxo: connection,
      moduleUtxo: module,
      clientUtxo: client,
      moduleKey: 'mock',
      encodedHostStateRedeemer: 'host-create-channel',
      encodedSpendConnectionRedeemer: 'spend-connection',
      encodedSpendModuleRedeemer: 'spend-module',
      encodedMintChannelRedeemer: 'mint-channel',
      encodedUpdatedHostStateDatum: 'new-host',
      encodedUpdatedConnectionDatum: 'new-connection',
      encodedChannelDatum: 'new-channel',
      channelTokenUnit: 'channel-unit',
    };
    service.createUnsignedChannelOpenInitTransaction(channelDto);
    service.createUnsignedChannelOpenTryTransaction(channelDto);

    const markerMints = tx.mintAssets.mock.calls.filter(
      ([assets]: [Record<string, bigint>]) => assets[markerUnit] === 1n,
    );
    expect(markerMints).toHaveLength(5);
    expect(markerMints.every(([, redeemer]: [Record<string, bigint>, string]) => redeemer === 'd87980')).toBe(true);
    expect(tx.readFrom.mock.calls.flat(2)).toContainEqual(expect.objectContaining({ txHash: 'creation-marker-ref' }));
    expect(tx.pay.ToContract).toHaveBeenCalledWith(
      'host-address',
      { kind: 'inline', value: 'new-host' },
      expect.objectContaining({
        'host-policyhost-name': 1n,
        [markerUnit]: 5n,
      }),
    );
  });

  it('builds the three continuation lifecycle transactions with exact auth-token successors', () => {
    const { service, tx } = setup();
    const markerUnit = `reclamation-policy${Buffer.from('ibc_lifecycle').toString('hex')}`;
    const host = utxo(
      'host',
      {
        'host-policyhost-name': 1n,
        existing: 7n,
        [markerUnit]: 2n,
      },
      'host-datum',
    );

    service.createUnsignedPruneTerminalClientTransaction({
      hostStateUtxo: host,
      clientUtxo: utxo('client', {}, 'client-datum'),
      encodedHostStateRedeemer: 'host-prune',
      encodedClientRedeemer: 'client-prune',
      encodedUpdatedHostStateDatum: 'new-host',
      encodedUpdatedClientDatum: 'new-client',
      clientTokenUnit: 'client-unit',
    });
    service.createUnsignedBeginConnectionRetirementTransaction({
      hostStateUtxo: host,
      connectionUtxo: utxo('connection', {}, 'connection-datum'),
      encodedHostStateRedeemer: 'host-begin-connection',
      encodedConnectionRedeemer: 'begin-connection',
      encodedUpdatedHostStateDatum: 'new-host',
      encodedUpdatedConnectionDatum: 'new-connection',
      connectionTokenUnit: 'connection-unit',
      signerKeyHash: '11'.repeat(28),
    });
    service.createUnsignedBeginChannelAbandonmentTransaction({
      hostStateUtxo: host,
      channelUtxo: utxo('channel', {}, 'channel-datum'),
      encodedHostStateRedeemer: 'host-begin-channel',
      encodedChannelRedeemer: 'begin-channel',
      encodedUpdatedHostStateDatum: 'new-host',
      encodedUpdatedChannelDatum: 'new-channel',
      channelTokenUnit: 'channel-unit',
      signerKeyHash: '11'.repeat(28),
    });

    expect(tx.pay.ToContract).toHaveBeenCalledWith(
      'client-address',
      { kind: 'inline', value: 'new-client' },
      { 'client-unit': 1n },
    );
    expect(tx.pay.ToContract).toHaveBeenCalledWith(
      'connection-address',
      { kind: 'inline', value: 'new-connection' },
      { 'connection-unit': 1n },
    );
    expect(tx.pay.ToContract).toHaveBeenCalledWith(
      'channel-address',
      { kind: 'inline', value: 'new-channel' },
      { 'channel-unit': 1n },
    );
    expect(tx.addSignerKey).toHaveBeenCalledTimes(2);
    expect(tx.readFrom).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ txHash: 'reclamation-marker-ref' })]),
    );
    expect(tx.mintAssets).toHaveBeenCalledWith({ [markerUnit]: 1n }, 'd87980');
    expect(tx.pay.ToContract).toHaveBeenCalledWith(
      'host-address',
      { kind: 'inline', value: 'new-host' },
      expect.objectContaining({
        'host-policyhost-name': 1n,
        existing: 7n,
        [markerUnit]: 3n,
      }),
    );
  });

  it('burns the client NFT and pays the entire client ADA bounty to the enterprise target', () => {
    const { service, tx } = setup();
    const client = utxo('client', { lovelace: 3_500_000n, 'client-unit': 1n }, 'client-datum');

    service.createUnsignedReclaimClientTransaction({
      hostStateUtxo: utxo('host', { lovelace: 2_000_000n, 'host-policyhost-name': 1n }, 'host-datum'),
      clientUtxo: client,
      encodedHostStateRedeemer: 'host-redeemer',
      encodedClientRedeemer: 'client-redeemer',
      encodedMintClientRedeemer: 'burn-client',
      encodedUpdatedHostStateDatum: 'new-host',
      clientTokenUnit: 'client-unit',
      reclaimAddress: 'addr_test1enterprise',
    });

    expect(tx.mintAssets).toHaveBeenCalledWith({ 'client-unit': -1n }, 'burn-client');
    expect(tx.pay.ToAddress).toHaveBeenCalledWith('addr_test1enterprise', { lovelace: 3_500_000n });
    expect(tx.pay.ToContract.mock.calls.flat()).not.toContainEqual(expect.objectContaining({ 'client-unit': 1n }));
  });

  it('burns the connection NFT and does not create a connection successor', () => {
    const { service, tx } = setup();
    service.createUnsignedReclaimConnectionTransaction({
      hostStateUtxo: utxo('host', {}, 'host-datum'),
      connectionUtxo: utxo('connection', { lovelace: 4_000_000n, 'connection-unit': 1n }, 'datum'),
      encodedHostStateRedeemer: 'host-redeemer',
      encodedConnectionRedeemer: 'connection-redeemer',
      encodedMintConnectionRedeemer: 'burn-connection',
      encodedUpdatedHostStateDatum: 'new-host',
      connectionTokenUnit: 'connection-unit',
      reclaimAddress: 'addr_test1enterprise',
    });

    expect(tx.mintAssets).toHaveBeenCalledWith({ 'connection-unit': -1n }, 'burn-connection');
    expect(tx.pay.ToAddress).toHaveBeenCalledWith('addr_test1enterprise', { lovelace: 4_000_000n });
    expect(tx.pay.ToContract).toHaveBeenCalledTimes(1);
  });

  it('burns the channel NFT, decrements its parent, and exactly continues a NoDatum module root', () => {
    const { service, tx } = setup();
    const moduleAssets = { lovelace: 2_000_000n, port: 1n, module: 1n };
    service.createUnsignedReclaimChannelTransaction({
      hostStateUtxo: utxo('host', {}, 'host-datum'),
      channelUtxo: utxo('channel', { lovelace: 5_000_000n, 'channel-unit': 1n }, 'datum'),
      connectionUtxo: utxo('connection', { lovelace: 2_000_000n, 'connection-unit': 1n }, 'datum'),
      moduleUtxo: utxo('module', moduleAssets),
      moduleKey: 'mock',
      encodedHostStateRedeemer: 'host-redeemer',
      encodedChannelRedeemer: 'channel-redeemer',
      encodedMintChannelRedeemer: 'burn-channel',
      encodedConnectionRedeemer: 'decrement-connection',
      encodedUpdatedHostStateDatum: 'new-host',
      encodedUpdatedConnectionDatum: 'new-connection',
      encodedModuleRedeemer: 'module-callback',
      channelTokenUnit: 'channel-unit',
      connectionTokenUnit: 'connection-unit',
      reclaimAddress: 'addr_test1enterprise',
    });

    expect(tx.collectFrom).toHaveBeenCalledWith([expect.objectContaining({ txHash: 'module' })], 'module-callback');
    expect(tx.mintAssets).toHaveBeenCalledWith({ 'channel-unit': -1n }, 'burn-channel');
    expect(tx.pay.ToAddress).toHaveBeenCalledWith('addr_test1enterprise', { lovelace: 5_000_000n });
    expect(tx.pay.ToContract).toHaveBeenCalledWith('mock-module-address', undefined, moduleAssets);
    expect(tx.pay.ToContract).toHaveBeenCalledWith(
      'connection-address',
      { kind: 'inline', value: 'new-connection' },
      { 'connection-unit': 1n },
    );
  });

  it('binds a transfer channel cleanup receipt to the selected registration', () => {
    const { service, tx } = setup();
    const target = {
      port_id: Buffer.from('transfer').toString('hex'),
      port_token: { policy_id: '11'.repeat(28), name: 'aa' },
      module_token: { policy_id: '22'.repeat(28), name: 'bb' },
    };

    service.createUnsignedReclaimChannelTransaction({
      hostStateUtxo: utxo('host', { 'host-policyhost-name': 1n }, 'host-datum'),
      channelUtxo: utxo('channel', { lovelace: 5_000_000n, 'channel-unit': 1n }, 'datum'),
      connectionUtxo: utxo('connection', { 'connection-unit': 1n }, 'datum'),
      moduleUtxo: utxo('module', { port: 1n, module: 1n }, 'module-datum'),
      moduleKey: 'transfer',
      lifecycleMarkerTarget: target,
      encodedHostStateRedeemer: 'host-redeemer',
      encodedChannelRedeemer: 'channel-redeemer',
      encodedMintChannelRedeemer: 'burn-channel',
      encodedConnectionRedeemer: 'decrement-connection',
      encodedUpdatedHostStateDatum: 'new-host',
      encodedUpdatedConnectionDatum: 'new-connection',
      encodedModuleRedeemer: 'module-callback',
      channelTokenUnit: 'channel-unit',
      connectionTokenUnit: 'connection-unit',
      reclaimAddress: 'addr_test1enterprise',
    });

    const markerUnit = `reclamation-policy${Buffer.from('ibc_lifecycle').toString('hex')}`;
    expect(tx.mintAssets).toHaveBeenCalledWith({ [markerUnit]: 1n }, expect.stringMatching(/^d87a83/));
  });
});
