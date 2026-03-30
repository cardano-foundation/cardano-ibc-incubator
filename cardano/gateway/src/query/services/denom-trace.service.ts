import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UTxO } from '@lucid-evolution/lucid';
import { PaginationKeyDto } from '../dtos/pagination.dto';
import { MetricsService } from '../../health/metrics.service';
import { convertString2Hex, hashSHA256 } from '../../shared/helpers/hex';
import { splitFullDenomTrace } from '../../shared/helpers/denom-trace';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import {
  decodeTraceRegistryShardDatum,
  encodeTraceRegistryRedeemer,
  encodeTraceRegistryShardDatum,
  TraceRegistryShardDatum,
} from '../../shared/types/trace-registry';

type TraceRegistryShardConfig = {
  index: number;
  policyId: string;
  name: string;
};

type TraceRegistryConfig = {
  address: string;
  shardPolicyId: string;
  shards: TraceRegistryShardConfig[];
};

export type TraceRegistryInsertContext = {
  traceRegistryShardUtxo: UTxO;
  encodedTraceRegistryRedeemer: string;
  encodedUpdatedTraceRegistryShardDatum: string;
};

export type ResolvedDenomTrace = {
  hash: string;
  path: string;
  base_denom: string;
  voucher_policy_id: string;
  ibc_denom_hash: string;
};

/**
 * Canonical resolver for Cardano voucher reverse lookups.
 *
 * This service no longer treats the Gateway database as a source of truth. The
 * only authoritative mapping is the on-chain trace-registry shard set, and every
 * read path derives user-facing fields from those shard datums.
 *
 * Important consequences:
 * - `voucher_hash -> full_denom` is the canonical stored mapping
 * - `ibc/<hash>` is derived off-chain from `full_denom`, not stored separately
 */
@Injectable()
export class DenomTraceService {
  constructor(
    private readonly logger: Logger,
    private readonly configService: ConfigService,
    private readonly lucidService: LucidService,
    @Optional() @Inject(MetricsService) private metricsService?: MetricsService,
  ) {}

  async prepareOnChainInsert(
    hash: string,
    fullDenom: string,
  ): Promise<TraceRegistryInsertContext | null> {
    const normalizedHash = hash.toLowerCase();
    const registry = this.getTraceRegistryConfig();
    if (!registry) {
      return null;
    }

    // The on-chain registry is append-only. If the mapping already exists we do
    // not touch any shard UTxO, but we still reject conflicting rewrites. That
    // lets every voucher mint path ask for "insert if first-seen" without having
    // to predict ahead of time whether the shard already contains the mapping.
    const existing = await this.findOnChainEntryByHash(normalizedHash);
    if (existing) {
      if (existing.fullDenom !== fullDenom) {
        throw new Error(
          `Conflicting on-chain denom trace for hash ${normalizedHash}: existing=${existing.fullDenom}, incoming=${fullDenom}`,
        );
      }
      return null;
    }

    const shardIndex = this.getShardIndexForHash(normalizedHash);
    const shardConfig = registry.shards.find((shard) => shard.index === shardIndex);
    if (!shardConfig) {
      throw new Error(`Missing trace-registry shard config for index ${shardIndex}`);
    }

    // Build the update from the live shard datum so the spending input and the
    // replacement datum are derived from the same on-chain state snapshot. We do
    // not synthesize shard contents from cached/off-chain state.
    const shardDatum = await this.loadShardDatum(shardConfig);
    if (Number(shardDatum.shard_index) !== shardIndex) {
      throw new Error(
        `Trace-registry shard datum mismatch: expected ${shardIndex}, found ${shardDatum.shard_index.toString()}`,
      );
    }

    const duplicate = shardDatum.entries.find((entry) => entry.voucher_hash.toLowerCase() === normalizedHash);
    if (duplicate) {
      if (duplicate.full_denom !== fullDenom) {
        throw new Error(
          `Conflicting trace-registry datum for hash ${normalizedHash}: existing=${duplicate.full_denom}, incoming=${fullDenom}`,
        );
      }
      return null;
    }

    const shardUnit = shardConfig.policyId + shardConfig.name;
    const shardUtxo = await this.lucidService.findUtxoByUnit(shardUnit);
    if (!shardUtxo.datum) {
      throw new Error(`Trace-registry shard ${shardIndex} is missing inline datum`);
    }

    const updatedDatum: TraceRegistryShardDatum = {
      shard_index: shardDatum.shard_index,
      entries: [
        ...shardDatum.entries,
        {
          voucher_hash: normalizedHash,
          full_denom: fullDenom,
        },
      ],
    };

    return {
      traceRegistryShardUtxo: shardUtxo,
      encodedTraceRegistryRedeemer: encodeTraceRegistryRedeemer(
        {
          InsertTrace: {
            voucher_hash: normalizedHash,
            full_denom: fullDenom,
          },
        },
        this.lucidService.LucidImporter,
      ),
      encodedUpdatedTraceRegistryShardDatum: encodeTraceRegistryShardDatum(
        updatedDatum,
        this.lucidService.LucidImporter,
      ),
    };
  }

  async findByHash(hash: string): Promise<ResolvedDenomTrace | null> {
    const startTime = Date.now();

    try {
      const normalizedHash = hash.toLowerCase();
      const onChainEntry = await this.findOnChainEntryByHash(normalizedHash);
      if (!onChainEntry) {
        return null;
      }
      return this.materializeTrace(onChainEntry.hash, onChainEntry.fullDenom);
    } catch (error) {
      this.logger.error(`Failed to find denom trace by hash ${hash}: ${error.message}`);
      throw error;
    } finally {
      this.observeQueryDuration('findByHash', startTime);
    }
  }

  async findAll(pagination?: PaginationKeyDto): Promise<ResolvedDenomTrace[]> {
    const startTime = Date.now();

    try {
      const traces = (await this.findAllOnChainEntries())
        .map((entry) => this.materializeTrace(entry.hash, entry.fullDenom))
        .sort((left, right) => {
          const leftFullDenom = left.path ? `${left.path}/${left.base_denom}` : left.base_denom;
          const rightFullDenom = right.path ? `${right.path}/${right.base_denom}` : right.base_denom;
          return leftFullDenom.localeCompare(rightFullDenom) || left.hash.localeCompare(right.hash);
        });

      const offset = pagination?.offset ?? 0;
      return traces.slice(offset, offset + 100);
    } catch (error) {
      this.logger.error(`Failed to find all denom traces: ${error.message}`);
      throw error;
    } finally {
      this.observeQueryDuration('findAll', startTime);
    }
  }

  async findByIbcDenomHash(denomHash: string): Promise<ResolvedDenomTrace | null> {
    const startTime = Date.now();

    try {
      const normalizedHash = denomHash.toLowerCase();
      // `ibc/<hash>` is a derived lookup. The canonical stored mapping remains
      // voucher-hash -> full denom, and we derive the standard ICS-20 hash here
      // to avoid maintaining two mutable indices for the same underlying trace.
      const onChainEntries = await this.findAllOnChainEntries();
      const match = onChainEntries.find((entry) => {
        return this.computeIbcDenomHashFromFullDenom(entry.fullDenom) === normalizedHash;
      });
      if (!match) {
        return null;
      }
      return this.materializeTrace(match.hash, match.fullDenom);
    } catch (error) {
      this.logger.error(`Failed to find denom trace by ibc hash ${denomHash}: ${error.message}`);
      throw error;
    } finally {
      this.observeQueryDuration('findByIbcDenomHash', startTime);
    }
  }

  async findByBaseDenom(baseDenom: string): Promise<ResolvedDenomTrace[]> {
    const startTime = Date.now();

    try {
      const traces = await this.findAll();
      return traces.filter((trace) => trace.base_denom === baseDenom);
    } catch (error) {
      this.logger.error(`Failed to find denom traces by base denom ${baseDenom}: ${error.message}`);
      throw error;
    } finally {
      this.observeQueryDuration('findByBaseDenom', startTime);
    }
  }

  async getCount(): Promise<number> {
    try {
      return (await this.findAllOnChainEntries()).length;
    } catch (error) {
      this.logger.error(`Failed to get denom trace count: ${error.message}`);
      throw error;
    }
  }

  private observeQueryDuration(operation: string, startTime: number): void {
    const duration = (Date.now() - startTime) / 1000;
    this.metricsService?.denomTraceQueryDuration.observe({ operation }, duration);
  }

  private getTraceRegistryConfig(): TraceRegistryConfig | null {
    // Hard cutover invariant: there is no DB fallback for denom traces anymore.
    // Missing deployment config is therefore a configuration error, not a signal
    // to silently revive an older off-chain lookup path.
    const deployment = this.configService.get('deployment') as { traceRegistry?: TraceRegistryConfig } | undefined;
    if (!deployment?.traceRegistry?.address || !deployment.traceRegistry.shards?.length) {
      return null;
    }
    return deployment.traceRegistry;
  }

  private getVoucherPolicyId(): string {
    return this.configService.get('deployment').validators.mintVoucher.scriptHash;
  }

  private getShardIndexForHash(hash: string): number {
    if (!/^[0-9a-f]{64}$/i.test(hash)) {
      throw new Error(`Invalid voucher hash for trace-registry lookup: ${hash}`);
    }
    return parseInt(hash[0], 16);
  }

  private async findOnChainEntryByHash(
    hash: string,
  ): Promise<{ hash: string; fullDenom: string; shardIndex: number } | null> {
    const registry = this.getTraceRegistryConfig();
    if (!registry) {
      return null;
    }

    const shardIndex = this.getShardIndexForHash(hash);
    const shardConfig = registry.shards.find((shard) => shard.index === shardIndex);
    if (!shardConfig) {
      return null;
    }

    const shardDatum = await this.loadShardDatum(shardConfig);
    const entry = shardDatum.entries.find((candidate) => candidate.voucher_hash.toLowerCase() === hash.toLowerCase());
    if (!entry) {
      return null;
    }

    return {
      hash: entry.voucher_hash.toLowerCase(),
      fullDenom: entry.full_denom,
      shardIndex,
    };
  }

  private async findAllOnChainEntries(): Promise<Array<{ hash: string; fullDenom: string; shardIndex: number }>> {
    const registry = this.getTraceRegistryConfig();
    if (!registry) {
      return [];
    }

    // Read every shard live because the registry is small, append-only, and the
    // query layer must not guess which shard changed from off-chain events alone.
    const shardEntries = await Promise.all(
      registry.shards.map(async (shard) => {
        const datum = await this.loadShardDatum(shard);
        return datum.entries.map((entry) => ({
          hash: entry.voucher_hash.toLowerCase(),
          fullDenom: entry.full_denom,
          shardIndex: shard.index,
        }));
      }),
    );

    return shardEntries.flat();
  }

  private async loadShardDatum(shard: TraceRegistryShardConfig): Promise<TraceRegistryShardDatum> {
    const shardUnit = shard.policyId + shard.name;
    const shardUtxo = await this.lucidService.findUtxoByUnit(shardUnit);
    if (!shardUtxo.datum) {
      throw new Error(`Trace-registry shard ${shard.index} is missing inline datum`);
    }
    return decodeTraceRegistryShardDatum(shardUtxo.datum, this.lucidService.LucidImporter);
  }

  private materializeTrace(hash: string, fullDenom: string): ResolvedDenomTrace {
    const trace = splitFullDenomTrace(fullDenom);
    return {
      hash: hash.toLowerCase(),
      path: trace.path,
      base_denom: trace.baseDenom,
      voucher_policy_id: this.getVoucherPolicyId(),
      ibc_denom_hash: this.computeIbcDenomHashFromFullDenom(fullDenom),
    };
  }

  private computeIbcDenomHashFromFullDenom(fullDenom: string): string {
    return hashSHA256(convertString2Hex(fullDenom)).toLowerCase();
  }
}
