import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { KupoService } from '../modules/kupo/kupo.service';
import { LucidService } from '../modules/lucid/lucid.service';
import { ConfigService } from '@nestjs/config';
import { rebuildTreeFromChain, initTreeServices } from '../helpers/ibc-state-root';
import { CURRENT_IBC_TREE_CACHE_ID, IbcTreeCacheService } from './ibc-tree-cache.service';
import { HostStateDatum } from '../types/host-state-datum';
import { HISTORY_SERVICE, HistoryService } from '../../query/services/history.service';

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
    @Inject(HISTORY_SERVICE) private readonly historyService: HistoryService,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing IBC state tree from on-chain UTXOs...');

    // Cache services for on-demand tree alignment (used by alignTreeWithChain)
    initTreeServices(this.kupoService, this.lucidService, this.ibcTreeCacheService, this.historyService);

    try {
      if (process.env.IBC_TREE_CACHE_ENABLED === 'false') {
        throw new Error('IBC_TREE_CACHE_ENABLED=false is unsafe with root-authoritative packet state');
      }
        await this.ibcTreeCacheService.ensureSchema();

          const hostStateUtxo = await this.lucidService.findUtxoAtHostStateNFT();
          if (!hostStateUtxo?.datum) {
        throw new Error('HostState UTXO has no datum - cannot verify persisted tree');
          }
          const hostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(hostStateUtxo.datum, 'host_state');
      const onChainRoot = hostStateDatum.state.ibc_state_root.toLowerCase();

      const cached = await this.ibcTreeCacheService.load(CURRENT_IBC_TREE_CACHE_ID);
      if (cached?.root === onChainRoot) {
        this.logger.log(`Loaded verified IBC proof store, root: ${cached.root.substring(0, 16)}...`);
            return;
          }

      if (cached) {
          this.logger.warn(
          `Persisted IBC root ${cached.root.substring(0, 16)}... trails on-chain root ${onChainRoot.substring(0, 16)}...; replaying durable journal`,
          );
        const indexedHostStateTx = await this.historyService.findTxByHash(hostStateUtxo.txHash);
        if (!indexedHostStateTx || !Number.isSafeInteger(indexedHostStateTx.height) || indexedHostStateTx.height < 0) {
          throw new Error(`No authoritative inclusion height is indexed for HostState ${hostStateUtxo.txHash}`);
        }
        const recovered = await this.ibcTreeCacheService.recoverToRoot(onChainRoot, {
          expectedRootInclusionHeight: BigInt(indexedHostStateTx.height),
          resolveTransitionInclusionHeight: async (txHash) => {
            const tx = await this.historyService.findTxByHash(txHash);
            if (!tx || !Number.isSafeInteger(tx.height) || tx.height < 0) {
              throw new Error(`No authoritative inclusion height is indexed for IBC transition ${txHash}`);
            }
            return BigInt(tx.height);
          },
        });
        this.logger.log(`Recovered verified IBC proof store to root: ${recovered.root.substring(0, 16)}...`);
        return;
      }

      // A first deployment with no packet history can still seed the durable
      // store from bounded entity UTxOs. Once packet leaves exist, loss of the
      // proof store is an availability failure and the root mismatch below
      // deliberately prevents startup.
      const { tree, root } = await rebuildTreeFromChain(this.kupoService, this.lucidService);

      this.logger.log(`IBC state tree initialized successfully`);
      this.logger.log(`   Root: ${root.substring(0, 16)}...`);

      await this.ibcTreeCacheService.bootstrapVerifiedTree(tree);
      this.logger.log(`Persisted initial IBC proof-store checkpoint, root: ${root.substring(0, 16)}...`);
    } catch (error) {
      this.logger.error(`Failed to initialize IBC state tree: ${error.message}`);
      this.logger.error(`   Gateway cannot start without valid tree state`);
      this.logger.error(`   Please verify:`);
      this.logger.error(`   - Kupo is running and indexing`);
      this.logger.error(`   - HostState UTXO exists on-chain`);
      this.logger.error(`   - Kupo has indexed from the HostState deployment block`);

      // Throw error to prevent Gateway from starting with invalid state
      throw new Error(`Tree initialization failed: ${error.message}`);
    }
  }
}
