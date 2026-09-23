import { ConfigService } from '@nestjs/config';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { HistoryConfigurationError, verifyHistoryCoverage } from '../../config/history-coverage';
import type { BridgeManifest } from '../../config/bridge-manifest';
import { Injectable, OnModuleInit, Logger, Optional } from '@nestjs/common';
import { LucidService } from '../modules/lucid/lucid.service';
import { IbcTreeStateStore } from '../helpers/ibc-state-root';
import { CURRENT_IBC_TREE_CACHE_ID, IbcTreeCacheService, ibcTreeCacheIdForRoot } from './ibc-tree-cache.service';
import { HostStateDatum } from '../types/host-state-datum';
import { historicalReadOnly } from '../../security/historical-read-only.guard';

/**
 * TreeInitService - Initializes the IBC state tree on Gateway startup
 *
 * Purpose:
 * - Ensures the in-memory Merkle tree is synchronized with on-chain state
 * - Makes Gateway resilient to restarts and crashes
 * - Verifies tree integrity before processing transactions
 *
 * Lifecycle:
 * - Called automatically by NestJS on module initialization
 * - Blocks Gateway startup until tree is rebuilt
 * - Throws error if tree rebuild fails (prevents Gateway from starting with wrong state)
 */
@Injectable()
export class TreeInitService implements OnModuleInit {
  private readonly logger = new Logger(TreeInitService.name);

  constructor(
    private readonly lucidService: LucidService,
    private readonly ibcTreeCacheService: IbcTreeCacheService,
    private readonly ibcTreeStore: IbcTreeStateStore,
    @Optional() private readonly config?: ConfigService,
    @Optional() @InjectEntityManager("history") private readonly historyDb?: EntityManager,
  ) {}

  async onModuleInit() {
    const manifest = this.config?.get<BridgeManifest>('bridgeManifest');
    if (historicalReadOnly()) {
      if (!manifest?.history || !this.historyDb) {
        throw new HistoryConfigurationError('Historical read-only startup requires an explicit manifest with retained history and the Yaci database');
      }
      await this.historyDb.transaction('REPEATABLE READ', async (manager) => {
        await manager.query('SET TRANSACTION READ ONLY');
        await manager.query('SET LOCAL statement_timeout = 30000');
        await verifyHistoryCoverage(manager, manifest);
      });
      await this.ibcTreeCacheService.ensureSchema();
      this.logger.log('Historical read-only startup: bootstrap authenticated; each query must verify its canonical historical root. Transaction RPCs are disabled.');
      return;
    }
    const seconds = Number(this.config?.get('BRIDGE_HISTORY_SYNC_TIMEOUT_SECONDS') ?? 7200);
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 86400) throw new Error('BRIDGE_HISTORY_SYNC_TIMEOUT_SECONDS must be between 1 and 86400');
    const deadline = Date.now() + seconds * 1000;
    for (;;) {
      try { await this.initializeTree(); return; }
      catch (error) {
        if (error instanceof HistoryConfigurationError || !manifest?.history || Date.now() >= deadline) throw error;
        this.logger.warn(`Waiting for bridge history/providers and verified tree state: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, Math.min(10000, deadline - Date.now())));
      }
    }
  }

  private async initializeTree() {
    this.logger.log('Initializing IBC state tree from on-chain UTXOs...');

    try {
      const manifest = this.config?.get<BridgeManifest>('bridgeManifest');
      if (manifest && (manifest.history || [1, 2, 764824073].includes(manifest.cardano.network_magic))) {
        if (!this.historyDb) throw new HistoryConfigurationError('Yaci database is required for manifest history verification');
        const liveHost = await this.lucidService.findUtxoAtHostStateNFT(0n);
        await this.historyDb.transaction('REPEATABLE READ', async (manager) => {
          await manager.query('SET TRANSACTION READ ONLY');
          await manager.query('SET LOCAL statement_timeout = 30000');
          await verifyHistoryCoverage(manager, manifest, liveHost);
        });
      }
      const cacheEnabled = process.env.IBC_TREE_CACHE_ENABLED !== 'false';
      if (cacheEnabled) {
        await this.ibcTreeCacheService.ensureSchema();

        const cached = await this.ibcTreeCacheService.load(CURRENT_IBC_TREE_CACHE_ID);
        if (cached) {
          // Verify cached root against the authoritative on-chain HostState commitment.
          const hostStateUtxo = await this.lucidService.findUtxoAtHostStateNFT(0n);
          if (!hostStateUtxo?.datum) {
            throw new Error('HostState UTXO has no datum - cannot verify cached tree');
          }
          const hostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(hostStateUtxo.datum, 'host_state');
          const onChainRoot = hostStateDatum.state.ibc_state_root;

          if (onChainRoot === cached.root) {
            await this.ibcTreeStore.restoreTreeFromCache(cached.tree);
            this.logger.log(`Loaded IBC state tree from cache, root: ${cached.root.substring(0, 16)}...`);
            return;
          }

          this.logger.warn(
            `Cached tree root does not match on-chain root, cached=${cached.root.substring(0, 16)}..., onChain=${onChainRoot.substring(0, 16)}..., rebuilding from chain`,
          );
        }
      }

      const { tree, root, hostState } = await this.ibcTreeStore.rebuildTreeFromChain();

      this.logger.log(`IBC state tree initialized successfully`);
      this.logger.log(`   Root: ${root.substring(0, 16)}...`);

      if (process.env.IBC_TREE_CACHE_ENABLED !== 'false') {
        try {
          await this.ibcTreeCacheService.saveAliases(tree, [CURRENT_IBC_TREE_CACHE_ID, ibcTreeCacheIdForRoot(root)], hostState);
          this.logger.log(`Persisted IBC state tree cache, root: ${root.substring(0, 16)}...`);
        } catch (error) {
          this.logger.warn(`Failed to persist IBC state tree cache: ${error?.message ?? error}`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to initialize IBC state tree: ${error.message}`);
      this.logger.error(`   Gateway cannot start without valid tree state`);
      this.logger.error(`   Please verify:`);
      this.logger.error(`   - Kupo is running and indexing`);
      this.logger.error(`   - HostState UTXO exists on-chain`);
      this.logger.error(`   - Kupo has indexed from the HostState deployment block`);

      // Throw error to prevent Gateway from starting with invalid state
      throw error instanceof HistoryConfigurationError ? error : new Error(`Tree initialization failed: ${error.message}`);
    }
  }
}
