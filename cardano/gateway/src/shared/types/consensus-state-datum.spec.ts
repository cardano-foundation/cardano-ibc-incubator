import * as Lucid from '@lucid-evolution/lucid';
import { consensusStateTokenName, decodeConsensusStateDatum, encodeConsensusStateDatum } from './consensus-state-datum';
import { decodeMintClientRedeemer, encodeMintClientRedeemer } from './client-redeemer';
import { LucidService } from '../modules/lucid/lucid.service';

const clientToken = { policyId: '11'.repeat(28), name: 'aa' };
const height = { revisionNumber: 0n, revisionHeight: 1n };

describe('authenticated consensus-state encoding', () => {
  it('matches the Aiken serialise_data key SHA3-256 cross-language vector', () => {
    const vectorToken = { ...clientToken, name: '22' };
    const key = new Lucid.Constr(0, [
      new Lucid.Constr(0, [vectorToken.policyId, vectorToken.name]),
      new Lucid.Constr(0, [0n, 1n]),
    ]);
    expect(Lucid.Data.to<Lucid.Data>(key, undefined, { canonical: false })).toBe(
      'd8799fd8799f581c' + '11'.repeat(28) + '4122ffd8799f0001ffff',
    );
    expect(consensusStateTokenName(vectorToken, height, Lucid)).toBe(
      '8a9809d798ed7117cb8269bda61fb07c0cbe54b62eb0ed59ef6175b5c55dc99c',
    );
    expect(consensusStateTokenName(clientToken, { ...height, revisionNumber: 1n }, Lucid)).not.toBe(
      consensusStateTokenName(clientToken, height, Lucid),
    );
    expect(consensusStateTokenName({ ...clientToken, name: 'bb' }, height, Lucid)).not.toBe(
      consensusStateTokenName(clientToken, height, Lucid),
    );
  });

  it('round trips the immutable record including processed metadata', () => {
    const record = { clientToken, height, consensusState: { timestamp: 7n, next_validators_hash: 'cc', root: { hash: 'dd' } }, processedTime: 8n, processedHeight: 9n };
    const encoded = encodeConsensusStateDatum(record, Lucid);
    expect(encoded).toBe('d87985d87982581c' + '11'.repeat(28) + '41aad879820001d879830741ccd8798141dd0809');
    expect(decodeConsensusStateDatum(encoded, Lucid)).toEqual(record);
  });

  it('preserves mint constructor zero and appends archive and prune', async () => {
    expect(await encodeMintClientRedeemer('MintClient', Lucid)).toBe('d87980');
    const archive = { ArchiveConsensusState: { client_token: clientToken } };
    const prune = { PruneConsensusState: { client_token: clientToken, height } };
    const encodedArchive = await encodeMintClientRedeemer(archive, Lucid);
    const encodedPrune = await encodeMintClientRedeemer(prune, Lucid);
    expect(encodedArchive.startsWith('d87a81d87982')).toBe(true);
    expect(encodedPrune.startsWith('d87b82d87982')).toBe(true);
    expect(decodeMintClientRedeemer(encodedArchive, Lucid)).toEqual(archive);
    expect(decodeMintClientRedeemer(encodedPrune, Lucid)).toEqual(prune);
  });

  it('appends HostState pruning at constructor eleven', async () => {
    const service: LucidService = Object.assign(Object.create(LucidService.prototype), { LucidImporter: Lucid });
    const encoded = await service.encode({ PruneConsensusState: { client_token: clientToken, height, consensus_state_siblings: [] } }, 'host_state_redeemer');
    expect(encoded.startsWith('d9050483')).toBe(true);
    expect((Lucid.Data.from(encoded) as Lucid.Constr<Lucid.Data>).index).toBe(11);
  });
});
