import * as Lucid from '@lucid-evolution/lucid';
import { LucidService } from './lucid.service';
import { ClientDatum, encodeClientDatum } from '../../types/client-datum';
import { ConsensusStateDatum, encodeConsensusStateDatum, consensusStateTokenName } from '../../types/consensus-state-datum';

const token = { policyId: '11'.repeat(28), name: 'aa' };
const height = (revisionHeight: bigint) => ({ revisionNumber: 0n, revisionHeight });
const consensus = { timestamp: 10n, next_validators_hash: '22'.repeat(32), root: { hash: '33'.repeat(32) } };
const record: ConsensusStateDatum = { clientToken: token, height: height(1n), consensusState: consensus, processedTime: 20n, processedHeight: 30n };
const archiveUnit = token.policyId + consensusStateTokenName(token, record.height, Lucid);

async function context() {
  const client: ClientDatum = {
    token,
    state: {
      clientState: { chainId: 'aa', trustLevel: { numerator: 1n, denominator: 3n }, trustingPeriod: 100n, unbondingPeriod: 200n, maxClockDrift: 10n, frozenHeight: height(0n), latestHeight: height(2n), proofSpecs: [] },
      consensusStates: new Map([[height(2n), consensus]]),
      processedTimes: new Map([[height(2n), 40n]]),
      processedHeights: new Map([[height(2n), 50n]]),
    },
  };
  const clientUtxo: Lucid.UTxO = { txHash: '01'.repeat(32), outputIndex: 0, address: 'client', assets: { [token.policyId + token.name]: 1n }, datum: await encodeClientDatum(client, Lucid) };
  const archive: Lucid.UTxO = { txHash: '02'.repeat(32), outputIndex: 0, address: 'history', assets: { [archiveUnit]: 1n }, datum: encodeConsensusStateDatum(record, Lucid) };
  const deployment: any = { validators: { mintClientStt: { scriptHash: token.policyId }, spendClient: { address: 'client' }, spendConsensusState: { address: 'history', scriptHash: '44'.repeat(28), refUtxo: { txHash: '03'.repeat(32), outputIndex: 0 } } } };
  const provider = { utxosAtWithUnit: jest.fn().mockResolvedValue([archive]), utxosAt: jest.fn().mockResolvedValue([archive]) };
  const service: LucidService = Object.assign(Object.create(LucidService.prototype), {
    LucidImporter: Lucid,
    lucid: provider,
    configService: { get: () => deployment },
    normalizeAddressOrCredential: (address: string) => address,
  });
  return { service, client, clientUtxo, archive, provider, deployment };
}

describe('Lucid authenticated consensus history', () => {
  it('resolves one old height without changing the actual client UTxO or datum bytes', async () => {
    const { service, clientUtxo, archive } = await context();
    const before = clientUtxo.datum;
    const resolved = await service.resolveClientAtHeights(clientUtxo, [height(1n), height(1n)]);
    expect(resolved.clientUtxo).toBe(clientUtxo);
    expect(clientUtxo.datum).toBe(before);
    expect(resolved.historyUtxos).toEqual([archive]);
    expect([...resolved.clientDatum.state.processedTimes.values()]).toEqual([40n, 20n]);
    expect([...resolved.clientDatum.state.processedHeights.values()]).toEqual([50n, 30n]);
    expect((await service.decodeDatum<ClientDatum>(before!, 'client')).state.consensusStates.size).toBe(1);
  });

  it('uses no archive inputs for a latest-height read', async () => {
    const { service, clientUtxo, provider } = await context();
    const result = await service.resolveClientAtHeights(clientUtxo, [height(2n)]);
    expect(result.historyUtxos).toEqual([]);
    expect(provider.utxosAtWithUnit).not.toHaveBeenCalled();
  });

  it.each(['address', 'token', 'client', 'height'] as const)('rejects an archive with the wrong %s', async (field) => {
    const { service, archive, provider } = await context();
    if (field === 'address') archive.address = 'other';
    if (field === 'token') archive.assets = { [archiveUnit]: 2n };
    if (field === 'client') archive.datum = encodeConsensusStateDatum({ ...record, clientToken: { ...token, name: 'bb' } }, Lucid);
    if (field === 'height') archive.datum = encodeConsensusStateDatum({ ...record, height: height(9n) }, Lucid);
    provider.utxosAtWithUnit.mockResolvedValue([archive]);
    await expect(service.findConsensusStateHistory(token, height(1n))).rejects.toThrow();
  });

  it('rejects duplicate records and fails closed if history is not deployed', async () => {
    const { service, archive, provider, deployment } = await context();
    provider.utxosAtWithUnit.mockResolvedValue([archive, { ...archive, outputIndex: 1 }]);
    await expect(service.findConsensusStateHistory(token, height(1n))).rejects.toThrow('Duplicate');
    delete deployment.validators.spendConsensusState;
    await expect(service.listConsensusStateHistory()).rejects.toThrow('not configured');
  });

  it('does not fabricate a missing or future historical state', async () => {
    const { service, clientUtxo, provider } = await context();
    provider.utxosAtWithUnit.mockResolvedValue([]);
    await expect(service.resolveClientAtHeights(clientUtxo, [height(1n)])).rejects.toThrow('not found');
    await expect(service.resolveClientAtHeights(clientUtxo, [height(3n)])).rejects.toThrow('not an archived');
  });
});

describe('Lucid consensus history transaction composition', () => {
  async function builderContext() {
    const ctx = await context();
    const builder: any = {};
    for (const method of ['readFrom', 'collectFrom', 'mintAssets', 'withdraw', 'addSignerKey']) {
      builder[method] = jest.fn().mockReturnValue(builder);
    }
    builder.pay = { ToContract: jest.fn().mockReturnValue(builder) };
    const refs = {
      hostStateStt: { txHash: 'host-script', outputIndex: 0 },
      spendClient: { txHash: 'client-script', outputIndex: 0 },
      mintClient: { txHash: 'mint-script', outputIndex: 0 },
      spendConsensusState: { txHash: 'history-script', outputIndex: 0 },
      recoverClient: { txHash: 'recovery-script', outputIndex: 0 },
    };
    Object.assign(ctx.service, { referenceScripts: refs, newTxBuilder: () => builder });
    Object.assign(ctx.deployment, { hostStateNFT: { policyId: '55'.repeat(28), name: 'aa' } });
    Object.assign(ctx.deployment.validators, { hostStateStt: { address: 'host' }, recoverClient: { address: 'recovery' } });
    const host: Lucid.UTxO = { txHash: '04'.repeat(32), outputIndex: 0, address: 'host', assets: {}, datum: 'd87980' };
    const archiveOutput = { tokenUnit: archiveUnit, encodedDatum: 'archive-datum', encodedMintRedeemer: 'archive-redeemer' };
    return { ...ctx, builder, refs, host, archiveOutput };
  }

  it('references the historical proof datum and mints exactly one immutable previous-tip output', async () => {
    const { service, builder, refs, host, clientUtxo, archive, archiveOutput } = await builderContext();
    service.createUnsignedUpdateClientTransaction(host, 'host-redeemer', clientUtxo, 'client-redeemer', 'new-host', 'new-client', token.policyId + token.name, 'funding', [archive], archiveOutput);
    expect(builder.readFrom).toHaveBeenCalledWith([refs.hostStateStt, refs.spendClient, archive]);
    expect(builder.readFrom).toHaveBeenCalledWith([refs.mintClient]);
    expect(builder.collectFrom).toHaveBeenNthCalledWith(2, [clientUtxo], 'client-redeemer');
    expect(builder.mintAssets).toHaveBeenCalledTimes(1);
    expect(builder.mintAssets).toHaveBeenCalledWith({ [archiveUnit]: 1n }, 'archive-redeemer');
    expect(builder.pay.ToContract).toHaveBeenLastCalledWith('history', { kind: 'inline', value: 'archive-datum' }, { [archiveUnit]: 1n });
  });

  it('archives the subject tip during recovery while keeping the substitute read-only', async () => {
    const { service, builder, refs, host, clientUtxo, archiveOutput } = await builderContext();
    const substitute = { ...clientUtxo, txHash: '06'.repeat(32) };
    service.createUnsignedRecoverClientTransaction(host, 'host-redeemer', clientUtxo, 'recover-redeemer', substitute, 'withdraw-redeemer', 'new-host', 'new-client', token.policyId + token.name, 'authority', archiveOutput);
    expect(builder.readFrom).toHaveBeenCalledWith([refs.hostStateStt, refs.spendClient, refs.recoverClient, substitute]);
    expect(builder.collectFrom.mock.calls.flatMap((call: any[]) => call[0])).not.toContain(substitute);
    expect(builder.mintAssets).toHaveBeenCalledWith({ [archiveUnit]: 1n }, 'archive-redeemer');
  });

  it('burns and consumes one archive, references the live client, and requires no authority signer', async () => {
    const { service, builder, refs, host, clientUtxo, archive } = await builderContext();
    service.createUnsignedPruneConsensusStateTransaction({
      hostStateUtxo: host, clientUtxo, historyUtxo: archive, historyTokenUnit: archiveUnit,
      encodedHostStateRedeemer: 'host-prune', encodedUpdatedHostStateDatum: 'new-host', encodedMintRedeemer: 'prune',
    });
    expect(builder.readFrom).toHaveBeenCalledWith([refs.hostStateStt, refs.spendConsensusState, refs.mintClient, clientUtxo]);
    expect(builder.collectFrom.mock.calls).toEqual([[[host], 'host-prune'], [[archive], Lucid.Data.void()]]);
    expect(builder.mintAssets).toHaveBeenCalledWith({ [archiveUnit]: -1n }, 'prune');
    expect(builder.pay.ToContract).toHaveBeenCalledTimes(1);
    expect(builder.addSignerKey).not.toHaveBeenCalled();
  });

  it('fails closed when a required pruning reference script is missing', async () => {
    const { service, refs, host, clientUtxo, archive } = await builderContext();
    refs.spendConsensusState = undefined as any;
    expect(() => service.createUnsignedPruneConsensusStateTransaction({ hostStateUtxo: host, clientUtxo, historyUtxo: archive, historyTokenUnit: archiveUnit, encodedHostStateRedeemer: '', encodedUpdatedHostStateDatum: '', encodedMintRedeemer: '' })).toThrow('scripts are unavailable');
  });
});
