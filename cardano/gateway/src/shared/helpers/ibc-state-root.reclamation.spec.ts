import {
  computeRootWithCreateChannelUpdate,
  computeRootWithCreateClientUpdate,
  computeRootWithCreateConnectionUpdate,
  committedModulePortIdHex,
  computeRootWithPruneTerminalClientUpdate,
  computeRootWithReclaimChannelUpdate,
  computeRootWithReclaimClientUpdate,
  computeRootWithReclaimConnectionUpdate,
  computeRootWithUpdateClientUpdate,
  resetTreeState,
} from './ibc-state-root';

describe('IBC lifecycle reclamation root updates', () => {
  beforeEach(() => resetTreeState());

  it('rebuilds a retired module marker at its original committed port path', () => {
    const transfer = Buffer.from('transfer').toString('hex');
    expect(committedModulePortIdHex(transfer)).toBe(transfer);
    expect(committedModulePortIdHex(`00${transfer}`)).toBe(transfer);
    expect(() => committedModulePortIdHex('00')).toThrow(/Invalid/);
    expect(() => committedModulePortIdHex('00ff')).toThrow(/Invalid/);
    expect(() => committedModulePortIdHex(Buffer.from('bad!').toString('hex'))).toThrow(/Invalid/);
  });

  it('prunes old consensus leaves and then deletes the final client leaves in validator order', () => {
    const clientState = Buffer.from('client-state');
    const latestConsensus = Buffer.from('latest-consensus');
    const oldConsensus = Buffer.from('old-consensus');
    const created = computeRootWithCreateClientUpdate(
      '0'.repeat(64),
      '07-tendermint-0',
      clientState,
      latestConsensus,
      10n,
    );
    created.commit();
    const addedOld = computeRootWithUpdateClientUpdate(created.newRoot, '07-tendermint-0', clientState, [], {
      height: 9n,
      value: oldConsensus,
    });
    addedOld.commit();

    const pruned = computeRootWithPruneTerminalClientUpdate(addedOld.newRoot, '07-tendermint-0', [
      { height: 9n, value: oldConsensus },
    ]);
    expect(pruned.removedConsensusStateSiblings).toHaveLength(1);
    pruned.commit();

    const reclaimed = computeRootWithReclaimClientUpdate(
      pruned.newRoot,
      '07-tendermint-0',
      clientState,
      10n,
      latestConsensus,
    );
    expect(reclaimed.clientStateSiblings).toHaveLength(64);
    expect(reclaimed.consensusStateSiblings).toHaveLength(64);
    expect(reclaimed.clientConnectionCountSiblings).toHaveLength(64);
    expect(reclaimed.newRoot).toBe('0'.repeat(64));
  });

  it('deletes a connection and decrements its authenticated client dependency count', () => {
    const client = computeRootWithCreateClientUpdate(
      '0'.repeat(64),
      '07-tendermint-0',
      Buffer.from('client'),
      Buffer.from('consensus'),
      10n,
    );
    client.commit();
    const connectionValue = Buffer.from('connection');
    const connection = computeRootWithCreateConnectionUpdate(
      client.newRoot,
      'connection-0',
      connectionValue,
      '07-tendermint-0',
    );
    connection.commit();

    const reclaimed = computeRootWithReclaimConnectionUpdate(
      connection.newRoot,
      'connection-0',
      connectionValue,
      '07-tendermint-0',
    );

    expect(reclaimed.clientConnectionCount).toBe(1n);
    expect(reclaimed.connectionSiblings).toHaveLength(64);
    expect(reclaimed.clientConnectionCountSiblings).toHaveLength(64);
  });

  it('retains Closed channel and nextSequenceRecv leaves while deleting send and ack', () => {
    const values = {
      channel: Buffer.from('closed-channel'),
      nextSequenceSend: Buffer.from([1]),
      nextSequenceRecv: Buffer.from([2]),
      nextSequenceAck: Buffer.from([3]),
    };
    const created = computeRootWithCreateChannelUpdate(
      '0'.repeat(64),
      'transfer',
      'channel-0',
      values.channel,
      values.nextSequenceSend,
      values.nextSequenceRecv,
      values.nextSequenceAck,
    );
    created.commit();

    const reclaimed = computeRootWithReclaimChannelUpdate(created.newRoot, 'transfer', 'channel-0', values, false);

    expect(reclaimed.channelSiblings).toEqual([]);
    expect(reclaimed.nextSequenceRecvSiblings).toEqual([]);
    expect(reclaimed.nextSequenceSendSiblings).toHaveLength(64);
    expect(reclaimed.nextSequenceAckSiblings).toHaveLength(64);
    expect(reclaimed.newRoot).not.toBe('0'.repeat(64));
  });

  it('deletes all four pre-open leaves for an abandoned channel', () => {
    const values = {
      channel: Buffer.from('init-channel'),
      nextSequenceSend: Buffer.from([1]),
      nextSequenceRecv: Buffer.from([1]),
      nextSequenceAck: Buffer.from([1]),
    };
    const created = computeRootWithCreateChannelUpdate(
      '0'.repeat(64),
      'transfer',
      'channel-0',
      values.channel,
      values.nextSequenceSend,
      values.nextSequenceRecv,
      values.nextSequenceAck,
    );
    created.commit();

    const reclaimed = computeRootWithReclaimChannelUpdate(created.newRoot, 'transfer', 'channel-0', values, true);

    expect(reclaimed.channelSiblings).toHaveLength(64);
    expect(reclaimed.nextSequenceRecvSiblings).toHaveLength(64);
    expect(reclaimed.newRoot).toBe('0'.repeat(64));
  });

  it('rejects deletion when a caller supplies bytes different from the committed value', () => {
    const created = computeRootWithCreateClientUpdate(
      '0'.repeat(64),
      '07-tendermint-0',
      Buffer.from('client'),
      Buffer.from('consensus'),
      10n,
    );
    created.commit();

    expect(() =>
      computeRootWithReclaimClientUpdate(
        created.newRoot,
        '07-tendermint-0',
        Buffer.from('wrong-client'),
        10n,
        Buffer.from('consensus'),
      ),
    ).toThrow(/expected the canonical committed value/i);
  });
});
