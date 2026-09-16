import { verifyHistoryCoverage } from './history-coverage';
import type { BridgeManifest } from './bridge-manifest';

type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: any[] }> };

/** Caller holds a read-only repeatable snapshot. Input and contract fields are preserved. */
export async function upgradeHistoryArtifact(
  db: Database,
  original: Record<string, any>,
  fallbackIdentity?: { network_magic: number; chain_id?: string },
): Promise<Record<string, any>> {
  const artifact = structuredClone(original);
  const cardano = artifact.cardano ?? fallbackIdentity;
  if (!cardano || ![1, 2, 764824073].includes(cardano.network_magic))
    throw new Error('Set CARDANO_CHAIN_NETWORK_MAGIC for a public-network handler');
  const token = artifact.host_state_nft ?? {
    policy_id: artifact.hostStateNFT?.policyId,
    token_name: artifact.hostStateNFT?.name,
  };
  if (!/^[0-9a-f]{56}$/.test(token.policy_id) || !/^(?:[0-9a-f]{2}){0,32}$/.test(token.token_name))
    throw new Error('Invalid HostState NFT');
  const anchor = (
    await db.query(
      `
      SELECT a.tx_hash, a.output_index, t.block, b.epoch
      FROM address_utxo a JOIN transaction t ON t.tx_hash=a.tx_hash AND t.block=a.block
      JOIN block b ON b.number=t.block AND b.hash=t.block_hash
      WHERE t.invalid=false AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.amounts) asset WHERE asset->>'unit'=$1 AND asset->>'quantity'='1')
      ORDER BY t.block, t.tx_index, a.output_index LIMIT 1
    `,
      [token.policy_id + token.token_name],
    )
  ).rows[0];
  if (!anchor) throw new Error('HostState creation history unavailable; restore history before upgrading the manifest');
  // Normalize only output references. Preserve all existing contract fields.
  const refs = (v: any): any =>
    !v || typeof v !== 'object'
      ? v
      : Object.fromEntries(
          Object.entries(v).map(([key, value]: [string, any]) =>
            key === 'refUtxo'
              ? ['ref_utxo', { tx_hash: value.txHash, output_index: value.outputIndex }]
              : [key, refs(value)],
          ),
        );
  const validators = refs(artifact.validators);
  const txs = new Set<string>([anchor.tx_hash]);
  const collect = (v: any) => {
    if (!v || typeof v !== 'object') return;
    if (v.ref_utxo) txs.add(v.ref_utxo.tx_hash);
    Object.values(v).forEach(collect);
  };
  collect(validators);
  const earliest = (
    await db.query(
      'SELECT MIN(b.epoch) AS epoch, COUNT(DISTINCT t.tx_hash)::int AS count FROM transaction t JOIN block b ON b.number=t.block AND b.hash=t.block_hash WHERE t.tx_hash=ANY($1) AND t.invalid=false',
      [[...txs]],
    )
  ).rows[0];
  if (earliest.count !== txs.size) throw new Error('Deployment reference transaction history is incomplete');
  const start = (
    await db.query(
      'SELECT slot, hash AS block_hash, number AS block_height FROM block WHERE epoch <= $1 AND number < $2 ORDER BY number DESC LIMIT 1',
      [Number(earliest.epoch) - 2, anchor.block],
    )
  ).rows[0];
  if (!start) throw new Error('Retain at least two epochs before deployment to select a stable replay checkpoint');
  artifact.history = {
    format: 'cardano-history-v1',
    start: { slot: Number(start.slot), block_hash: start.block_hash, block_height: Number(start.block_height) },
    host_state_nft_mint: { tx_hash: anchor.tx_hash, output_index: Number(anchor.output_index) },
  };
  await verifyHistoryCoverage({ query: async (text, values) => (await db.query(text, values)).rows }, {
    ...artifact,
    cardano,
    validators,
    host_state_nft: token,
  } as BridgeManifest);
  return artifact;
}
