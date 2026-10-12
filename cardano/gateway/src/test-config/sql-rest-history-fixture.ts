import { YaciRestClient, type YaciRestBlock } from '../shared/helpers/yaci-rest';
import { YaciRestHistory, type RestTransaction } from '../shared/helpers/yaci-rest-history';

/** Existing PostgreSQL datasets simulate REST source reads for proof encoding tests.
 * This adapter is never imported by Gateway services or commands.
 */
export function sqlRestHistoryFixture(
  database: { query(text: string, values?: any[]): Promise<any> },
  ownSnapshot = false,
): YaciRestHistory {
  const query = async (text: string, values?: any[]) => {
    const result = await database.query(text, values);
    return Array.isArray(result) ? result : result.rows;
  };
  const metadata = (row: any): YaciRestBlock => ({
    number: Number(row.number),
    hash: row.hash,
    previous_block: row.prev_hash ?? null,
    slot: Number(row.slot ?? 0),
    epoch: Number(row.epoch ?? 0),
    time: 0,
    slot_leader: '',
    tx_count: 0,
  });
  const api = new YaciRestClient('https://fixture.invalid');
  api.block = async (number) => {
    const rows = await query(
      number === 'latest'
        ? 'SELECT to_jsonb(b) AS value FROM block b ORDER BY number DESC LIMIT 1'
        : 'SELECT to_jsonb(b) AS value FROM block b WHERE number=$1',
      number === 'latest' ? [] : [String(number)],
    );
    return rows.length === 1 ? metadata(rows[0].value) : null;
  };
  const source = new YaciRestHistory(api);
  source.outputs = async (filter, at) => {
    const result: any[] = [];
    let cursor: any[] = [-1, -1, '', -1];
    for (;;) {
      const rows = await query(
        `
        /* historical-ibc-tree:outputs */
        SELECT a.tx_hash, a.output_index, t.block, t.tx_index,
          COALESCE(NULLIF(a.owner_addr_full, ''), a.owner_addr) AS address,
          a.inline_datum, a.amounts
        FROM address_utxo a
        JOIN transaction t ON t.tx_hash = a.tx_hash AND t.block = a.block
        JOIN block canonical ON canonical.number = t.block AND canonical.hash = t.block_hash
        WHERE t.invalid = false AND t.block <= $1
          AND ($11::text IS NULL OR (a.tx_hash = $11 AND a.output_index = $12))
          AND ($3::text IS NULL OR a.owner_addr = $3 OR a.owner_addr_full = $3)
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(a.amounts::jsonb, '[]'::jsonb)) amount
            WHERE left(lower(amount->>'unit'), 56) = $2
              AND ($4::text IS NULL OR lower(amount->>'unit') = $4)
          )
          AND (NOT $5::boolean OR NOT EXISTS (
            SELECT 1 FROM tx_input spent
            JOIN transaction consuming ON consuming.tx_hash = spent.spent_tx_hash
              AND consuming.block = spent.spent_at_block AND consuming.block_hash = spent.spent_at_block_hash
            JOIN block spent_block ON spent_block.number = consuming.block AND spent_block.hash = consuming.block_hash
            WHERE spent.tx_hash = a.tx_hash AND spent.output_index = a.output_index
              AND consuming.invalid = false AND consuming.block <= $1
          ))
          AND (t.block, t.tx_index, a.tx_hash, a.output_index) > ($6, $7, $8, $9)
        ORDER BY t.block, t.tx_index, a.tx_hash, a.output_index
        LIMIT $10
      `,
        [
          String(at),
          filter.policy,
          filter.address ?? null,
          filter.unit ?? null,
          filter.unspent,
          ...cursor,
          500,
          filter.outRef?.txHash ?? null,
          filter.outRef?.outputIndex ?? null,
        ],
      );
      result.push(...rows);
      if (rows.length < 500) return result;
      const last = rows.at(-1);
      cursor = [last.block, last.tx_index, last.tx_hash, last.output_index];
    }
  };
  source.transaction = async (hash) => {
    const rows = await query(
      `SELECT to_jsonb(a) AS output, to_jsonb(t) AS tx, to_jsonb(b) AS block, c.cbor_data
      FROM address_utxo a JOIN transaction t ON t.tx_hash=a.tx_hash AND t.block=a.block
      JOIN block b ON b.number=t.block AND b.hash=t.block_hash JOIN transaction_cbor c ON c.tx_hash=t.tx_hash
      WHERE a.tx_hash=$1 AND t.invalid=false`,
      [hash],
    );
    if (!rows.length) return null;
    return {
      hash,
      bodyCborHex: Buffer.from(rows[0].cbor_data).toString('hex'),
      block: metadata(rows[0].block),
      index: Number(rows[0].tx.tx_index),
      valid: true,
      body: { to_cbor_hex: () => Buffer.from(rows[0].cbor_data).toString('hex') },
      outputs: rows.map((row: any) => ({
        tx_hash: hash,
        output_index: row.output.output_index,
        block: row.output.block,
        tx_index: row.tx.tx_index,
        inline_datum: row.output.inline_datum,
        amounts: row.output.amounts,
      })),
    } as unknown as RestTransaction;
  };
  source.epochBlocks = async (epoch) =>
    (await query('SELECT to_jsonb(b) AS value FROM block b WHERE epoch=$1 ORDER BY number', [epoch])).map((row: any) =>
      metadata(row.value),
    );
  source.firstBlockInEpoch = async (epoch) => (await source.epochBlocks(epoch))[0] ?? null;
  source.latestBlockInEpoch = async (epoch) => (await source.epochBlocks(epoch)).at(-1) ?? null;
  if (ownSnapshot)
    source.snapshot = async (at, read) => {
      await database.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const block = await api.block(at);
        if (!block) throw new Error('Canonical history is unavailable');
        const result = await read(block);
        await database.query('COMMIT');
        if ((await api.block(block.number))?.hash !== block.hash)
          throw new Error('Canonical state changed during REST read');
        return result;
      } catch (error) {
        await database.query('ROLLBACK');
        throw error;
      }
    };
  return source;
}
