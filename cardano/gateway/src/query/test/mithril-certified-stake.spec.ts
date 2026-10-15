import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { CardanoStakeDistributionDTO } from '@shared/modules/mithril/dtos/get-cardano-stake-distribution.dto';
import {
  loadMithrilStakeCertificates,
  MithrilStakeMismatchError,
  MithrilStakeSource,
  requireMithrilStakeAgreement,
  stakeTableDifference,
} from '../services/mithril-certified-stake';

const PARAMETERS = 'cd'.repeat(32);

// The certificate sealed in `epoch` certifies epoch-1's stake. Epoch e is
// signed by key-e and names key-(e+1).
function certificate(epoch: number, stakeEpoch = epoch - 1): string {
  return JSON.stringify({
    epoch,
    aggregate_verification_key: `key-${epoch}`,
    protocol_message: {
      message_parts: {
        current_epoch: String(epoch),
        cardano_stake_distribution_epoch: String(stakeEpoch),
        cardano_stake_distribution_merkle_root: 'ab'.repeat(32),
        next_aggregate_verification_key: `key-${epoch + 1}`,
        next_protocol_parameters: PARAMETERS,
      },
    },
  });
}

function source(
  distributions: Record<number, Record<string, number>>,
  certificates: Record<string, string> = {},
): MithrilStakeSource & { getCertificateJsonByHash: jest.Mock } {
  return {
    getCardanoStakeDistributionByEpoch: jest.fn(async (epoch: number) =>
      distributions[epoch]
        ? ({
            epoch,
            hash: `artifact-${epoch}`,
            certificate_hash: `certificate-${epoch}`,
            stake_distribution: distributions[epoch],
            created_at: '',
          } as CardanoStakeDistributionDTO)
        : undefined,
    ),
    getCertificateJsonByHash: jest.fn(
      async (hash: string) => certificates[hash] ?? certificate(Number(hash.split('-')[1]) + 1),
    ),
  };
}

const table = [
  { pool_id: 'pool1a', stake: 300n },
  { pool_id: 'pool1b', stake: 700n },
];
const stake = { pool1a: 300, pool1b: 700 };

describe('Mithril-certified stake', () => {
  it('returns consecutive certificates from the anchor epoch', async () => {
    const mithril = source({ 8: stake, 9: stake, 11: stake });
    const certificates = await loadMithrilStakeCertificates(mithril, 9);
    expect(certificates.map((json) => JSON.parse(json).epoch)).toEqual([9, 10]);
    // Epoch 10's stake is not certified yet, so nothing extends an anchor at 11.
    await expect(loadMithrilStakeCertificates(mithril, 11)).resolves.toEqual([]);
    expect(await loadMithrilStakeCertificates(source({ 8: stake, 9: stake, 10: stake }), 9, 2)).toHaveLength(2);
  });

  it('stops at a certificate its predecessor did not hand over to', async () => {
    const forked = JSON.parse(certificate(10));
    forked.aggregate_verification_key = 'key-other';
    const mithril = source({ 8: stake, 9: stake }, { 'certificate-9': JSON.stringify(forked) });
    await expect(loadMithrilStakeCertificates(mithril, 9)).rejects.toThrow('not signed by the key');
  });

  it('checks a proposed table only once Mithril certifies its epoch', async () => {
    await expect(requireMithrilStakeAgreement(source({}), 9, table)).resolves.toBe(false);
    await expect(requireMithrilStakeAgreement(source({ 7: stake }), 9, table)).resolves.toBe(true);
    await expect(requireMithrilStakeAgreement(source({ 7: { pool1a: 301, pool1b: 700 } }), 9, table)).rejects.toThrow(
      MithrilStakeMismatchError,
    );
  });

  it('describes every way a table can differ', () => {
    expect(stakeTableDifference(table, stake)).toBeUndefined();
    expect(stakeTableDifference(table, { pool1a: 300 })).toContain('pool1b has 700 but Mithril certified no stake');
    expect(stakeTableDifference(table, { ...stake, pool1c: 1 })).toContain('pool1c is missing');
    expect(stakeTableDifference(table, { pool1a: 300, pool1b: 2 ** 53 })).toContain('not a positive safe integer');
  });

  it('extends an anchor with real mainnet certificates', async () => {
    const fixture = (name: string) =>
      gunzipSync(
        readFileSync(
          resolve(__dirname, '../../../../../cosmos/cardano-probabilistic-light-client-core/testdata/mithril', name),
        ),
      ).toString('utf8');
    const epoch660 = fixture('mainnet-epoch-660-certificate.json.gz');
    const epoch661 = fixture('mainnet-epoch-661-certificate.json.gz');
    const distribution659: CardanoStakeDistributionDTO = JSON.parse(fixture('mainnet-stake-distribution-659.json.gz'));
    const mithril: MithrilStakeSource = {
      getCardanoStakeDistributionByEpoch: async (epoch) =>
        epoch === 659
          ? distribution659
          : epoch === 660
            ? { ...distribution659, epoch: 660, certificate_hash: JSON.parse(epoch661).hash }
            : undefined,
      getCertificateJsonByHash: async (hash) => (hash === distribution659.certificate_hash ? epoch660 : epoch661),
    };
    // Epoch 660 names the key that signs epoch 661's certificate.
    expect(JSON.parse(epoch660).protocol_message.message_parts.next_aggregate_verification_key).toBe(
      JSON.parse(epoch661).aggregate_verification_key,
    );
    expect(await loadMithrilStakeCertificates(mithril, 661)).toEqual([epoch661]);
    expect(await loadMithrilStakeCertificates(mithril, 660)).toEqual([epoch660, epoch661]);
  });
});
