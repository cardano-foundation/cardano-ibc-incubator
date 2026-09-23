import { requireHistoryBootstrap } from '@cardano-ibc/tx-builder-runtime/historyBootstrap';
import { validateHistoryBootstrap } from '@cardano-ibc/tx-builder-runtime/consensusHistoryRecovery';
import type { BridgeManifest } from './bridge-manifest';
import { decodeHostStateDatum } from '../shared/types/host-state-datum';

export class HistoryConfigurationError extends Error {}

type Sql = { query(text: string, values?: unknown[]): Promise<any[]> };

/** Read-only prerequisite for publishing a manifest or accepting a cold Gateway. */
export async function verifyHistoryCoverage(
  sql: Sql,
  manifest: BridgeManifest,
  liveHost?: { txHash: string; outputIndex: number },
): Promise<void> {
  const h = requireHistoryBootstrap(manifest.history, manifest.cardano.network_magic);
  const fail = (detail: string): never => {
    throw new Error(
      `Bridge history is not ready: ${detail}. Sync/restore retained Yaci history from the manifest checkpoint and retry; do not choose a newer checkpoint.`,
    );
  };
  const mismatch = (detail: string): never => {
    throw new HistoryConfigurationError(
      `Bridge history bootstrap mismatch: ${detail}; verify the manifest and selected network before retrying`,
    );
  };
  const start = h.start === 'origin' ? 0 : h.start.block_height;
  if (h.start !== 'origin') {
    const first = await sql.query(
      'SELECT number, hash, prev_hash, slot FROM block WHERE number >= $1 ORDER BY number LIMIT 2',
      [start],
    );
    const checkpoint = first.find((b) => Number(b.number) === start);
    const successor = first.find((b) => Number(b.number) === start + 1);
    if (checkpoint && (checkpoint.hash !== h.start.block_hash || Number(checkpoint.slot) !== h.start.slot))
      mismatch('checkpoint belongs to another chain or fork');
    // Chain sync can omit the intersection block itself. Its first successor
    // still authenticates the manifest hash and the expected block number.
    if (!successor) fail('checkpoint successor is not indexed');
    if (successor.prev_hash !== h.start.block_hash || Number(successor.slot) <= h.start.slot)
      mismatch('checkpoint successor belongs to another chain or fork');
  }
  const refs = new Map<string, { tx_hash: string; output_index: number }>();
  const collect = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    const row = v as Record<string, any>;
    if (row.ref_utxo) refs.set(`${row.ref_utxo.tx_hash}#${row.ref_utxo.output_index}`, row.ref_utxo);
    for (const child of Object.values(row)) collect(child);
  };
  collect(manifest.validators);
  const anchor = h.host_state_nft_mint;
  refs.set(`${anchor.tx_hash}#${anchor.output_index}`, anchor);
  if (liveHost)
    refs.set(`${liveHost.txHash}#${liveHost.outputIndex}`, {
      tx_hash: liveHost.txHash,
      output_index: liveHost.outputIndex,
    });
  let last = start;
  for (const ref of refs.values()) {
    const rows = await sql.query(
      `
      SELECT t.block, t.tx_index, a.inline_datum, a.amounts, b.hash, b.slot, c.cbor_data
      FROM address_utxo a JOIN transaction t ON t.tx_hash=a.tx_hash AND t.block=a.block
      JOIN block b ON b.number=t.block AND b.hash=t.block_hash
      JOIN transaction_cbor c ON c.tx_hash=t.tx_hash
      WHERE a.tx_hash=$1 AND a.output_index=$2 AND t.invalid=false AND octet_length(c.cbor_data)>0
    `,
      [ref.tx_hash, ref.output_index],
    );
    if (rows.length !== 1)
      fail(`missing accepted deployment/live output or transaction CBOR ${ref.tx_hash}#${ref.output_index}`);
    const row = rows[0];
    if (!Number.isSafeInteger(Number(row.block)) || Number(row.block) <= start)
      mismatch('checkpoint does not precede all required deployment outputs');
    last = Math.max(last, Number(row.block));
    if (ref.tx_hash === anchor.tx_hash && ref.output_index === anchor.output_index) {
      const unit = manifest.host_state_nft.policy_id + manifest.host_state_nft.token_name;
      if (
        !row.inline_datum ||
        !Array.isArray(row.amounts) ||
        row.amounts.filter((a: any) => a.unit === unit && String(a.quantity) === '1').length !== 1
      )
        fail('creation anchor does not contain the HostState NFT and datum');
      const lucid = await import('@lucid-evolution/lucid');
      const datum = await decodeHostStateDatum(row.inline_datum, lucid);
      if (datum.state.version !== 0n || datum.nft_policy !== manifest.host_state_nft.policy_id)
        mismatch('anchor is not the initial HostState output');
      try {
        validateHistoryBootstrap(
          {
            txHash: anchor.tx_hash,
            blockHash: row.hash,
            blockHeight: Number(row.block),
            slot: Number(row.slot),
            transactionIndex: Number(row.tx_index),
            cbor: Buffer.from(row.cbor_data).toString('hex'),
            valid: true,
          },
          { policyId: manifest.host_state_nft.policy_id, name: manifest.host_state_nft.token_name },
          anchor.output_index,
        );
      } catch (error) {
        mismatch(`creation anchor lacks hash-checked NFT mint evidence (${String(error)})`);
      }
    }
  }
  if (h.start !== 'origin') {
    const rows = await sql.query(
      'SELECT COUNT(DISTINCT number)::text AS count FROM block WHERE number > $1 AND number <= $2',
      [start, last],
    );
    if (Number(rows[0]?.count) !== last - start)
      fail('block history contains gaps before the current deployment state');
  }
}
