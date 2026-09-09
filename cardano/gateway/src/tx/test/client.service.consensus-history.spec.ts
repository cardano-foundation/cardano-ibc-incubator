import * as Lucid from '@lucid-evolution/lucid';
import { ClientService } from '../client.service';
import { ClientDatum, encodeConsensusStateValue } from '../../shared/types/client-datum';
import { ICS23MerkleTree } from '../../shared/helpers/ics23-merkle-tree';
import { createTestTreeContext } from '../../shared/testing/ibc-tree-test-store';

const height = (revisionHeight: bigint) => ({ revisionNumber: 0n, revisionHeight });
const token = { policyId: '11'.repeat(28), name: 'aa' };
const oldConsensus = { timestamp: 10n, next_validators_hash: '22'.repeat(32), root: { hash: '33'.repeat(32) } };

async function context() {
  const tipConsensus = { ...oldConsensus, timestamp: 300n };
  const client: ClientDatum = {
    token,
    state: {
      clientState: { chainId: 'aa', trustLevel: { numerator: 1n, denominator: 3n }, trustingPeriod: 100n, unbondingPeriod: 200n, maxClockDrift: 10n, frozenHeight: height(0n), latestHeight: height(2n), proofSpecs: [] },
      consensusStates: new Map([[height(2n), tipConsensus]]),
      processedTimes: new Map([[height(2n), 320n]]),
      processedHeights: new Map([[height(2n), 30n]]),
    },
  };
  const clientUtxo = { txHash: '11'.repeat(32), outputIndex: 0, datum: 'client', address: 'client', assets: { [token.policyId + token.name]: 1n } };
  const history = { clientToken: token, height: height(1n), consensusState: oldConsensus, processedTime: 20n, processedHeight: 3n };
  const historyUtxo = { txHash: '22'.repeat(32), outputIndex: 0, datum: 'history', address: 'history', assets: { archive: 1n } };
  const tree = new ICS23MerkleTree();
  tree.set('clients/07-tendermint-0/clientState', Buffer.from('client'));
  tree.set('clients/07-tendermint-0/consensusStates/1', Buffer.from(await encodeConsensusStateValue(oldConsensus, Lucid), 'hex'));
  tree.set('clients/07-tendermint-0/consensusStates/2', Buffer.from(await encodeConsensusStateValue(tipConsensus, Lucid), 'hex'));
  const hostStateUtxo = { txHash: '33'.repeat(32), outputIndex: 0, datum: 'host', address: 'host', assets: {} };
  const hostState = { state: { version: 1n, ibc_state_root: tree.getRoot() } };
  const treeContext = createTestTreeContext();
  await treeContext.restore(tree, hostStateUtxo);
  const lucid = {
    LucidImporter: Lucid,
    getConsensusStateAddress: jest.fn().mockReturnValue('history'),
    getConsensusStateTokenUnit: jest.fn().mockReturnValue('archive-unit'),
    getClientTokenUnit: jest.fn().mockReturnValue('client-unit'),
    findUtxoByUnit: jest.fn().mockResolvedValue(clientUtxo),
    resolveClientAtHeights: jest.fn().mockResolvedValue({ clientUtxo, clientDatum: client, historyUtxos: [] }),
    findConsensusStateHistory: jest.fn().mockResolvedValue({ utxo: historyUtxo, datum: history }),
    findUtxoAtHostStateNFT: jest.fn().mockResolvedValue(hostStateUtxo),
    decodeDatum: jest.fn().mockResolvedValue(hostState),
    encode: jest.fn().mockImplementation((_value, type) => Promise.resolve(`encoded-${type}`)),
    createUnsignedPruneConsensusStateTransaction: jest.fn().mockReturnValue({}),
    createUnsignedUpdateClientTransaction: jest.fn().mockReturnValue({}),
  };
  const service: ClientService = Object.assign(Object.create(ClientService.prototype), { lucidService: lucid, ibcTreeStore: treeContext.store });
  const operator = { clientId: '0', constructedAddress: 'funding-address', height: height(1n) };
  return { service, lucid, client, clientUtxo, history, historyUtxo, tree, treeContext, operator };
}

describe('ClientService consensus history transitions', () => {
  it('archives the previous tip and leaves expired historical commitment leaves intact on update', async () => {
    const { service, lucid, client, clientUtxo, tree } = await context();
    await service.buildUnsignedUpdateClientTx({
      clientId: '0', clientDatum: client, clientTokenUnit: 'client-unit', currentClientUtxo: clientUtxo,
      constructedAddress: 'funding-address', txValidFrom: 350n,
      header: { trustedHeight: height(2n), signedHeader: { header: { height: 3n, time: 360n, nextValidatorsHash: '44'.repeat(32), appHash: '55'.repeat(32) } } } as any,
    });
    const output = lucid.encode.mock.calls.find(([, type]) => type === 'client')![0] as ClientDatum;
    expect([...output.state.consensusStates.keys()]).toEqual([height(3n)]);
    expect([...output.state.processedTimes.values()]).toEqual([350n]);
    expect(lucid.encode).toHaveBeenCalledWith(expect.objectContaining({ clientToken: token, height: height(2n), processedTime: 320n, processedHeight: 30n }), 'consensusState');
    const hostRedeemer = lucid.encode.mock.calls.find(([, type]) => type === 'host_state_redeemer')![0] as any;
    expect(hostRedeemer.UpdateClient.removed_consensus_state_siblings).toEqual([]);
    expect(lucid.createUnsignedUpdateClientTransaction.mock.calls[0].at(-1)).toEqual({ tokenUnit: 'archive-unit', encodedDatum: 'encoded-consensusState', encodedMintRedeemer: 'encoded-mintClientRedeemer' });
    expect(tree.get('clients/07-tendermint-0/consensusStates/1')).toBeDefined();
  });

  it('prunes exactly one expired archive at the expiry boundary without spending the client', async () => {
    const { service, lucid, clientUtxo, historyUtxo, tree, treeContext, operator } = await context();
    const result = await service.buildUnsignedPruneConsensusStateTx(operator, 110n);
    const expected = tree.clone();
    expected.set('clients/07-tendermint-0/consensusStates/1', Buffer.alloc(0));
    expect(result.pendingTreeUpdate.expectedNewRoot).toBe(expected.getRoot());
    expect(treeContext.store.getCurrentRoot()).toBe(tree.getRoot());
    expect(lucid.createUnsignedPruneConsensusStateTransaction).toHaveBeenCalledWith(expect.objectContaining({ clientUtxo, historyUtxo, historyTokenUnit: 'archive-unit' }));
    expect(lucid.encode).toHaveBeenCalledWith({ PruneConsensusState: { client_token: token, height: height(1n) } }, 'mintClientRedeemer');
    const redeemer = lucid.encode.mock.calls.find(([, type]) => type === 'host_state_redeemer')![0] as any;
    expect(redeemer.PruneConsensusState.consensus_state_siblings).toHaveLength(64);
  });

  it('rejects unexpired, latest, and wrong-client records', async () => {
    const { service, lucid, history, operator } = await context();
    await expect(service.buildUnsignedPruneConsensusStateTx(operator, 109n)).rejects.toThrow('not expired');
    await expect(service.buildUnsignedPruneConsensusStateTx({ ...operator, height: height(2n) }, 500n)).rejects.toThrow('below the latest');
    history.clientToken = { ...token, name: 'bb' };
    await expect(service.buildUnsignedPruneConsensusStateTx(operator, 500n)).rejects.toThrow('does not belong');
    expect(lucid.createUnsignedPruneConsensusStateTransaction).not.toHaveBeenCalled();
  });
});
