export class CardanoStakeDistributionDTO {
  epoch: number;
  hash: string;
  certificate_hash: string;
  // Lovelace by bech32 pool ID.
  stake_distribution: Record<string, number>;
  created_at: string;
}
