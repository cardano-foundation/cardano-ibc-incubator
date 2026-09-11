import * as Lucid from '@lucid-evolution/lucid';
import { LucidService } from './lucid.service';
import { ClientDatum, encodeClientDatum } from '../../types/client-datum';
import { ConsensusHistoryWitness, ConsensusStateDatum } from '../../types/consensus-state-datum';

const token = { policyId: '11'.repeat(28), name: 'aa' };
const height = (revisionHeight: bigint) => ({ revisionNumber: 0n, revisionHeight });
const consensus = { timestamp: 10n, next_validators_hash: '22'.repeat(32), root: { hash: '33'.repeat(32) } };
const record: ConsensusStateDatum = { clientToken: token, height: height(1n), consensusState: consensus, processedTime: 20n, processedHeight: 30n };
const witness: ConsensusHistoryWitness = { record, siblings: Array(64).fill('00'.repeat(32)) };

async function context() {
  const client: ClientDatum = {
    token,
    history_root: '44'.repeat(32),
    state: {
      clientState: { chainId: 'aa', trustLevel: { numerator: 1n, denominator: 3n }, trustingPeriod: 100n, unbondingPeriod: 200n, maxClockDrift: 10n, frozenHeight: height(0n), latestHeight: height(2n), proofSpecs: [] },
      consensusStates: new Map([[height(2n), consensus]]),
      processedTimes: new Map([[height(2n), 40n]]),
      processedHeights: new Map([[height(2n), 50n]]),
    },
  };
  const clientUtxo: Lucid.UTxO = { txHash: '01'.repeat(32), outputIndex: 0, address: 'client', assets: { [token.policyId + token.name]: 1n }, datum: await encodeClientDatum(client, Lucid) };
  const deployment: any = { hostStateNFT: token, validators: { mintClientStt: { scriptHash: token.policyId }, spendClient: { address: 'client' }, hostStateStt: { address: 'host' }, recoverClient: { address: 'support' } } };
  const history = { witnesses: jest.fn().mockResolvedValue([witness]), insertion: jest.fn() };
  const service: LucidService = Object.assign(Object.create(LucidService.prototype), {
    LucidImporter: Lucid,
    configService: { get: () => deployment },
    consensusHistory: history,
    normalizeAddressOrCredential: (address: string) => address,
  });
  return { service, client, clientUtxo, history, deployment };
}

describe('Lucid proof-backed consensus history', () => {
  it('hydrates an old state once and returns its witness without changing the input bytes', async () => {
    const { service, clientUtxo, history } = await context();
    const before = clientUtxo.datum;
    const resolved = await service.resolveClientAtHeights(clientUtxo, [height(1n), height(1n)]);
    expect(resolved.clientUtxo).toBe(clientUtxo);
    expect(clientUtxo.datum).toBe(before);
    expect(resolved.historyWitnesses).toEqual([witness]);
    expect(history.witnesses).toHaveBeenCalledTimes(1);
    expect(history.witnesses.mock.calls[0][3]).toEqual([height(1n)]);
    expect([...resolved.clientDatum.state.processedTimes.values()]).toEqual([40n, 20n]);
    expect([...resolved.clientDatum.state.processedHeights.values()]).toEqual([50n, 30n]);
    expect((await service.decodeDatum<ClientDatum>(before!, 'client')).state.consensusStates.size).toBe(1);
  });

  it('does not load history for the latest height', async () => {
    const { service, clientUtxo, history } = await context();
    expect((await service.resolveClientAtHeights(clientUtxo, [height(2n)])).historyWitnesses).toEqual([]);
    expect(history.witnesses).not.toHaveBeenCalled();
  });

  it.each(['address', 'token'] as const)('rejects a client with the wrong %s before querying history', async (field) => {
    const { service, clientUtxo, history } = await context();
    if (field === 'address') clientUtxo.address = 'other';
    else clientUtxo.assets = {};
    await expect(service.resolveClientAtHeights(clientUtxo, [height(1n)])).rejects.toThrow('authentication failed');
    expect(history.witnesses).not.toHaveBeenCalled();
  });

  it('fails closed for missing history, future heights, or an unavailable history service', async () => {
    const { service, clientUtxo, history } = await context();
    history.witnesses.mockRejectedValue(new Error('historical record not found'));
    await expect(service.resolveClientAtHeights(clientUtxo, [height(1n)])).rejects.toThrow('not found');
    await expect(service.resolveClientAtHeights(clientUtxo, [height(3n)])).rejects.toThrow('not an archived');
    Object.assign(service, { consensusHistory: undefined });
    await expect(service.resolveClientAtHeights(clientUtxo, [height(1n)])).rejects.toThrow('unavailable');
  });

  it('updates only the HostState and client outputs and invokes the bound support script', async () => {
    const { service, clientUtxo } = await context();
    const builder: any = {};
    for (const method of ['readFrom', 'collectFrom', 'mintAssets', 'withdraw', 'addSignerKey']) builder[method] = jest.fn().mockReturnValue(builder);
    builder.pay = { ToContract: jest.fn().mockReturnValue(builder) };
    const refs = { hostStateStt: clientUtxo, spendClient: clientUtxo, recoverClient: clientUtxo };
    Object.assign(service, { referenceScripts: refs, newTxBuilder: () => builder });
    service.createUnsignedUpdateClientTransaction(clientUtxo, 'host', clientUtxo, 'spend', 'new-host', 'new-client', token.policyId + token.name, 'funding', 'history-proof');
    expect(builder.readFrom).toHaveBeenCalledWith([refs.hostStateStt, refs.spendClient, refs.recoverClient]);
    expect(builder.withdraw).toHaveBeenCalledWith('support', 0n, 'history-proof');
    expect(builder.mintAssets).not.toHaveBeenCalled();
    expect(builder.pay.ToContract).toHaveBeenCalledTimes(2);
    expect(builder.addSignerKey).not.toHaveBeenCalled();

    builder.pay.ToContract.mockClear();
    const substitute = { ...clientUtxo, txHash: '66'.repeat(32) };
    service.createUnsignedRecoverClientTransaction(clientUtxo, 'host', clientUtxo, 'spend', substitute, 'recover', 'new-host', 'new-client', token.policyId + token.name, 'authority');
    expect(builder.readFrom).toHaveBeenLastCalledWith([refs.hostStateStt, refs.spendClient, refs.recoverClient, substitute]);
    expect(builder.collectFrom.mock.calls.flatMap((args: any[]) => args[0])).not.toContain(substitute);
    expect(builder.mintAssets).not.toHaveBeenCalled();
    expect(builder.pay.ToContract).toHaveBeenCalledTimes(2);
    expect(builder.addSignerKey).toHaveBeenCalledWith('authority');
  });
});
