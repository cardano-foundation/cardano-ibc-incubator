import * as Lucid from '@lucid-evolution/lucid';
import { decodeConsensusStateDatum, encodeConsensusStateDatum } from './consensus-state-datum';
import { decodeMintClientRedeemer, encodeMintClientRedeemer } from './client-redeemer';
import { LucidService } from '../modules/lucid/lucid.service';

const clientToken = { policyId: '11'.repeat(28), name: 'aa' };
const height = { revisionNumber: 0n, revisionHeight: 1n };

describe('authenticated consensus-state encoding', () => {
  it('round trips the immutable record including processed metadata', () => {
    const record = { clientToken, height, consensusState: { timestamp: 7n, next_validators_hash: 'cc', root: { hash: 'dd' } }, processedTime: 8n, processedHeight: 9n };
    const encoded = encodeConsensusStateDatum(record, Lucid);
    expect(encoded).toBe('d87985d87982581c' + '11'.repeat(28) + '41aad879820001d879830741ccd8798141dd0809');
    expect(decodeConsensusStateDatum(encoded, Lucid)).toEqual(record);
  });

  it('allows only creation in the client mint policy', async () => {
    expect(await encodeMintClientRedeemer('MintClient', Lucid)).toBe('d87980');
    expect(decodeMintClientRedeemer('d87980', Lucid)).toBe('MintClient');
    expect(() => decodeMintClientRedeemer('d87a80', Lucid)).toThrow();
  });

  it('encodes two public-root witnesses for HostState updates', async () => {
    const service: LucidService = Object.assign(Object.create(LucidService.prototype), { LucidImporter: Lucid });
    const encoded = await service.encode({ UpdateClient: { client_state_siblings: [], consensus_state_siblings: [] } }, 'host_state_redeemer');
    const data = Lucid.Data.from(encoded) as Lucid.Constr<Lucid.Data>;
    expect(data.index).toBe(4);
    expect(data.fields).toEqual([[], []]);
    await expect(service.encode({ PruneConsensusState: {} }, 'host_state_redeemer')).rejects.toThrow();
  });
});
