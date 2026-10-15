import { CardanoStakeDistributionDTO } from '@shared/modules/mithril/dtos/get-cardano-stake-distribution.dto';

// Mithril certifies the Cardano stake distribution of epoch N during epoch
// N+1. That distribution elects the leaders of epoch N+2. A certified
// distribution outranks an uploaded stake table, and the response window
// covers epochs Mithril has not certified.
export const MITHRIL_STAKE_CERTIFICATES_TYPE_URL = '/ibc.lightclients.probabilistic.v1.MithrilStakeCertificates';
// Mainnet certificates are about 105 KiB, so four keep an update well inside
// transaction limits. The light client accepts up to eight.
const MAX_MITHRIL_STAKE_CERTIFICATES_PER_UPDATE = 4;

export interface MithrilStakeSource {
  getCardanoStakeDistributionByEpoch(epoch: number): Promise<CardanoStakeDistributionDTO | undefined>;
  getCertificateJsonByHash(hash: string): Promise<string>;
}

type StakeTable = ReadonlyArray<{ pool_id: string; stake: bigint }>;

type StakeCertificate = {
  json: string;
  aggregateVerificationKey: string;
  nextAggregateVerificationKey: string;
};

const HASH = /^[0-9a-f]{64}$/;

// A stake table that disagrees with Mithril's certified distribution.
export class MithrilStakeMismatchError extends Error {}

// The certificate's signed parts only. Everything else in it is unsigned.
function parseStakeCertificate(json: string, stakeEpoch: number): StakeCertificate {
  const certificate = JSON.parse(json);
  const parts = certificate?.protocol_message?.message_parts;
  if (
    !parts ||
    parts.cardano_stake_distribution_epoch !== String(stakeEpoch) ||
    parts.current_epoch !== String(stakeEpoch + 1)
  ) {
    throw new Error(`Mithril certificate does not certify the epoch ${stakeEpoch} Cardano stake distribution`);
  }
  if (
    !HASH.test(parts.cardano_stake_distribution_merkle_root ?? '') ||
    !HASH.test(parts.next_protocol_parameters ?? '') ||
    typeof parts.next_aggregate_verification_key !== 'string' ||
    !parts.next_aggregate_verification_key ||
    typeof certificate.aggregate_verification_key !== 'string'
  ) {
    throw new Error(`Mithril certificate for the epoch ${stakeEpoch} stake distribution is malformed`);
  }
  return {
    json,
    aggregateVerificationKey: certificate.aggregate_verification_key,
    nextAggregateVerificationKey: parts.next_aggregate_verification_key,
  };
}

async function stakeCertificate(source: MithrilStakeSource, stakeEpoch: number): Promise<StakeCertificate | undefined> {
  if (!Number.isSafeInteger(stakeEpoch) || stakeEpoch < 0) return undefined;
  const distribution = await source.getCardanoStakeDistributionByEpoch(stakeEpoch);
  if (!distribution) return undefined;
  if (distribution.epoch !== stakeEpoch || typeof distribution.certificate_hash !== 'string') {
    throw new Error(`Mithril returned another artifact for the epoch ${stakeEpoch} stake distribution`);
  }
  const json = await source.getCertificateJsonByHash(distribution.certificate_hash);
  return parseStakeCertificate(json, stakeEpoch);
}

// Describes how a stake table differs from Mithril's distribution, or returns
// undefined when they hold the same pools and stakes.
export function stakeTableDifference(
  table: StakeTable,
  certified: CardanoStakeDistributionDTO['stake_distribution'],
): string | undefined {
  const certifiedStake = new Map<string, bigint>();
  for (const [poolId, stake] of Object.entries(certified ?? {})) {
    if (!Number.isSafeInteger(stake) || stake <= 0) {
      return `Mithril stake for ${poolId} is not a positive safe integer`;
    }
    certifiedStake.set(poolId, BigInt(stake));
  }
  const differing: string[] = [];
  const seen = new Set<string>();
  for (const entry of table) {
    seen.add(entry.pool_id);
    const stake = certifiedStake.get(entry.pool_id);
    if (stake !== entry.stake) {
      differing.push(`${entry.pool_id} has ${entry.stake} but Mithril certified ${stake ?? 'no stake'}`);
    }
  }
  for (const poolId of certifiedStake.keys()) {
    if (!seen.has(poolId)) differing.push(`${poolId} is missing`);
  }
  if (!differing.length) return undefined;
  return `${differing.length} pools differ, first ${differing[0]}`;
}

// Certificates that extend an anchor at mithrilEpoch, in epoch order. Each
// certifies the stake that Mithril sealed in its epoch, and each next one must
// be signed by the key its predecessor names.
export async function loadMithrilStakeCertificates(
  source: MithrilStakeSource,
  mithrilEpoch: number,
  limit = MAX_MITHRIL_STAKE_CERTIFICATES_PER_UPDATE,
): Promise<string[]> {
  const certificates: StakeCertificate[] = [];
  for (let epoch = mithrilEpoch; certificates.length < limit; epoch += 1) {
    const certificate = await stakeCertificate(source, epoch - 1);
    if (!certificate) break;
    const previous = certificates[certificates.length - 1];
    if (previous && previous.nextAggregateVerificationKey !== certificate.aggregateVerificationKey) {
      throw new Error(`Mithril's epoch ${epoch} certificate is not signed by the key its predecessor names`);
    }
    certificates.push(certificate);
  }
  return certificates.map((certificate) => certificate.json);
}

// Rejects a table for leaderEpoch that differs from the distribution Mithril
// certified for it. Returns false when Mithril has not certified it yet.
export async function requireMithrilStakeAgreement(
  source: MithrilStakeSource,
  leaderEpoch: number,
  table: StakeTable,
): Promise<boolean> {
  if (!Number.isSafeInteger(leaderEpoch) || leaderEpoch < 2) return false;
  const distribution = await source.getCardanoStakeDistributionByEpoch(leaderEpoch - 2);
  if (!distribution) return false;
  const difference = stakeTableDifference(table, distribution.stake_distribution);
  if (difference) {
    throw new MithrilStakeMismatchError(
      `The epoch ${leaderEpoch} stake table differs from Mithril's certified epoch ${leaderEpoch - 2} distribution: ${difference}`,
    );
  }
  return true;
}
