import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { KupoService } from '../modules/kupo/kupo.service';
import { LucidService } from '../modules/lucid/lucid.service';
import { ConfigService } from '@nestjs/config';
import { rebuildTreeFromChain, initTreeServices, setCurrentTree } from '../helpers/ibc-state-root';
import { IbcTreeCacheService } from './ibc-tree-cache.service';

/**
 * TreeInitService - Initializes the IBC state tree on Gateway startup
 * 
 * Purpose:
 * - Ensures the in-memory Merkle tree is synchronized with on-chain state
 * - Makes Gateway resilient to restarts and crashes
 * - Verifies tree integrity before processing transactions
 * - Caches services for on-demand tree alignment
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
    private readonly kupoService: KupoService,
    private readonly lucidService: LucidService,
    private readonly configService: ConfigService,
    private readonly ibcTreeCacheService: IbcTreeCacheService,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing IBC state tree from on-chain UTXOs...');
    
    // Cache services for on-demand tree alignment (used by alignTreeWithChain)
    initTreeServices(this.kupoService, this.lucidService);
    
    try {
      const cacheEnabled = process.env.IBC_TREE_CACHE_ENABLED !== 'false';
      if (cacheEnabled) {
        await this.ibcTreeCacheService.ensureSchema();

        const cached = await this.ibcTreeCacheService.load('current');
        if (cached) {
          // Verify cached root against the authoritative on-chain HostState commitment.
          const hostStateUtxo = await this.lucidService.findUtxoAtHostStateNFT();
          if (!hostStateUtxo?.datum) {
            throw new Error('HostState UTXO has no datum - cannot verify cached tree');
          }
          const hostStateDatum = await this.lucidService.decodeDatum(hostStateUtxo.datum, 'host_state');
          const onChainRoot = hostStateDatum.state.ibc_state_root;

          if (onChainRoot === cached.root) {
            setCurrentTree(cached.tree);
            this.logger.log(`Loaded IBC state tree from cache, root: ${cached.root.substring(0, 16)}...`);
            return;
          }

          this.logger.warn(
            `Cached tree root does not match on-chain root, cached=${cached.root.substring(0, 16)}..., onChain=${onChainRoot.substring(0, 16)}..., rebuilding from chain`,
          );
        }
      }

      const { tree, root } = await rebuildTreeFromChain(
        this.kupoService,
        this.lucidService,
      );
      
      this.logger.log(`IBC state tree initialized successfully`);
      this.logger.log(`   Root: ${root.substring(0, 16)}...`);

      if (process.env.IBC_TREE_CACHE_ENABLED !== 'false') {
        try {
          await this.ibcTreeCacheService.save(tree, 'current');
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
      this.logger.error(`   - Handler UTXO exists on-chain`);
      this.logger.error(`   - Kupo has indexed from Handler deployment block`);
      
      // Throw error to prevent Gateway from starting with invalid state
      throw new Error(`Tree initialization failed: ${error.message}`);
    }
  }
}
