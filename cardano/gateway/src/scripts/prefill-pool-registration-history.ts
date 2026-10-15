// Backfill verified first-registration slots for every pool in a public-network
// epoch context. Run inside the Gateway container before creating a new client.
// Only the history database and read-only public chain providers are needed;
// do not bootstrap AppModule (which starts unrelated Gateway services).
import { ConfigService } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import configuration, { validatePublicNetworkStabilityConfig } from '../config';
import { HistoryDatabaseConfig } from '../config/history-database.config';
import { YaciHistoryService } from '../query/services/yaci-history.service';
import { backfillPoolRegistrationHistory, assertCompletePoolRegistrationHistory } from '../query/services/stability-evidence';
import { LucidService } from '../shared/modules/lucid/lucid.service';

async function main(): Promise<void> {
  const [heightArgument, ...extra] = process.argv.slice(2);
  if (extra.length || (heightArgument !== undefined && !/^[1-9][0-9]*$/.test(heightArgument))) {
    throw new Error('Usage: node dist/scripts/prefill-pool-registration-history.js [block-height]');
  }
  const config = new ConfigService(configuration());
  const network = config.get<string>('cardanoNetwork');
  if (!['Preview', 'Preprod', 'Mainnet'].includes(network ?? '')) {
    throw new Error('Pool registration prefill requires a public Cardano network');
  }
  validatePublicNetworkStabilityConfig(network, config.get<string>('cardanoEpochParamsEndpoint'));
  if (!config.get<string>('cardanoBlockfrostProjectId')?.trim() ||
      !config.get<string>('cardanoPoolRegistrationHistoryEndpoint')?.trim()) {
    throw new Error('Authenticated Blockfrost pool registration history must be configured');
  }

  const source = new DataSource(HistoryDatabaseConfig as DataSourceOptions);
  await source.initialize();
  try {
    // Public-network epoch-context and registration lookups never use Lucid.
    const history = new YaciHistoryService(config, {} as LucidService, source.manager);
    const block = heightArgument
      ? await history.findBlockByHeight(BigInt(heightArgument))
      : await history.findLatestBlock();
    if (!block) throw new Error(`History block ${heightArgument ?? 'latest'} unavailable`);
    const context = await history.findEpochContextAtBlock(block);
    if (!context || context.epoch !== block.epochNo || context.stakeDistribution.length === 0) {
      throw new Error(`Full epoch context unavailable at height ${block.height}`);
    }
    const missing = context.stakeDistribution.filter((entry) =>
      entry.firstRegistrationSlot == null || entry.firstRegistrationSlot <= 0n,
    );
    console.log(`Epoch ${context.epoch} at height ${block.height}: ${missing.length}/${context.stakeDistribution.length} pool registration slots missing`);
    await backfillPoolRegistrationHistory(history, block, context.stakeDistribution, (resolved, total) => {
      if (resolved % 25 === 0 || resolved === total) console.log(`Checked ${resolved}/${total} pools`);
    });
    // Re-read the same epoch context through the cache lookup used by client
    // creation, not just the return values from the external provider.
    const refreshed = await history.findEpochContextAtBlock(block);
    if (!refreshed || refreshed.epoch !== context.epoch ||
        refreshed.stakeDistribution.length !== context.stakeDistribution.length) {
      throw new Error('Epoch context changed during backfill');
    }
    assertCompletePoolRegistrationHistory(refreshed.stakeDistribution, refreshed.epoch);
    console.log(`Verified complete pool registration history for epoch ${refreshed.epoch}`);
  } finally {
    await source.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
