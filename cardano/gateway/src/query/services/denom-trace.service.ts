import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TxBuilder, UTxO } from "@lucid-evolution/lucid";
import { PaginationKeyDto } from "../dtos/pagination.dto";
import { MetricsService } from "../../health/metrics.service";
import {
  convertString2Hex,
  hashSHA256,
  hashSha3_256,
} from "../../shared/helpers/hex";
import { splitFullDenomTrace } from "../../shared/helpers/denom-trace";
import { LucidService } from "../../shared/modules/lucid/lucid.service";
import {
  decodeTraceRegistryDatum,
  encodeTraceRegistryDatum,
  encodeTraceRegistryRedeemer,
  TraceRegistryDatum,
  TraceRegistryDirectoryBucket,
  TraceRegistryDirectoryDatum,
  TraceRegistryShardDatum,
} from "../../shared/types/trace-registry";

type TraceRegistryTokenConfig = {
  policyId: string;
  name: string;
};

type TraceRegistryConfig = {
  address: string;
  shardPolicyId: string;
  directory: TraceRegistryTokenConfig;
};

type OnChainTraceEntry = {
  hash: string;
  fullDenom: string;
  bucketIndex: number;
  shardUtxo?: UTxO;
  shardTokenName?: string;
  bucketShardUtxos?: UTxO[];
};

type LoadedBucketShard = {
  tokenName: string;
  tokenUnit: string;
  utxo: UTxO;
  datum: TraceRegistryShardDatum;
};

type TraceRegistryExistingProofContext = {
  kind: "existing";
  traceRegistryDirectoryUtxo: UTxO;
  traceRegistryShardWitnessUtxos: UTxO[];
};

type TraceRegistryAppendInsertContext = {
  kind: "append";
  traceRegistryDirectoryUtxo: UTxO;
  traceRegistryShardUtxo: UTxO;
  traceRegistryArchivedShardWitnessUtxos: UTxO[];
  encodedTraceRegistryRedeemer: string;
  encodedUpdatedTraceRegistryDatum: string;
};

type TraceRegistryRolloverInsertContext = {
  kind: "rollover";
  traceRegistryDirectoryUtxo: UTxO;
  traceRegistryShardUtxo: UTxO;
  traceRegistryArchivedShardWitnessUtxos: UTxO[];
  traceRegistryMintNonceUtxo: UTxO;
  encodedTraceRegistryDirectoryRedeemer: string;
  encodedUpdatedTraceRegistryDirectoryDatum: string;
  encodedTraceRegistryRedeemer: string;
  encodedArchivedTraceRegistryDatum: string;
  encodedNewActiveTraceRegistryDatum: string;
  newActiveTraceRegistryShardTokenUnit: string;
  encodedMintIdentifierRedeemer: string;
};

export type TraceRegistryInsertContext =
  | TraceRegistryExistingProofContext
  | TraceRegistryAppendInsertContext
  | TraceRegistryRolloverInsertContext;

export type ResolvedDenomTrace = {
  hash: string;
  path: string;
  base_denom: string;
  voucher_policy_id: string;
  ibc_denom_hash: string;
};

const TRACE_REGISTRY_TX_SIZE_HEADROOM_BYTES = 1024;

/**
 * Canonical resolver for Cardano voucher reverse lookups.
 *
 * The trace registry is fully on-chain. The directory UTxO is the only source of
 * truth for which shard is currently writable for each bucket, and archived
 * shard token names remain discoverable there after rollovers.
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
    opts?: { forceRollover?: boolean },
  ): Promise<TraceRegistryInsertContext> {
    const normalizedHash = hash.toLowerCase();
    const registry = this.getRequiredTraceRegistryConfig();
    const { utxo: directoryUtxo, datum: directoryDatum } = await this
      .loadDirectoryState(registry);

    // Every positive voucher mint must prove registry completeness. For a
    // previously seen hash, that means carrying the canonical directory plus the
    // shard that already holds the exact mapping.
    const existing = await this.findOnChainEntryByHash(
      normalizedHash,
      registry,
      directoryDatum,
    );
    if (existing) {
      if (existing.fullDenom !== fullDenom) {
        throw new Error(
          `Conflicting on-chain denom trace for hash ${normalizedHash}: existing=${existing.fullDenom}, incoming=${fullDenom}`,
        );
      }
      if (!existing.shardUtxo) {
        throw new Error(
          `Trace-registry proof for hash ${normalizedHash} is missing its shard witness`,
        );
      }
      return {
        kind: "existing",
        traceRegistryDirectoryUtxo: directoryUtxo,
        traceRegistryShardWitnessUtxos: existing.bucketShardUtxos ??
          [existing.shardUtxo],
      };
    }

    const bucketIndex = this.getBucketIndexForHash(normalizedHash);
    const bucket = this.getDirectoryBucket(directoryDatum, bucketIndex);
    const bucketShards = await this.loadBucketShardStates(
      registry,
      bucketIndex,
      bucket,
    );
    const activeShard = bucketShards.find((candidate) =>
      candidate.tokenName === bucket.active_shard_name
    );
    if (!activeShard) {
      throw new Error(
        `Active trace-registry shard ${bucket.active_shard_name} is missing for bucket ${bucketIndex}`,
      );
    }
    const archivedShardWitnessUtxos = bucketShards
      .filter((candidate) => candidate.tokenName !== bucket.active_shard_name)
      .map((candidate) => candidate.utxo);

    if (!opts?.forceRollover) {
      return {
        kind: "append",
        traceRegistryDirectoryUtxo: directoryUtxo,
        traceRegistryShardUtxo: activeShard.utxo,
        traceRegistryArchivedShardWitnessUtxos: archivedShardWitnessUtxos,
        encodedTraceRegistryRedeemer: encodeTraceRegistryRedeemer(
          {
            InsertTrace: {
              voucher_hash: normalizedHash,
              full_denom: fullDenom,
            },
          },
          this.lucidService.LucidImporter,
        ),
        encodedUpdatedTraceRegistryDatum: encodeTraceRegistryDatum(
          {
            Shard: {
              bucket_index: activeShard.datum.bucket_index,
              entries: [
                ...activeShard.datum.entries,
                {
                  voucher_hash: normalizedHash,
                  full_denom: fullDenom,
                },
              ],
            },
          },
          this.lucidService.LucidImporter,
        ),
      };
    }

    const nonceUtxo = await this.selectUniqueIdentifierNonce(bucket);
    const newActiveShardName = this.generateIdentifierTokenName(nonceUtxo);
    const updatedDirectory: TraceRegistryDirectoryDatum = {
      buckets: directoryDatum.buckets.map((candidate) =>
        Number(candidate.bucket_index) === bucketIndex
          ? {
            bucket_index: candidate.bucket_index,
            active_shard_name: newActiveShardName,
            archived_shard_names: [
              ...candidate.archived_shard_names,
              candidate.active_shard_name,
            ],
          }
          : candidate
      ),
    };

    return {
      kind: "rollover",
      traceRegistryDirectoryUtxo: directoryUtxo,
      traceRegistryShardUtxo: activeShard.utxo,
      traceRegistryArchivedShardWitnessUtxos: archivedShardWitnessUtxos,
      traceRegistryMintNonceUtxo: nonceUtxo,
      encodedTraceRegistryDirectoryRedeemer: encodeTraceRegistryRedeemer(
        {
          AdvanceDirectory: {
            bucket_index: BigInt(bucketIndex),
            voucher_hash: normalizedHash,
            full_denom: fullDenom,
            previous_active_shard_name: bucket.active_shard_name,
            new_active_shard_name: newActiveShardName,
          },
        },
        this.lucidService.LucidImporter,
      ),
      encodedUpdatedTraceRegistryDirectoryDatum: encodeTraceRegistryDatum(
        {
          Directory: updatedDirectory,
        },
        this.lucidService.LucidImporter,
      ),
      encodedTraceRegistryRedeemer: encodeTraceRegistryRedeemer(
        {
          RolloverInsertTrace: {
            voucher_hash: normalizedHash,
            full_denom: fullDenom,
            new_active_shard_name: newActiveShardName,
          },
        },
        this.lucidService.LucidImporter,
      ),
      encodedArchivedTraceRegistryDatum: encodeTraceRegistryDatum(
        {
          Shard: activeShard.datum,
        },
        this.lucidService.LucidImporter,
      ),
      encodedNewActiveTraceRegistryDatum: encodeTraceRegistryDatum(
        {
          Shard: {
            bucket_index: BigInt(bucketIndex),
            entries: [
              {
                voucher_hash: normalizedHash,
                full_denom: fullDenom,
              },
            ],
          },
        },
        this.lucidService.LucidImporter,
      ),
      newActiveTraceRegistryShardTokenUnit: registry.shardPolicyId +
        newActiveShardName,
      encodedMintIdentifierRedeemer: this.encodeIdentifierMintRedeemer(
        nonceUtxo,
      ),
    };
  }

  async shouldRolloverForUnsignedTx(unsignedTx: TxBuilder): Promise<boolean> {
    const maxTxSize =
      this.lucidService.lucid.config().protocolParameters?.maxTxSize ?? 16_384;

    try {
      const unsignedSize = await this.lucidService.estimateUnsignedTxSizeBytes(
        unsignedTx,
      );
      return unsignedSize >= maxTxSize - TRACE_REGISTRY_TX_SIZE_HEADROOM_BYTES;
    } catch (error) {
      if (this.isLikelyTxSizeError(error)) {
        return true;
      }
      throw error;
    }
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
      this.logger.error(
        `Failed to find denom trace by hash ${hash}: ${error.message}`,
      );
      throw error;
    } finally {
      this.observeQueryDuration("findByHash", startTime);
    }
  }

  async findAll(pagination?: PaginationKeyDto): Promise<ResolvedDenomTrace[]> {
    const startTime = Date.now();

    try {
      const traces = (await this.findAllOnChainEntries())
        .map((entry) => this.materializeTrace(entry.hash, entry.fullDenom))
        .sort((left, right) => {
          const leftFullDenom = left.path
            ? `${left.path}/${left.base_denom}`
            : left.base_denom;
          const rightFullDenom = right.path
            ? `${right.path}/${right.base_denom}`
            : right.base_denom;
          return leftFullDenom.localeCompare(rightFullDenom) ||
            left.hash.localeCompare(right.hash);
        });

      const offset = pagination?.offset ?? 0;
      return traces.slice(offset, offset + 100);
    } catch (error) {
      this.logger.error(`Failed to find all denom traces: ${error.message}`);
      throw error;
    } finally {
      this.observeQueryDuration("findAll", startTime);
    }
  }

  async findByIbcDenomHash(
    denomHash: string,
  ): Promise<ResolvedDenomTrace | null> {
    const startTime = Date.now();

    try {
      const normalizedHash = denomHash.toLowerCase();
      const onChainEntries = await this.findAllOnChainEntries();
      const match = onChainEntries.find((entry) => {
        return this.computeIbcDenomHashFromFullDenom(entry.fullDenom) ===
          normalizedHash;
      });
      if (!match) {
        return null;
      }
      return this.materializeTrace(match.hash, match.fullDenom);
    } catch (error) {
      this.logger.error(
        `Failed to find denom trace by ibc hash ${denomHash}: ${error.message}`,
      );
      throw error;
    } finally {
      this.observeQueryDuration("findByIbcDenomHash", startTime);
    }
  }

  async findByBaseDenom(baseDenom: string): Promise<ResolvedDenomTrace[]> {
    const startTime = Date.now();

    try {
      const traces = await this.findAll();
      return traces.filter((trace) => trace.base_denom === baseDenom);
    } catch (error) {
      this.logger.error(
        `Failed to find denom traces by base denom ${baseDenom}: ${error.message}`,
      );
      throw error;
    } finally {
      this.observeQueryDuration("findByBaseDenom", startTime);
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
    this.metricsService?.denomTraceQueryDuration.observe(
      { operation },
      duration,
    );
  }

  private getTraceRegistryConfig(): TraceRegistryConfig | null {
    const deployment = this.configService.get("deployment") as {
      traceRegistry?: TraceRegistryConfig;
    } | undefined;
    if (
      !deployment?.traceRegistry?.address || !deployment.traceRegistry.directory
    ) {
      return null;
    }
    return deployment.traceRegistry;
  }

  private getRequiredTraceRegistryConfig(): TraceRegistryConfig {
    const registry = this.getTraceRegistryConfig();
    if (!registry) {
      throw new Error(
        "Trace registry deployment config is missing",
      );
    }
    return registry;
  }

  private getVoucherPolicyId(): string {
    return this.configService.get("deployment").validators.mintVoucher
      .scriptHash;
  }

  private getBucketIndexForHash(hash: string): number {
    if (!/^[0-9a-f]{64}$/i.test(hash)) {
      throw new Error(
        `Invalid voucher hash for trace-registry lookup: ${hash}`,
      );
    }
    return parseInt(hash[0], 16);
  }

  private getMaxTxSize(): number {
    return this.lucidService.lucid.config().protocolParameters?.maxTxSize ??
      16_384;
  }

  private async findOnChainEntryByHash(
    hash: string,
    registryArg?: TraceRegistryConfig,
    directoryArg?: TraceRegistryDirectoryDatum,
  ): Promise<OnChainTraceEntry | null> {
    const registry = registryArg ?? this.getRequiredTraceRegistryConfig();

    const directoryDatum = directoryArg ?? await this.loadDirectoryDatum(registry);
    const bucketIndex = this.getBucketIndexForHash(hash);
    const bucket = this.getDirectoryBucket(directoryDatum, bucketIndex);
    const bucketShards = await this.loadBucketShardStates(
      registry,
      bucketIndex,
      bucket,
    );
    const matches = bucketShards.flatMap((shard) =>
      shard.datum.entries
        .filter((candidate) =>
          candidate.voucher_hash.toLowerCase() === hash.toLowerCase()
        )
        .map((entry) => ({
          entry,
          shard,
        }))
    );

    if (matches.length > 1) {
      throw new Error(
        `Duplicate trace-registry entries detected for hash ${hash.toLowerCase()} in bucket ${bucketIndex}`,
      );
    }
    if (matches.length === 1) {
      const [{ entry, shard }] = matches;
      return {
        hash: entry.voucher_hash.toLowerCase(),
        fullDenom: entry.full_denom,
        bucketIndex,
        shardUtxo: shard.utxo,
        shardTokenName: shard.tokenName,
        bucketShardUtxos: bucketShards.map((candidate) => candidate.utxo),
      };
    }

    return null;
  }

  private async findAllOnChainEntries(): Promise<OnChainTraceEntry[]> {
    const registry = this.getRequiredTraceRegistryConfig();

    const directory = await this.loadDirectoryDatum(registry);
    const shardEntries = await Promise.all(
      directory.buckets.map(async (bucket) => {
        const shards = await this.loadBucketShardStates(
          registry,
          Number(bucket.bucket_index),
          bucket,
        );

        return shards.flatMap((shard) =>
          shard.datum.entries.map((entry) => ({
            hash: entry.voucher_hash.toLowerCase(),
            fullDenom: entry.full_denom,
            bucketIndex: Number(bucket.bucket_index),
          }))
        );
      }),
    );
    const entries = shardEntries.flat();
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.hash)) {
        throw new Error(
          `Duplicate trace-registry entries detected for hash ${entry.hash}`,
        );
      }
      seen.add(entry.hash);
    }

    return entries;
  }

  private async loadBucketShardStates(
    registry: TraceRegistryConfig,
    bucketIndex: number,
    bucket: TraceRegistryDirectoryBucket,
  ): Promise<LoadedBucketShard[]> {
    const tokenNames = [
      bucket.active_shard_name,
      ...bucket.archived_shard_names,
    ];
    const uniqueTokenNames = [...new Set(tokenNames)];

    return await Promise.all(
      uniqueTokenNames.map(async (tokenName) => {
        const tokenUnit = registry.shardPolicyId + tokenName;
        const utxo = await this.lucidService.findUtxoByUnit(tokenUnit);
        return {
          tokenName,
          tokenUnit,
          utxo,
          datum: this.loadShardDatumFromUtxo(
            utxo,
            bucketIndex,
            tokenUnit,
          ),
        };
      }),
    );
  }

  private async loadDirectoryState(
    registry: TraceRegistryConfig,
  ): Promise<{ utxo: UTxO; datum: TraceRegistryDirectoryDatum }> {
    const directoryUnit = registry.directory.policyId + registry.directory.name;
    const directoryUtxo = await this.lucidService.findUtxoByUnit(directoryUnit);
    if (!directoryUtxo.datum) {
      throw new Error("Trace-registry directory is missing inline datum");
    }

    const decoded = decodeTraceRegistryDatum(
      directoryUtxo.datum,
      this.lucidService.LucidImporter,
    );
    if (!("Directory" in decoded)) {
      throw new Error(
        "Trace-registry directory UTxO does not carry a directory datum",
      );
    }

    return {
      utxo: directoryUtxo,
      datum: decoded.Directory,
    };
  }

  private async loadDirectoryDatum(
    registry: TraceRegistryConfig,
  ): Promise<TraceRegistryDirectoryDatum> {
    return (await this.loadDirectoryState(registry)).datum;
  }

  private getDirectoryBucket(
    directory: TraceRegistryDirectoryDatum,
    bucketIndex: number,
  ): TraceRegistryDirectoryBucket {
    const bucket = directory.buckets.find((candidate) =>
      Number(candidate.bucket_index) === bucketIndex
    );
    if (!bucket) {
      throw new Error(`Missing trace-registry directory bucket ${bucketIndex}`);
    }
    return bucket;
  }

  private async loadShardDatumByUnit(
    unit: string,
    expectedBucketIndex: number,
  ) {
    const shardUtxo = await this.lucidService.findUtxoByUnit(unit);
    return this.loadShardDatumFromUtxo(shardUtxo, expectedBucketIndex, unit);
  }

  private loadShardDatumFromUtxo(
    shardUtxo: UTxO,
    expectedBucketIndex: number,
    unit: string,
  ) {
    if (!shardUtxo.datum) {
      throw new Error(`Trace-registry shard ${unit} is missing inline datum`);
    }

    const decoded = decodeTraceRegistryDatum(
      shardUtxo.datum,
      this.lucidService.LucidImporter,
    );
    if (!("Shard" in decoded)) {
      throw new Error(
        `Trace-registry shard ${unit} does not carry a shard datum`,
      );
    }
    if (Number(decoded.Shard.bucket_index) !== expectedBucketIndex) {
      throw new Error(
        `Trace-registry shard datum mismatch: expected bucket ${expectedBucketIndex}, found ${decoded.Shard.bucket_index.toString()}`,
      );
    }
    return decoded.Shard;
  }

  private materializeTrace(
    hash: string,
    fullDenom: string,
  ): ResolvedDenomTrace {
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

  private computeVoucherHashFromFullDenom(fullDenom: string): string {
    return hashSha3_256(convertString2Hex(fullDenom)).toLowerCase();
  }

  private async selectUniqueIdentifierNonce(
    bucket: TraceRegistryDirectoryBucket,
  ): Promise<UTxO> {
    const walletUtxos = await this.lucidService.lucid.wallet().getUtxos();
    if (walletUtxos.length === 0) {
      throw new Error(
        "Trace-registry rollover requires a selected wallet with at least one spendable UTxO",
      );
    }

    const reserved = new Set(
      [bucket.active_shard_name, ...bucket.archived_shard_names].map((name) =>
        name.toLowerCase()
      ),
    );
    const candidate = walletUtxos.find((utxo) =>
      !reserved.has(this.generateIdentifierTokenName(utxo).toLowerCase())
    );
    if (!candidate) {
      throw new Error(
        "Unable to derive a fresh trace-registry shard identifier from the selected wallet UTxOs",
      );
    }
    return candidate;
  }

  private generateIdentifierTokenName(utxo: UTxO): string {
    const { Data } = this.lucidService.LucidImporter;
    const OutputReferenceSchema = Data.Object({
      transaction_id: Data.Bytes(),
      output_index: Data.Integer(),
    });

    // The identifier policy hashes the non-canonical OutputReference CBOR bytes,
    // so we must mirror that exact encoding here instead of using canonical CBOR.
    const serialized = Data.to(
      {
        transaction_id: utxo.txHash,
        output_index: BigInt(utxo.outputIndex),
      },
      OutputReferenceSchema as unknown as {
        transaction_id: string;
        output_index: bigint;
      },
    );

    return hashSha3_256(serialized);
  }

  private encodeIdentifierMintRedeemer(utxo: UTxO): string {
    const { Data } = this.lucidService.LucidImporter;
    const OutputReferenceSchema = Data.Object({
      transaction_id: Data.Bytes(),
      output_index: Data.Integer(),
    });

    return Data.to(
      {
        transaction_id: utxo.txHash,
        output_index: BigInt(utxo.outputIndex),
      },
      OutputReferenceSchema as unknown as {
        transaction_id: string;
        output_index: bigint;
      },
    );
  }

  private isLikelyTxSizeError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();

    return [
      "max transaction size",
      "maximum transaction size",
      "transaction too large",
      "max tx size",
      "tx too large",
      "maximum transaction size exceeded",
    ].some((pattern) => normalized.includes(pattern));
  }
}
