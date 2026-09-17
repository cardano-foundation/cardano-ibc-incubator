import * as fs from 'fs';
import { Client } from 'pg';
import * as Lucid from '@lucid-evolution/lucid';
import { requireSttDeploymentConfig } from '../config/bridge-manifest';
import { reconstructHistoricalIbcTree } from '../query/services/historical-ibc-tree';
import type { IbcTreeLucidService } from '../shared/helpers/ibc-state-root';
import { decodeHostStateDatum } from '../shared/types/host-state-datum';
import { decodeClientDatum } from '../shared/types/client-datum';
import { decodeConnectionDatum } from '../shared/types/connection/connection-datum';
import { decodeChannelDatum } from '../shared/types/channel/channel-datum';
import { decodeConsensusStateDatum } from '../shared/types/consensus-state-datum';

/** Read-only recovery during the migration pause. Historical NFT discovery spans
 * both addresses; the reconstructed root must equal the actual HostState root.
 * The spending validator checks the exported witness again at activation.
 */
export async function exportMigrationWitness(db: Pick<Client, 'query'>, handler: unknown) {
  const deployment = requireSttDeploymentConfig(handler);
  if (!deployment.migration) throw new Error('An upgrade-capable handler is required');
  const sql = { query: async (text: string, values?: unknown[]) => (await db.query(text, values)).rows };
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const tip = await sql.query('SELECT number FROM block ORDER BY number DESC LIMIT 1');
    if (tip.length !== 1) throw new Error('Canonical history is unavailable');
    const hostSql = `SELECT a.tx_hash, a.output_index FROM address_utxo a
      JOIN transaction t ON t.tx_hash=a.tx_hash AND t.block=a.block
      JOIN block b ON b.number=t.block AND b.hash=t.block_hash
      WHERE t.invalid=false AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.amounts::jsonb) v
        WHERE v->>'unit'=$1 AND v->>'quantity'='1')
      AND NOT EXISTS (SELECT 1 FROM tx_input i
        JOIN transaction s ON s.tx_hash=i.spent_tx_hash AND s.block=i.spent_at_block AND s.block_hash=i.spent_at_block_hash
        JOIN block sb ON sb.number=s.block AND sb.hash=s.block_hash
        WHERE i.tx_hash=a.tx_hash AND i.output_index=a.output_index AND s.invalid=false)`;
    const hostUnit = deployment.hostStateNFT.policyId + deployment.hostStateNFT.name;
    const hosts = await sql.query(hostSql, [hostUnit]);
    if (hosts.length !== 1) throw new Error('Canonical HostState is absent or ambiguous; synchronize complete history');
    const host = { txHash: hosts[0].tx_hash, outputIndex: Number(hosts[0].output_index) };
    const decodeDatum: IbcTreeLucidService['decodeDatum'] = async <T>(
      datum: string,
      kind: Parameters<IbcTreeLucidService['decodeDatum']>[1],
    ) => {
      const decoders = {
        host_state: decodeHostStateDatum,
        client: decodeClientDatum,
        connection: decodeConnectionDatum,
        channel: decodeChannelDatum,
        consensus_state: decodeConsensusStateDatum,
      };
      return (await decoders[kind](datum, Lucid)) as T;
    };
    const role = (name: 'spendClient' | 'spendConnection' | 'spendChannel') => {
      const value = deployment.validators[name];
      if (!value.address) throw new Error(`Missing implementation address ${name}`);
      return { ...value, address: value.address };
    };
    const historical = {
      ...deployment,
      validators: {
        ...deployment.validators,
        spendClient: role('spendClient'),
        spendConnection: role('spendConnection'),
        spendChannel: role('spendChannel'),
      },
    };
    const tree = await reconstructHistoricalIbcTree(
      sql,
      historical,
      'migration-witness',
      { LucidImporter: Lucid, decodeDatum },
      BigInt(tip[0].number),
      host,
    );
    const result = {
      format: 'cardano-ibc-migration-port-witness-v1',
      host,
      block: { height: String(tip[0].number), hash: tree.blockHash },
      root: tree.root,
      siblings: tree.tree.getSiblings('ports/transfer').map((sibling) => sibling.toString('hex')),
    };
    await db.query('COMMIT');
    const canonical = await sql.query('SELECT hash FROM block WHERE number=$1', [tip[0].number]);
    const liveHosts = await sql.query(hostSql, [hostUnit]);
    if (
      canonical.length !== 1 ||
      canonical[0].hash !== tree.blockHash ||
      liveHosts.length !== 1 ||
      liveHosts[0].tx_hash !== host.txHash ||
      Number(liveHosts[0].output_index) !== host.outputIndex
    )
      throw new Error('Canonical state changed during witness export; retry from fresh history');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const [handlerPath, outputPath] = process.argv.slice(2);
  if (!handlerPath || !outputPath || process.argv.length !== 4)
    throw new Error('Usage: export-migration-witness <handler.json> <new-witness.json>');
  const db = new Client({
    connectionString: process.env.HISTORY_DB_URL,
    host: process.env.HISTORY_DB_HOST,
    port: Number(process.env.HISTORY_DB_PORT || 5432),
    database: process.env.HISTORY_DB_NAME,
    user: process.env.HISTORY_DB_USERNAME,
    password: process.env.HISTORY_DB_PASSWORD,
    connectionTimeoutMillis: 30000,
    statement_timeout: 60000,
  });
  await db.connect();
  try {
    fs.writeFileSync(
      outputPath,
      JSON.stringify(await exportMigrationWitness(db, JSON.parse(fs.readFileSync(handlerPath, 'utf8'))), null, 2) +
        '\n',
      { flag: 'wx' },
    );
  } finally {
    await db.end();
  }
}
if (require.main === module)
  void main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
