import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { KupoService } from '../modules/kupo/kupo.service';
import { LucidService } from '../modules/lucid/lucid.service';
import { rebuildTreeFromChain } from '../helpers/ibc-state-root';

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
    private readonly kupoService: KupoService,
    private readonly lucidService: LucidService,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing IBC state tree from on-chain UTXOs...');
    
    try {
      const { tree, root } = await rebuildTreeFromChain(
        this.kupoService,
        this.lucidService,
      );
      
      this.logger.log(`✅ IBC state tree initialized successfully`);
      this.logger.log(`   Root: ${root.substring(0, 16)}...`);
      
    } catch (error) {
      this.logger.error(`❌ Failed to initialize IBC state tree: ${error.message}`);
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

