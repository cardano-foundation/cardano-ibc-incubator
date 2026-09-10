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
    history_root: '00'.repeat(32),
    token,
    state: {
      clientState: { chainId: 'aa', trustLevel: { numerator: 1n, denominator: 3n }, trustingPeriod: 100n, unbondingPeriod: 200n, maxClockDrift: 10n, frozenHeight: height(0n), latestHeight: height(2n), proofSpecs: [] },
      consensusStates: new Map([[height(2n), tipConsensus]]),
      processedTimes: new Map([[height(2n), 320n]]),
      processedHeights: new Map([[height(2n), 30n]]),
    },
  };
  const clientUtxo = { txHash: '11'.repeat(32), outputIndex: 0, datum: 'client', address: 'client', assets: { [token.policyId + token.name]: 1n } };
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
    prepareConsensusHistoryUpdate: jest.fn().mockResolvedValue({ newRoot: '66'.repeat(32), siblings: Array(64).fill('00'.repeat(32)) }),
    getClientTokenUnit: jest.fn().mockReturnValue('client-unit'),
    findUtxoByUnit: jest.fn().mockResolvedValue(clientUtxo),
    resolveClientAtHeights: jest.fn().mockResolvedValue({ clientUtxo, clientDatum: client, historyWitnesses: [] }),
    findUtxoAtHostStateNFT: jest.fn().mockResolvedValue(hostStateUtxo),
    decodeDatum: jest.fn().mockResolvedValue(hostState),
    encode: jest.fn().mockImplementation((_value, type) => Promise.resolve(`encoded-${type}`)),
    createUnsignedUpdateClientTransaction: jest.fn().mockReturnValue({}),
  };
  const service: ClientService = Object.assign(Object.create(ClientService.prototype), { lucidService: lucid, ibcTreeStore: treeContext.store });
  return { service, lucid, client, clientUtxo, tree, treeContext };
}

describe('ClientService consensus history transitions', () => {
  it('commits the previous tip in the private root and retains all public consensus leaves', async () => {
    const { service, lucid, client, clientUtxo, tree } = await context();
    await service.buildUnsignedUpdateClientTx({
      clientId: '0', clientDatum: client, clientTokenUnit: 'client-unit', currentClientUtxo: clientUtxo,
      constructedAddress: 'funding-address', txValidFrom: 350n,
      header: { trustedHeight: height(2n), signedHeader: { header: { height: 3n, time: 360n, nextValidatorsHash: '44'.repeat(32), appHash: '55'.repeat(32) } } } as any,
    });
    const output = lucid.encode.mock.calls.find(([, type]) => type === 'client')![0] as ClientDatum;
    expect([...output.state.consensusStates.keys()]).toEqual([height(3n)]);
    expect([...output.state.processedTimes.values()]).toEqual([350n]);
    expect(output.history_root).toBe('66'.repeat(32));
    const spend = lucid.encode.mock.calls.find(([, type]) => type === 'spendClientRedeemer')![0] as any;
    expect(spend.UpdateClient.history_siblings).toHaveLength(64);
    expect(spend.UpdateClient.history_witnesses).toEqual([]);
    const host = lucid.encode.mock.calls.find(([, type]) => type === 'host_state_redeemer')![0] as any;
    expect(Object.keys(host.UpdateClient).sort()).toEqual(['client_state_siblings', 'consensus_state_siblings']);
    expect(lucid.encode).toHaveBeenCalledWith({ CheckClientHistory: { subject_token: token } }, 'recoverClientWithdrawalRedeemer');
    expect(tree.get('clients/07-tendermint-0/consensusStates/1')).toBeDefined();
  });

});
