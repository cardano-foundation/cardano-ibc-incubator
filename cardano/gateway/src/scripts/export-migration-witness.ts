import { YaciRestClient } from '../shared/helpers/yaci-rest';
import { YaciRestHistory } from '../shared/helpers/yaci-rest-history';
import * as dotenv from 'dotenv';
dotenv.config();
import * as fs from 'fs';
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
async function main() {
  const [handlerPath, outputPath] = process.argv.slice(2);
  if (!handlerPath || !outputPath || process.argv.length !== 4)
    throw new Error('Usage: export-migration-witness <handler.json> <new-witness.json>');
  const source = new YaciRestHistory(new YaciRestClient(process.env.YACI_STORE_ENDPOINT));
  fs.writeFileSync(
    outputPath,
    JSON.stringify(await exportMigrationWitness(source, JSON.parse(fs.readFileSync(handlerPath, 'utf8'))), null, 2) +
      '\n',
    { flag: 'wx' },
  );
}
if (require.main === module)
  void main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

export async function exportMigrationWitness(source: YaciRestHistory, handler: unknown) {
  const deployment = requireSttDeploymentConfig(handler);
  if (!deployment.migration) throw new Error('An upgrade-capable handler is required');
  return source.snapshot('latest', async (tip) => {
    const token = deployment.hostStateNFT;
    const hosts = await source.outputs(
      { policy: token.policyId, unit: token.policyId + token.name, unspent: true },
      tip.number,
    );
    if (hosts.length !== 1) throw new Error('Canonical HostState is absent or ambiguous in Yaci REST');
    const host = { txHash: hosts[0].tx_hash, outputIndex: hosts[0].output_index };
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
      source,
      historical,
      'migration-witness',
      { LucidImporter: Lucid, decodeDatum },
      BigInt(tip.number),
      host,
    );
    return {
      format: 'cardano-ibc-migration-port-witness-v1',
      host,
      block: { height: String(tip.number), hash: tree.blockHash },
      root: tree.root,
      siblings: tree.tree.getSiblings('ports/transfer').map((sibling) => sibling.toString('hex')),
    };
  });
}
