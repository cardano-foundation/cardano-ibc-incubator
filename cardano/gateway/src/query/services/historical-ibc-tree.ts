import { publicClientCommitmentValues } from '@cardano-ibc/tx-builder-runtime/plutusSerialise';
import {
  IbcTreeStateStore,
  StaleIbcTreeStateError,
  type IbcTreeHostStateRef,
  type IbcTreeLucidService,
  type IbcTreeSnapshot,
  type IbcTreeUtxo,
} from '../../shared/helpers/ibc-state-root';
import type { ClientDatum } from '../../shared/types/client-datum';

export type HistoricalTreeDeployment = {
  hostStateNFT: { policyId: string; name: string };
  validators: {
    mintClientStt: { scriptHash: string };
    mintConnectionStt: { scriptHash: string };
    mintChannelStt: { scriptHash: string };
    spendClient: { address: string };
    spendConnection: { address: string };
    spendChannel: { address: string };
  };
};

type Sql = { query(sql: string, parameters?: unknown[]): Promise<any[]> };
type OutputRow = {
  tx_hash: string;
  output_index: number | string;
  block: number | string;
  tx_index: number | string;
  address: string;
  inline_datum: string | null;
  amounts: Array<{ unit: string; quantity: string | number }>;
};

type OutputFilter = { policy: string; address?: string; unit?: string; outRef?: IbcTreeHostStateRef; unspent: boolean };
const PAGE_SIZE = 500;
const fail = (detail: string): never => { throw new Error(`Historical IBC tree unavailable: ${detail}`); };
const ref = (utxo: IbcTreeHostStateRef) => `${utxo.txHash}#${utxo.outputIndex}`;

function natural(value: string | number, label: string): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) {
    return fail(`invalid ${label}`);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) return fail(`invalid ${label}`);
  return n;
}

function output(row: OutputRow, filter: OutputFilter): IbcTreeUtxo {
  if (!/^[0-9a-f]{64}$/.test(row.tx_hash) || !row.address ||
    !row.inline_datum || !/^(?:[0-9a-f]{2})+$/.test(row.inline_datum)) {
    return fail('missing or malformed historical output datum/reference');
  }
  natural(row.block, 'output block');
  natural(row.tx_index, 'transaction index');
  if (!Array.isArray(row.amounts)) return fail('missing historical output assets');
  const tokens = row.amounts.filter(({ unit }) => filter.unit ? unit === filter.unit : unit?.startsWith(filter.policy));
  if (tokens.length !== 1 || !/^[0-9a-f]{56,120}$/.test(tokens[0].unit) ||
    tokens[0].unit.length % 2 !== 0 || String(tokens[0].quantity) !== '1') {
    return fail('ambiguous or non-unit state authentication token');
  }
  // The tree builder needs the state identity, not the output's funding assets.
  // Put only the selected policy's NFT in this read-only tree-building view.
  return {
    txHash: row.tx_hash,
    outputIndex: natural(row.output_index, 'output index'),
    address: row.address,
    datum: row.inline_datum,
    assets: { [tokens[0].unit]: 1n },
  };
}

/** Caller holds one repeatable-read, read-only Yaci snapshot for all queries. */
export async function reconstructHistoricalIbcTree(
  sql: Sql,
  deployment: HistoricalTreeDeployment,
  network: string,
  lucid: Pick<IbcTreeLucidService, 'LucidImporter' | 'decodeDatum'>,
  height: bigint,
  expectedHostState: IbcTreeHostStateRef,
): Promise<IbcTreeSnapshot & { blockHash: string }> {
  if (height <= 0n || height > BigInt(Number.MAX_SAFE_INTEGER)) return fail('invalid requested block height');
  const blocks = await sql.query('SELECT hash FROM block WHERE number = $1', [height.toString()]);
  if (blocks.length !== 1 || !/^[0-9a-f]{64}$/.test(blocks[0].hash)) return fail('requested canonical block is not indexed');
  const blockHash = blocks[0].hash as string;

  async function* outputs(filter: OutputFilter): AsyncGenerator<IbcTreeUtxo> {
    if (!/^[0-9a-f]{56}$/.test(filter.policy)) return fail('invalid deployment policy');
    let cursor: Array<string | number> = [-1, -1, '', -1];
    for (;;) {
      const rows: OutputRow[] = await sql.query(`
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
      `, [height.toString(), filter.policy, filter.address ?? null, filter.unit ?? null, filter.unspent,
        ...cursor, PAGE_SIZE, filter.outRef?.txHash ?? null, filter.outRef?.outputIndex ?? null]);
      if (rows.length > PAGE_SIZE) return fail('history page exceeded its limit');
      for (const row of rows) yield output(row, filter);
      if (rows.length < PAGE_SIZE) return;
      const last = rows[rows.length - 1];
      cursor = [last.block, last.tx_index, last.tx_hash, last.output_index];
    }
  }

  const collect = async (filter: OutputFilter) => {
    const result: IbcTreeUtxo[] = [];
    const units = new Set<string>();
    for await (const utxo of outputs(filter)) {
      const unit = Object.keys(utxo.assets)[0];
      if (units.has(unit)) return fail('multiple live outputs for a state NFT; spend history may be incomplete');
      units.add(unit);
      result.push(utxo);
    }
    return result;
  };
  const hostUnit = deployment.hostStateNFT.policyId + deployment.hostStateNFT.name;
  // Authenticate the requested HostState by its indexed output reference. Its
  // unique NFT and unspent-at-height check avoid scanning the whole chain.
  const hosts = await collect({ policy: deployment.hostStateNFT.policyId, unit: hostUnit, outRef: expectedHostState, unspent: true });
  if (hosts.length !== 1 || ref(hosts[0]) !== ref(expectedHostState)) {
    throw new StaleIbcTreeStateError('Historical HostState differs from canonical Yaci outputs at the requested block');
  }
  const host = hosts[0];
  const { validators } = deployment;
  const stateOutputs = (policy: string, address: string) => {
    if (!address) return fail('missing deployment state address');
    return collect({ policy, address, unspent: true });
  };
  const historyRecords: NonNullable<IbcTreeLucidService['consensusHistoryRecords']> = async (client) => {
    const current = await lucid.decodeDatum<ClientDatum>(client.datum!, 'client');
    const unit = current.token.policyId + current.token.name;
    if (client.assets[unit] !== 1n) return fail('client datum token differs from its NFT');
    const latestHeight = current.state.clientState.latestHeight;
    const key = (h: typeof latestHeight) => `${h.revisionNumber}-${h.revisionHeight}`;
    const records = new Map<string, Awaited<ReturnType<typeof historyRecords>>[number]>();
    let last: IbcTreeUtxo | undefined;
    for await (const checkpoint of outputs({ policy: current.token.policyId, address: client.address, unit, unspent: false })) {
      const datum = await lucid.decodeDatum<ClientDatum>(checkpoint.datum!, 'client');
      const state = datum.state;
      if (datum.token.policyId + datum.token.name !== unit || state.consensusStates.size !== 1 ||
        state.processedTimes.size !== 1 || state.processedHeights.size !== 1) return fail('invalid historical client checkpoint');
      const [[h, consensusState]] = [...state.consensusStates];
      const [[timeHeight, processedTime]] = [...state.processedTimes];
      const [[processingHeight, processedHeight]] = [...state.processedHeights];
      if (key(h) !== key(timeHeight) || key(h) !== key(processingHeight) || key(h) !== key(state.clientState.latestHeight)) {
        return fail('misaligned historical checkpoint metadata');
      }
      const consensusValue = publicClientCommitmentValues(checkpoint.datum!).consensusValue;
      const existing = records.get(key(h));
      if (existing && existing.consensusValue !== consensusValue) return fail('conflicting historical consensus states');
      if (!existing) records.set(key(h), {
        datum: { clientToken: datum.token, height: h, consensusState, processedTime, processedHeight },
        consensusValue,
        archived: key(h) !== key(latestHeight),
      });
      last = checkpoint;
    }
    if (!last || ref(last) !== ref(client) || last.datum !== client.datum) return fail('checkpoint history did not reach the historical client output');
    return [...records.values()];
  };

  // An isolated store reuses production leaf encoding/root checks. It cannot
  // publish a historical snapshot into the Gateway's live transaction store.
  const store = new IbcTreeStateStore({
    network, hostStateNFT: deployment.hostStateNFT, clientPolicyId: validators.mintClientStt.scriptHash,
  }, {
    queryAllClientUtxos: () => stateOutputs(validators.mintClientStt.scriptHash, validators.spendClient.address),
    queryAllConnectionUtxos: () => stateOutputs(validators.mintConnectionStt.scriptHash, validators.spendConnection.address),
    queryAllChannelUtxos: () => stateOutputs(validators.mintChannelStt.scriptHash, validators.spendChannel.address),
  }, {
    LucidImporter: lucid.LucidImporter,
    decodeDatum: (datum, type) => lucid.decodeDatum(datum, type),
    findUtxoAtHostStateNFT: async () => host,
    consensusHistoryRecords: historyRecords,
  });
  return { ...await store.rebuildTreeFromChain(), blockHash };
}
