import { Injectable, Logger, Inject, Optional, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DenomTrace } from '../../shared/entities/denom-trace.entity';
import { PaginationKeyDto } from '../dtos/pagination.dto';
import { MetricsService } from '../../health/metrics.service';
import { convertString2Hex, hashSHA256 } from '../../shared/helpers/hex';

@Injectable()
export class DenomTraceService implements OnModuleInit {
  private static readonly DEFAULT_BACKFILL_BATCH_SIZE = 500;

  constructor(
    private readonly logger: Logger,
    @InjectRepository(DenomTrace, 'gateway')
    private denomTraceRepository: Repository<DenomTrace>,
    @Optional() @Inject(MetricsService) private metricsService?: MetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
    const updated = await this.backfillMissingIbcDenomHashes();
    if (updated > 0) {
      this.logger.log(`Backfilled ibc_denom_hash for ${updated} denom trace rows`);
    }
  }

  private async ensureSchema(): Promise<void> {
    await this.denomTraceRepository.query(`
      CREATE TABLE IF NOT EXISTS denom_traces (
        hash TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        base_denom TEXT NOT NULL,
        voucher_policy_id TEXT NOT NULL,
        ibc_denom_hash TEXT,
        first_seen TIMESTAMP NOT NULL DEFAULT NOW(),
        tx_hash TEXT
      );
    `);

    await this.denomTraceRepository.query(`
      ALTER TABLE denom_traces
      ADD COLUMN IF NOT EXISTS ibc_denom_hash TEXT;
    `);

    await this.denomTraceRepository.query(`
      CREATE INDEX IF NOT EXISTS idx_denom_traces_ibc_denom_hash
      ON denom_traces (ibc_denom_hash);
    `);
  }

  /**
   * Save or update a denom trace mapping
   * Uses upsert to avoid duplicate entries
   */
  async saveDenomTrace(trace: Partial<DenomTrace>): Promise<DenomTrace> {
    const startTime = Date.now();
    
    try {
      // Check if trace already exists
      const existing = await this.denomTraceRepository.findOne({
        where: { hash: trace.hash },
      });

      if (existing) {
        this.logger.log(`Denom trace already exists for hash: ${trace.hash}`);
        this.metricsService?.denomTraceSavesTotal.inc({ status: 'duplicate' });
        return existing;
      }

      const traceWithIbcHash = this.withComputedIbcDenomHash(trace);
      const newTrace = this.denomTraceRepository.create(traceWithIbcHash);
      const saved = await this.denomTraceRepository.save(newTrace);
      this.logger.log(`Saved new denom trace: ${trace.hash} -> ${trace.path}/${trace.base_denom}`);
      
      // Record successful save metric
      this.metricsService?.denomTraceSavesTotal.inc({ status: 'success' });
      
      return saved;
    } catch (error) {
      this.logger.error(`Failed to save denom trace: ${error.message}`, error.stack);
      
      // Record error metrics
      this.metricsService?.denomTraceSavesTotal.inc({ status: 'error' });
      this.metricsService?.denomTraceSaveErrorsTotal.inc({ 
        error_type: error.name || 'unknown' 
      });
      
      throw error;
    } finally {
      // Record operation duration
      const duration = (Date.now() - startTime) / 1000;
      this.metricsService?.denomTraceQueryDuration.observe(
        { operation: 'save' },
        duration
      );
    }
  }

  /**
   * Find a denom trace by its hash (voucher token name)
   */
  async findByHash(hash: string): Promise<DenomTrace | null> {
    const startTime = Date.now();
    
    try {
      const trace = await this.denomTraceRepository.findOne({
        where: { hash },
      });
      return trace;
    } catch (error) {
      this.logger.error(`Failed to find denom trace by hash ${hash}: ${error.message}`);
      throw error;
    } finally {
      const duration = (Date.now() - startTime) / 1000;
      this.metricsService?.denomTraceQueryDuration.observe(
        { operation: 'findByHash' },
        duration
      );
    }
  }

  /**
   * Find all denom traces with optional pagination
   */
  async findAll(pagination?: PaginationKeyDto): Promise<DenomTrace[]> {
    const startTime = Date.now();
    
    try {
      const query = this.denomTraceRepository
        .createQueryBuilder('denom_trace')
        .orderBy('denom_trace.first_seen', 'DESC');

      if (pagination?.offset) {
        query.offset(pagination.offset);
        query.limit(100); // Default limit
      } else {
        query.limit(100); // Default limit
      }

      const traces = await query.getMany();
      this.logger.log(`Retrieved ${traces.length} denom traces`);
      return traces;
    } catch (error) {
      this.logger.error(`Failed to find all denom traces: ${error.message}`);
      throw error;
    } finally {
      const duration = (Date.now() - startTime) / 1000;
      this.metricsService?.denomTraceQueryDuration.observe(
        { operation: 'findAll' },
        duration
      );
    }
  }

  /**
   * Find a trace by the sha256 hash used in `ibc/<hash>` denoms.
   * Uses the persisted/indexed `ibc_denom_hash` for O(log N) lookup.
   */
  async findByIbcDenomHash(denomHash: string): Promise<DenomTrace | null> {
    const startTime = Date.now();

    try {
      return await this.denomTraceRepository.findOne({
        where: { ibc_denom_hash: denomHash.toLowerCase() },
        order: { first_seen: 'DESC' },
      });
    } catch (error) {
      this.logger.error(`Failed to find denom trace by ibc hash ${denomHash}: ${error.message}`);
      throw error;
    } finally {
      const duration = (Date.now() - startTime) / 1000;
      this.metricsService?.denomTraceQueryDuration.observe(
        { operation: 'findByIbcDenomHash' },
        duration
      );
    }
  }

  /**
   * Find denom traces by base denomination
   */
  async findByBaseDenom(baseDenom: string): Promise<DenomTrace[]> {
    const startTime = Date.now();
    
    try {
      const traces = await this.denomTraceRepository.find({
        where: { base_denom: baseDenom },
        order: { first_seen: 'DESC' },
      });
      this.logger.log(`Found ${traces.length} denom traces for base denom: ${baseDenom}`);
      return traces;
    } catch (error) {
      this.logger.error(`Failed to find denom traces by base denom ${baseDenom}: ${error.message}`);
      throw error;
    } finally {
      const duration = (Date.now() - startTime) / 1000;
      this.metricsService?.denomTraceQueryDuration.observe(
        { operation: 'findByBaseDenom' },
        duration
      );
    }
  }

  /**
   * Get count of all denom traces
   */
  async getCount(): Promise<number> {
    try {
      return await this.denomTraceRepository.count();
    } catch (error) {
      this.logger.error(`Failed to get denom trace count: ${error.message}`);
      throw error;
    }
  }

  /**
   * Attach the confirmed Cardano tx hash to a set of denom traces.
   */
  async setTxHashForTraces(traceHashes: string[], txHash: string): Promise<number> {
    if (!traceHashes.length) return 0;

    const uniqueHashes = Array.from(new Set(traceHashes.map((hash) => hash.toLowerCase())));
    const result = await this.denomTraceRepository
      .createQueryBuilder()
      .update(DenomTrace)
      .set({ tx_hash: txHash })
      .where('hash IN (:...traceHashes)', { traceHashes: uniqueHashes })
      .execute();

    return result.affected ?? 0;
  }

  async backfillMissingIbcDenomHashes(batchSize = DenomTraceService.DEFAULT_BACKFILL_BATCH_SIZE): Promise<number> {
    let totalUpdated = 0;

    while (true) {
      const rows = await this.denomTraceRepository
        .createQueryBuilder('denom_trace')
        .select('denom_trace.hash', 'hash')
        .addSelect('denom_trace.path', 'path')
        .addSelect('denom_trace.base_denom', 'base_denom')
        .where('denom_trace.ibc_denom_hash IS NULL')
        .orderBy('denom_trace.first_seen', 'ASC')
        .limit(batchSize)
        .getRawMany<{ hash: string; path: string; base_denom: string }>();

      if (rows.length === 0) {
        return totalUpdated;
      }

      const params: string[] = [];
      const valuesSql = rows
        .map((row, index) => {
          params.push(row.hash, this.computeIbcDenomHash(row));
          const hashParam = `$${index * 2 + 1}`;
          const ibcHashParam = `$${index * 2 + 2}`;
          return `(${hashParam}, ${ibcHashParam})`;
        })
        .join(', ');

      await this.denomTraceRepository.query(
        `
          UPDATE denom_traces AS dt
          SET ibc_denom_hash = data.ibc_denom_hash
          FROM (VALUES ${valuesSql}) AS data(hash, ibc_denom_hash)
          WHERE dt.hash = data.hash;
        `,
        params,
      );

      totalUpdated += rows.length;

      if (rows.length < batchSize) {
        return totalUpdated;
      }
    }
  }

  private withComputedIbcDenomHash(trace: Partial<DenomTrace>): Partial<DenomTrace> {
    if (trace.path === undefined || trace.base_denom === undefined) {
      return trace;
    }
    const hashInput: Pick<DenomTrace, 'path' | 'base_denom'> = {
      path: trace.path,
      base_denom: trace.base_denom,
    };
    const computedIbcDenomHash = this.computeIbcDenomHash(hashInput);
    const providedIbcDenomHash = trace.ibc_denom_hash?.toLowerCase();

    if (providedIbcDenomHash && providedIbcDenomHash !== computedIbcDenomHash) {
      throw new Error(
        `Conflicting ibc_denom_hash for hash ${trace.hash}: expected ${computedIbcDenomHash}, incoming ${providedIbcDenomHash}`,
      );
    }

    return {
      ...trace,
      ibc_denom_hash: computedIbcDenomHash,
    };
  }

  private computeIbcDenomHash(trace: Pick<DenomTrace, 'path' | 'base_denom'>): string {
    const fullPath = trace.path ? `${trace.path}/${trace.base_denom}` : trace.base_denom;
    return hashSHA256(convertString2Hex(fullPath)).toLowerCase();
  }
}
