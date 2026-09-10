import { InjectEntityManager } from "@nestjs/typeorm";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EntityManager } from "typeorm";
import { bech32 } from "bech32";
import { GrpcNotFoundException } from "~@/exception/grpc_exceptions";
import { CLIENT_PREFIX } from "../../constant";
import {
  queryCurrentEpochStakeDistribution,
  queryCurrentEpochVerificationData,
  queryEpochContextAtPoint,
  queryOperationalCertificateCountersAtPoint,
} from "../../shared/helpers/ogmios";
import { LucidService } from "../../shared/modules/lucid/lucid.service";
import { BoundedCache } from "../../shared/helpers/bounded-cache";
import { MetricsService } from "../../health/metrics.service";
import { UtxoDto } from "../dtos/utxo.dto";
import { TxDto } from "../dtos/tx.dto";
import {
  HistoryBlock,
  HistoryEpochContextAtBlock,
  HistoryEpochVerificationContext,
  HistoryService,
  HistoryStakeDistributionEntry,
  HistoryTxEvidence,
  HistoryTxRedeemer,
} from "./history.service";

type BridgeUtxoHistoryRow = {
  address: string;
  tx_hash: string;
  tx_id?: string | number;
  output_index: string | number;
  datum?: string | null;
  datum_hash?: string | null;
  assets_policy: string;
  assets_name: string;
  block_no: string | number;
  block_id?: string | number;
};

type BridgeTxHistoryRow = {
  tx_hash: string;
  tx_id?: string | number;
  gas_fee: string | number;
  tx_size: string | number;
  block_no: string | number;
  block_hash?: string | null;
  slot_no?: string | number | null;
  tx_index?: string | number | null;
};

type BridgeTxEvidenceRow = {
  tx_hash: string;
  block_no: string | number;
  block_hash?: string | null;
  slot_no?: string | number | null;
  tx_index: string | number;
  tx_cbor_hex: string;
  tx_body_cbor_hex: string;
  redeemers_json: HistoryTxRedeemer[] | null;
  host_state_output_index?: string | number | null;
  host_state_datum?: string | null;
  host_state_datum_hash?: string | null;
  host_state_root?: string | null;
  gas_fee?: string | number | null;
  tx_size?: string | number | null;
};

type HistoryBlockRow = {
  number: string | number;
  hash: string;
  prev_hash: string;
  slot: string | number;
  epoch: string | number;
  block_time: string | Date;
  slot_leader?: string | null;
};

type EpochStartSlotRow = {
  start_slot: string | number | null;
};

type PoolRegistrationSlotRow = {
  pool_id: string;
  first_registration_slot: string | number;
};

type CachedPoolRegistrationRow = {
  pool_id: string;
  first_registration_slot: string | number | null;
};

function getAssumedPoolRegistrationSlot(): bigint | undefined {
  const configuredSlot =
    process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT;
  return configuredSlot ? BigInt(configuredSlot) : undefined;
}

type KoiosPoolUpdateRow = {
  tx_hash?: string | null;
  block_time?: string | number | null;
  pool_id_bech32?: string | null;
  pool_id_hex?: string | null;
  active_epoch_no?: string | number | null;
  vrf_key_hash?: string | null;
  update_type?: string | null;
};

type KoiosEpochParamsRow = {
  epoch_no?: string | number | null;
  nonce?: string | null;
};

type KoiosEpochInfoRow = {
  epoch_no?: string | number | null;
  active_stake?: string | number | null;
  blk_count?: string | number | null;
};

type KoiosPoolHistoryRow = {
  epoch_no?: string | number | null;
  active_stake?: string | number | null;
};

type KoiosTipRow = {
  epoch_no?: string | number | null;
};

type KoiosPoolListRow = {
  pool_id_bech32?: string | null;
  pool_id_hex?: string | null;
  active_stake?: string | number | null;
};

type HistoricalEpochProducerSummaryRow = {
  block_count?: string | number | null;
  pool_ids?: string[] | null;
};

type KoiosRequestHeaders = {
  accept: string;
  Authorization?: string;
};

const CARDANO_SLOT_LENGTH_NS = 1_000_000_000n;
const POOL_REGISTRATION_LOOKUP_BATCH_SIZE = 25;
const POOL_REGISTRATION_LOOKUP_TIMEOUT_MS = 10_000;
const EPOCH_PARAMS_LOOKUP_TIMEOUT_MS = 10_000;
const EPOCH_PARAMS_LOOKUP_MAX_ATTEMPTS = 3;
const EPOCH_PARAMS_RETRY_BASE_DELAY_MS = 250;
const EPOCH_PARAMS_RETRY_MAX_DELAY_MS = 5_000;
export const EPOCH_PARAMS_CACHE_MAX_ENTRIES = 128;
export const EPOCH_LOOKUP_MAX_ENTRIES = 64;
export const HISTORICAL_EPOCH_CONTEXT_CACHE_MAX_ENTRIES = 16;
export const CURRENT_EPOCH_STAKE_SNAPSHOT_CACHE_MAX_ENTRIES = 2;
const HISTORICAL_STAKE_LOOKUP_TIMEOUT_MS = 30_000;
const HISTORICAL_STAKE_LOOKUP_MAX_ATTEMPTS = 3;
const HISTORICAL_STAKE_RETRY_DELAY_MS = 10_000;
const HISTORICAL_STAKE_RETRY_MAX_DELAY_MS = 30_000;
const HISTORICAL_STAKE_POOL_CONCURRENCY = 20;
const HISTORICAL_STAKE_REMAINDER_POOL_PREFIX =
  "__historical_unproduced_stake__";
const CURRENT_EPOCH_STAKE_PAGE_SIZE = 1_000;
const CURRENT_EPOCH_STAKE_MAX_PAGES = 10;

const EPOCH_NONCE_CACHE_METRIC = "epoch_nonce";
const EPOCH_NONCE_LOOKUPS_METRIC = "epoch_nonce_lookups";
const HISTORICAL_EPOCH_CONTEXT_CACHE_METRIC = "historical_epoch_context";
const HISTORICAL_EPOCH_CONTEXT_LOOKUPS_METRIC =
  "historical_epoch_context_lookups";
const CURRENT_EPOCH_STAKE_SNAPSHOT_CACHE_METRIC =
  "current_epoch_stake_snapshot";
const CURRENT_EPOCH_STAKE_SNAPSHOT_LOOKUPS_METRIC =
  "current_epoch_stake_snapshot_lookups";

class EpochParamsLookupError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "EpochParamsLookupError";
  }
}

class HistoricalStakeLookupError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "HistoricalStakeLookupError";
  }
}

@Injectable()
export class YaciHistoryService implements HistoryService {
  private poolRegistrationCacheTableReady = false;
  private readonly epochNonceCache: BoundedCache<string, string>;
  private readonly epochNonceLookups: BoundedCache<string, Promise<string>>;
  private readonly historicalEpochContextCache: BoundedCache<
    string,
    HistoryEpochContextAtBlock
  >;
  private readonly historicalEpochContextLookups: BoundedCache<
    string,
    Promise<HistoryEpochContextAtBlock>
  >;
  private readonly currentEpochStakeSnapshotCache: BoundedCache<
    string,
    HistoryStakeDistributionEntry[]
  >;
  private readonly currentEpochStakeSnapshotLookups: BoundedCache<
    string,
    Promise<HistoryStakeDistributionEntry[]>
  >;

  constructor(
    private readonly configService: ConfigService,
    @Inject(LucidService) private readonly lucidService: LucidService,
    @InjectEntityManager("history") private readonly entityManager:
      EntityManager,
    @Optional() @Inject(MetricsService) metricsService?: MetricsService,
  ) {
    const cache = <Value>(
      maxEntries: number,
      metric: string,
    ): BoundedCache<string, Value> =>
      new BoundedCache({
        maxEntries,
        onSizeChange: (size) => metricsService?.setCacheEntries(metric, size),
      });

    this.epochNonceCache = cache(
      EPOCH_PARAMS_CACHE_MAX_ENTRIES,
      EPOCH_NONCE_CACHE_METRIC,
    );
    this.epochNonceLookups = cache(
      EPOCH_LOOKUP_MAX_ENTRIES,
      EPOCH_NONCE_LOOKUPS_METRIC,
    );
    this.historicalEpochContextCache = cache(
      HISTORICAL_EPOCH_CONTEXT_CACHE_MAX_ENTRIES,
      HISTORICAL_EPOCH_CONTEXT_CACHE_METRIC,
    );
    this.historicalEpochContextLookups = cache(
      EPOCH_LOOKUP_MAX_ENTRIES,
      HISTORICAL_EPOCH_CONTEXT_LOOKUPS_METRIC,
    );
    this.currentEpochStakeSnapshotCache = cache(
      CURRENT_EPOCH_STAKE_SNAPSHOT_CACHE_MAX_ENTRIES,
      CURRENT_EPOCH_STAKE_SNAPSHOT_CACHE_METRIC,
    );
    this.currentEpochStakeSnapshotLookups = cache(
      EPOCH_LOOKUP_MAX_ENTRIES,
      CURRENT_EPOCH_STAKE_SNAPSHOT_LOOKUPS_METRIC,
    );
  }

  private koiosRequestHeaders(): KoiosRequestHeaders {
    const apiKey = this.configService.get<string>("cardanoKoiosApiKey")?.trim();
    if (!apiKey) {
      return { accept: "application/json" };
    }

    return {
      accept: "application/json",
      Authorization: /^Bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`,
    };
  }

  async findUtxosByPolicyIdAndPrefixTokenName(
    policyId: string,
    prefixTokenName: string,
  ): Promise<UtxoDto[]> {
    const query = `
      SELECT
        address,
        tx_hash,
        tx_id,
        output_index,
        datum,
        datum_hash,
        assets_policy,
        assets_name,
        block_no,
        block_id
      FROM bridge_utxo_history
      WHERE assets_policy = $1
        AND position(lower($2) in lower(assets_name)) > 0
      ORDER BY block_no DESC, COALESCE(tx_index, 0) DESC, output_index DESC
    `;
    const rows = await this.entityManager.query(query, [
      policyId,
      prefixTokenName,
    ]);
    return rows.map((row: BridgeUtxoHistoryRow) => this.mapUtxoRow(row));
  }

  async findUtxosByBlockNo(height: number): Promise<UtxoDto[]> {
    const query = `
      SELECT
        address,
        tx_hash,
        tx_id,
        output_index,
        datum,
        datum_hash,
        assets_policy,
        assets_name,
        block_no,
        block_id
      FROM bridge_utxo_history
      WHERE block_no = $1
      ORDER BY output_index ASC
    `;
    const rows = await this.entityManager.query(query, [height]);
    return rows.map((row: BridgeUtxoHistoryRow) => this.mapUtxoRow(row));
  }

  async findUtxoByUnitAtOrBeforeBlockNo(
    unit: string,
    height: bigint,
  ): Promise<UtxoDto> {
    const policyId = unit.slice(0, 56).toLowerCase();
    const assetName = unit.slice(56).toLowerCase();
    if (!policyId || !assetName) {
      throw new GrpcNotFoundException(
        `Not found: invalid asset unit for historical UTxO lookup`,
      );
    }

    const query = `
      SELECT
        address,
        tx_hash,
        tx_id,
        output_index,
        datum,
        datum_hash,
        assets_policy,
        assets_name,
        block_no,
        block_id
      FROM bridge_utxo_history
      WHERE block_no <= $1
        AND lower(assets_policy) = $2
        AND lower(assets_name) = $3
      ORDER BY block_no DESC, COALESCE(tx_index, 0) DESC, output_index DESC
      LIMIT 1
    `;
    const rows = await this.entityManager.query(query, [
      height.toString(),
      policyId,
      assetName,
    ]);
    if (rows.length <= 0) {
      throw new GrpcNotFoundException(
        `Not found: UTxO ${unit} not found at or before height ${height.toString()}`,
      );
    }

    return this.mapUtxoRow(rows[0]);
  }

  async findHostStateUtxoAtOrBeforeBlockNo(height: bigint): Promise<UtxoDto> {
    const query = `
      SELECT
        address,
        tx_hash,
        tx_id,
        output_index,
        datum,
        datum_hash,
        assets_policy,
        assets_name,
        block_no,
        block_id
      FROM bridge_utxo_history
      WHERE block_no <= $1
        AND assets_policy = $2
        AND assets_name = $3
      ORDER BY block_no DESC, COALESCE(tx_index, 0) DESC, output_index DESC
      LIMIT 1
    `;

    const deploymentConfig = this.configService.get("deployment");
    const hostStateNFT = deploymentConfig.hostStateNFT;
    const rows = await this.entityManager.query(query, [
      height.toString(),
      hostStateNFT.policyId,
      hostStateNFT.name,
    ]);
    if (rows.length <= 0) {
      throw new GrpcNotFoundException(
        `Not found: HostState UTxO not found at or before height ${height.toString()}`,
      );
    }

    return this.mapUtxoRow(rows[0]);
  }

  async findLatestBlock(): Promise<HistoryBlock | null> {
    const query = `
      SELECT
        number,
        hash,
        prev_hash,
        slot,
        epoch,
        block_time,
        slot_leader
      FROM block
      ORDER BY number DESC
      LIMIT 1
    `;
    const rows = await this.entityManager.query(query);
    return rows[0] ? this.mapHistoryBlockRow(rows[0]) : null;
  }

  async findBlockByHeight(height: bigint): Promise<HistoryBlock | null> {
    const query = `
      SELECT
        number,
        hash,
        prev_hash,
        slot,
        epoch,
        block_time,
        slot_leader
      FROM block
      WHERE number = $1
      LIMIT 1
    `;
    const rows = await this.entityManager.query(query, [height.toString()]);
    return rows[0] ? this.mapHistoryBlockRow(rows[0]) : null;
  }

  async findBridgeBlocks(
    trustedHeight: bigint,
    anchorHeight: bigint,
  ): Promise<HistoryBlock[]> {
    const query = `
      SELECT
        number,
        hash,
        prev_hash,
        slot,
        epoch,
        block_time,
        slot_leader
      FROM block
      WHERE number > $1
        AND number < $2
      ORDER BY number ASC
    `;
    const rows = await this.entityManager.query(query, [
      trustedHeight.toString(),
      anchorHeight.toString(),
    ]);
    return rows.map((row: HistoryBlockRow) => this.mapHistoryBlockRow(row));
  }

  async findDescendantBlocks(
    anchorHeight: bigint,
    limit: number,
  ): Promise<HistoryBlock[]> {
    const query = `
      SELECT
        number,
        hash,
        prev_hash,
        slot,
        epoch,
        block_time,
        slot_leader
      FROM block
      WHERE number > $1
      ORDER BY number ASC
      LIMIT $2
    `;
    const rows = await this.entityManager.query(query, [
      anchorHeight.toString(),
      limit,
    ]);
    return rows.map((row: HistoryBlockRow) => this.mapHistoryBlockRow(row));
  }

  async findEpochContextAtBlock(
    block: HistoryBlock,
  ): Promise<HistoryEpochContextAtBlock | null> {
    const slotBounds = await this.findEpochSlotBounds(block.epochNo);
    if (!slotBounds) {
      return null;
    }

    const ogmiosEndpoint = this.configService.get<string>("ogmiosEndpoint");
    if (!ogmiosEndpoint) {
      return null;
    }
    const epochNonce = await this.fetchEpochNonce(block.epochNo);

    const queryEpochContext = async (
      pointBlock: Pick<HistoryBlock, "slotNo" | "hash">,
    ) =>
      queryEpochContextAtPoint(
        ogmiosEndpoint,
        {
          slot: pointBlock.slotNo,
          hash: pointBlock.hash,
        },
        epochNonce,
        process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE === "1",
      );

    let epochContext;
    try {
      epochContext = await queryEpochContext(block);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallbackBlock = await this.findLatestBlockInEpoch(block.epochNo);
      const canRetryWithSameEpochPoint = fallbackBlock &&
        fallbackBlock.height !== block.height &&
        this.isStaleOgmiosPointError(message);

      if (!canRetryWithSameEpochPoint) {
        if (this.isStaleOgmiosPointError(message)) {
          return this.findStalePointEpochContextFallback(
            block,
            slotBounds,
            ogmiosEndpoint,
            epochNonce,
          );
        }
        throw error;
      }

      try {
        epochContext = await queryEpochContext(fallbackBlock);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError);
        if (this.isStaleOgmiosPointError(fallbackMessage)) {
          return this.findStalePointEpochContextFallback(
            block,
            slotBounds,
            ogmiosEndpoint,
            epochNonce,
          );
        }
        throw fallbackError;
      }
    }

    if (epochContext.currentEpoch !== block.epochNo) {
      throw new Error(
        `Ogmios acquired epoch ${epochContext.currentEpoch} at block ${block.height}, expected epoch ${block.epochNo}`,
      );
    }

    const ogmiosStakeDistribution: HistoryStakeDistributionEntry[] =
      epochContext.stakeDistribution.map((entry) => ({
        poolId: normalizePoolId(entry.poolId),
        stake: entry.stake,
        vrfKeyHash: normalizeHex(entry.vrfKeyHash),
        relativeStakeNumerator: entry.relativeStakeNumerator,
        relativeStakeDenominator: entry.relativeStakeDenominator,
      }));
    const stakeDistribution = await this.findCurrentEpochStakeSnapshot(
      block,
      ogmiosStakeDistribution,
    );
    if (stakeDistribution === null) {
      const historicalStakeEndpoint = this.configService.get<string>(
        "cardanoEpochParamsEndpoint",
      )?.replace(/\/+$/, "");
      if (!historicalStakeEndpoint) {
        throw new Error(
          `Historical stake-distribution endpoint unavailable for completed epoch ${block.epochNo}`,
        );
      }
      return this.findHistoricalEpochContextFallback(
        block,
        slotBounds,
        ogmiosEndpoint,
        epochNonce,
        historicalStakeEndpoint,
      );
    }
    const firstRegistrationSlots = await this.findKnownPoolRegistrationSlots(
      stakeDistribution.map((entry) => entry.poolId),
    );

    return {
      epoch: epochContext.currentEpoch,
      stakeDistribution: stakeDistribution.map((entry) => ({
        ...entry,
        firstRegistrationSlot: firstRegistrationSlots.get(entry.poolId) ?? null,
      })),
      verificationContext: {
        epochNonce: epochContext.epochNonce,
        slotsPerKesPeriod: epochContext.slotsPerKesPeriod,
        maxKesEvolutions: epochContext.maxKesEvolutions,
        activeSlotCoefficientNumerator:
          epochContext.activeSlotCoefficientNumerator,
        activeSlotCoefficientDenominator:
          epochContext.activeSlotCoefficientDenominator,
        currentEpochStartSlot: slotBounds.currentEpochStartSlot,
        currentEpochEndSlotExclusive: slotBounds.currentEpochEndSlotExclusive,
      },
    };
  }

  async findOperationalCertificateCountersAtBlock(
    block: HistoryBlock,
  ): Promise<Map<string, bigint>> {
    const ogmiosEndpoint = this.configService.get<string>("ogmiosEndpoint");
    if (!ogmiosEndpoint) {
      throw new Error(
        "Ogmios endpoint is required to query operational certificate counters",
      );
    }

    // Counter state is height-sensitive. Never substitute another point, even
    // within the same epoch, because that could move the anti-rollback baseline.
    return queryOperationalCertificateCountersAtPoint(ogmiosEndpoint, {
      slot: block.slotNo,
      hash: block.hash,
    });
  }

  private async findCurrentEpochStakeSnapshot(
    block: HistoryBlock,
    ogmiosStakeDistribution: HistoryStakeDistributionEntry[],
  ): Promise<HistoryStakeDistributionEntry[] | null> {
    const cardanoNetwork = this.configService.get<string>("cardanoNetwork");
    const isPublicNetwork = cardanoNetwork === "Preprod" ||
      cardanoNetwork === "Preview" || cardanoNetwork === "Mainnet";
    const endpoint = this.configService.get<string>(
      "cardanoEpochParamsEndpoint",
    )?.replace(/\/+$/, "");
    if (!isPublicNetwork || !endpoint) {
      return ogmiosStakeDistribution;
    }

    const cacheKey = this.epochNonceCacheKey(block.epochNo);
    const cached = this.currentEpochStakeSnapshotCache.get(cacheKey);
    if (cached) {
      return cached.map((entry) => ({ ...entry }));
    }

    const pendingLookup = this.currentEpochStakeSnapshotLookups.get(cacheKey);
    if (pendingLookup) {
      const snapshot = await pendingLookup;
      return snapshot.map((entry) => ({ ...entry }));
    }

    const tipEpoch = await this.fetchKoiosTipEpoch(endpoint);
    if (tipEpoch < block.epochNo) {
      throw new Error(
        `Koios tip epoch ${tipEpoch} is behind requested block epoch ${block.epochNo}; refusing live Ogmios stake fallback`,
      );
    }
    if (tipEpoch > block.epochNo) {
      // The requested epoch is complete. Ogmios liveStakeDistribution is a
      // current-ledger wallet distribution, not the epoch's Praos Set snapshot.
      // Signal the caller to use the completed-epoch reconstruction instead.
      return null;
    }

    const lookup = this.buildCurrentEpochStakeSnapshot(
      endpoint,
      block,
      ogmiosStakeDistribution,
    );
    this.currentEpochStakeSnapshotLookups.set(cacheKey, lookup);
    try {
      const snapshot = await lookup;
      this.currentEpochStakeSnapshotCache.set(cacheKey, snapshot);
      return snapshot.map((entry) => ({ ...entry }));
    } finally {
      this.currentEpochStakeSnapshotLookups.deleteIfValue(cacheKey, lookup);
    }
  }

  private async buildCurrentEpochStakeSnapshot(
    endpoint: string,
    block: HistoryBlock,
    ogmiosStakeDistribution: HistoryStakeDistributionEntry[],
  ): Promise<HistoryStakeDistributionEntry[]> {
    const [poolRows, totalActiveStake] = await Promise.all([
      this.fetchKoiosCurrentEpochPoolList(endpoint, block.epochNo),
      this.fetchKoiosEpochActiveStake(endpoint, block.epochNo),
    ]);
    const stakeByPool = new Map<string, bigint>();
    for (const row of poolRows) {
      const poolId = normalizePoolId(row.pool_id_bech32 ?? row.pool_id_hex);
      if (!poolId) {
        throw new Error(
          `Koios returned an invalid current epoch pool id for epoch ${block.epochNo}`,
        );
      }
      if (
        row.active_stake === null || row.active_stake === undefined ||
        row.active_stake === ""
      ) {
        continue;
      }
      const stake = parseNonNegativeBigInt(row.active_stake);
      if (stake === null) {
        throw new Error(
          `Koios returned an invalid current epoch stake entry for epoch ${block.epochNo}`,
        );
      }
      if (stake === 0n) {
        continue;
      }
      if (stakeByPool.has(poolId)) {
        throw new Error(
          `Koios returned duplicate current epoch stake for pool ${poolId} in epoch ${block.epochNo}`,
        );
      }
      stakeByPool.set(poolId, stake);
    }

    if (stakeByPool.size === 0) {
      throw new Error(
        `Koios returned an empty current epoch stake snapshot for epoch ${block.epochNo}`,
      );
    }

    const snapshotTotal = Array.from(stakeByPool.values()).reduce(
      (sum, stake) => sum + stake,
      0n,
    );
    if (snapshotTotal !== totalActiveStake) {
      throw new Error(
        `Koios current epoch stake snapshot total ${snapshotTotal.toString()} does not match epoch ${block.epochNo} active stake ${totalActiveStake.toString()}`,
      );
    }

    const vrfByPool = new Map(
      ogmiosStakeDistribution.map((
        entry,
      ) => [entry.poolId, normalizeHex(entry.vrfKeyHash)]),
    );
    const missingVrfPoolIds = Array.from(stakeByPool.keys()).filter(
      (poolId) => !/^[0-9a-f]{64}$/.test(vrfByPool.get(poolId) ?? ""),
    );
    if (missingVrfPoolIds.length > 0) {
      const registrationEndpoint =
        this.configService.get<string>("cardanoPoolRegistrationHistoryEndpoint")
          ?.replace(/\/+$/, "") || endpoint;
      const updates = await this.fetchHistoricalProducerRegistrationUpdates(
        registrationEndpoint,
        missingVrfPoolIds,
      );
      const registrations = this.resolveHistoricalProducerRegistrations(
        updates,
        missingVrfPoolIds,
        block.epochNo,
        block,
      );
      for (const [poolId, registration] of registrations) {
        vrfByPool.set(poolId, registration.vrfKeyHash);
      }
    }

    return Array.from(stakeByPool.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([poolId, stake]) => {
        const vrfKeyHash = normalizeHex(vrfByPool.get(poolId));
        if (!/^[0-9a-f]{64}$/.test(vrfKeyHash)) {
          throw new Error(
            `Current epoch VRF key hash unavailable for pool ${poolId} in epoch ${block.epochNo}`,
          );
        }
        return {
          poolId,
          stake,
          vrfKeyHash,
          relativeStakeNumerator: stake,
          relativeStakeDenominator: totalActiveStake,
        };
      });
  }

  private async fetchKoiosTipEpoch(endpoint: string): Promise<number> {
    const url = new URL(`${endpoint}/tip`);
    url.searchParams.set("select", "epoch_no");
    const rows = (await this.fetchKoiosArray(
      url,
      "current Cardano epoch",
    )) as KoiosTipRow[];
    const epoch = Number(rows[0]?.epoch_no);
    if (rows.length !== 1 || !Number.isSafeInteger(epoch) || epoch < 0) {
      throw new Error("Koios did not return a valid current Cardano epoch");
    }
    return epoch;
  }

  private async fetchKoiosCurrentEpochPoolList(
    endpoint: string,
    epoch: number,
  ): Promise<KoiosPoolListRow[]> {
    const rows: KoiosPoolListRow[] = [];
    for (let page = 0; page < CURRENT_EPOCH_STAKE_MAX_PAGES; page += 1) {
      const url = new URL(`${endpoint}/pool_list`);
      url.searchParams.set("select", "pool_id_bech32,pool_id_hex,active_stake");
      url.searchParams.set("active_stake", "gt.0");
      url.searchParams.set("order", "pool_id_bech32.asc");
      url.searchParams.set("limit", CURRENT_EPOCH_STAKE_PAGE_SIZE.toString());
      url.searchParams.set(
        "offset",
        (page * CURRENT_EPOCH_STAKE_PAGE_SIZE).toString(),
      );
      const pageRows = (await this.fetchKoiosArray(
        url,
        `current epoch stake pool page ${page + 1} for epoch ${epoch}`,
      )) as KoiosPoolListRow[];
      rows.push(...pageRows);
      if (pageRows.length < CURRENT_EPOCH_STAKE_PAGE_SIZE) {
        return rows;
      }
    }

    throw new Error(
      `Koios current epoch stake pool list exceeded ${
        CURRENT_EPOCH_STAKE_MAX_PAGES * CURRENT_EPOCH_STAKE_PAGE_SIZE
      } rows for epoch ${epoch}`,
    );
  }

  private async fetchKoiosEpochActiveStake(
    endpoint: string,
    epoch: number,
  ): Promise<bigint> {
    const url = new URL(`${endpoint}/epoch_info`);
    url.searchParams.set("_epoch_no", epoch.toString());
    url.searchParams.set("select", "epoch_no,active_stake");
    const rows = (await this.fetchKoiosArray(
      url,
      `active stake for epoch ${epoch}`,
    )) as KoiosEpochInfoRow[];
    if (rows.length !== 1 || Number(rows[0].epoch_no) !== epoch) {
      throw new Error(`Koios did not return active stake for epoch ${epoch}`);
    }
    return parsePositiveBigInt(
      rows[0].active_stake,
      `active stake for epoch ${epoch}`,
    );
  }

  private isStaleOgmiosPointError(message: string): boolean {
    return message.includes("Target point is too old") ||
      message.includes("Failed to acquire requested point");
  }

  private async findStalePointEpochContextFallback(
    block: HistoryBlock,
    slotBounds: {
      currentEpochStartSlot: bigint;
      currentEpochEndSlotExclusive: bigint;
    },
    ogmiosEndpoint: string,
    epochNonce: string,
  ): Promise<HistoryEpochContextAtBlock> {
    const cardanoNetwork = this.configService.get<string>("cardanoNetwork");
    const isPublicNetwork = cardanoNetwork === "Preprod" ||
      cardanoNetwork === "Preview" || cardanoNetwork === "Mainnet";
    const historicalStakeEndpoint = this.configService.get<string>(
      "cardanoEpochParamsEndpoint",
    )?.replace(/\/+$/, "");

    if (isPublicNetwork && historicalStakeEndpoint) {
      return this.findHistoricalEpochContextFallback(
        block,
        slotBounds,
        ogmiosEndpoint,
        epochNonce,
        historicalStakeEndpoint,
      );
    }

    if (isPublicNetwork) {
      throw new Error(
        `Ogmios can no longer acquire epoch ${block.epochNo}, and no historical stake-distribution endpoint is configured for ${cardanoNetwork}`,
      );
    }

    if (
      process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT !==
        undefined &&
      process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE === "1"
    ) {
      return this.findLocalStalePointEpochContextFallback(
        block,
        slotBounds,
        ogmiosEndpoint,
        epochNonce,
      );
    }

    throw new Error(
      `Ogmios can no longer acquire epoch ${block.epochNo}, and no historical stake-distribution fallback is configured`,
    );
  }

  private async findHistoricalEpochContextFallback(
    block: HistoryBlock,
    slotBounds: {
      currentEpochStartSlot: bigint;
      currentEpochEndSlotExclusive: bigint;
    },
    ogmiosEndpoint: string,
    epochNonce: string,
    historicalStakeEndpoint: string,
  ): Promise<HistoryEpochContextAtBlock> {
    const cacheKey = this.epochNonceCacheKey(block.epochNo);
    const cached = this.historicalEpochContextCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pendingLookup = this.historicalEpochContextLookups.get(cacheKey);
    if (pendingLookup) {
      return pendingLookup;
    }

    const lookup = this.buildHistoricalEpochContext(
      block,
      slotBounds,
      ogmiosEndpoint,
      epochNonce,
      historicalStakeEndpoint,
    );
    this.historicalEpochContextLookups.set(cacheKey, lookup);
    try {
      const context = await lookup;
      this.historicalEpochContextCache.set(cacheKey, context);
      return context;
    } finally {
      this.historicalEpochContextLookups.deleteIfValue(cacheKey, lookup);
    }
  }

  private async buildHistoricalEpochContext(
    block: HistoryBlock,
    slotBounds: {
      currentEpochStartSlot: bigint;
      currentEpochEndSlotExclusive: bigint;
    },
    ogmiosEndpoint: string,
    epochNonce: string,
    historicalStakeEndpoint: string,
  ): Promise<HistoryEpochContextAtBlock> {
    const [producerSummaryRows, verificationContext] = await Promise.all([
      this.entityManager.query(
        `
          SELECT
            COUNT(*)::text AS block_count,
            ARRAY_AGG(DISTINCT slot_leader ORDER BY slot_leader)
              FILTER (WHERE slot_leader IS NOT NULL AND BTRIM(slot_leader) <> '') AS pool_ids
          FROM block
          WHERE epoch = $1
        `,
        [block.epochNo],
      ),
      queryCurrentEpochVerificationData(ogmiosEndpoint, epochNonce),
    ]);
    const producerSummary =
      (producerSummaryRows as HistoricalEpochProducerSummaryRow[])[0];
    const indexedBlockCount = Number(producerSummary?.block_count);
    const producerPoolIds = Array.from(
      new Set(
        (producerSummary?.pool_ids ?? []).map((poolId) =>
          normalizePoolId(poolId)
        ).filter(Boolean),
      ),
    ).sort();

    if (!Number.isSafeInteger(indexedBlockCount) || indexedBlockCount <= 0) {
      throw new Error(
        `Yaci has no complete block history for historical stake reconstruction in epoch ${block.epochNo}`,
      );
    }
    if (producerPoolIds.length === 0) {
      throw new Error(
        `Yaci has no slot leaders for historical stake reconstruction in epoch ${block.epochNo}`,
      );
    }

    const registrationEndpoint =
      this.configService.get<string>("cardanoPoolRegistrationHistoryEndpoint")
        ?.replace(/\/+$/, "") ||
      historicalStakeEndpoint;
    const epochInfo = await this.fetchHistoricalEpochInfo(
      historicalStakeEndpoint,
      block.epochNo,
    );
    if (epochInfo.blockCount !== indexedBlockCount) {
      throw new Error(
        `Yaci epoch ${block.epochNo} history is incomplete: indexed ${indexedBlockCount} of ${epochInfo.blockCount} blocks`,
      );
    }

    const [stakeByPool, registrationUpdates] = await Promise.all([
      this.fetchHistoricalProducerStakes(
        historicalStakeEndpoint,
        block.epochNo,
        producerPoolIds,
      ),
      this.fetchHistoricalProducerRegistrationUpdates(
        registrationEndpoint,
        producerPoolIds,
      ),
    ]);
    const registrationData = this.resolveHistoricalProducerRegistrations(
      registrationUpdates,
      producerPoolIds,
      block.epochNo,
      block,
    );

    const stakeDistribution = producerPoolIds.map((poolId) => {
      const stake = stakeByPool.get(poolId);
      const registration = registrationData.get(poolId);
      if (stake === undefined || !registration) {
        throw new Error(
          `Historical stake evidence is incomplete for pool ${poolId} in epoch ${block.epochNo}`,
        );
      }
      return {
        poolId,
        stake,
        vrfKeyHash: registration.vrfKeyHash,
        firstRegistrationSlot: registration.firstRegistrationSlot,
        relativeStakeNumerator: stake,
        relativeStakeDenominator: epochInfo.totalActiveStake,
      };
    });
    const producerStake = stakeDistribution.reduce(
      (sum, entry) => sum + entry.stake,
      0n,
    );
    if (producerStake > epochInfo.totalActiveStake) {
      throw new Error(
        `Historical producer stake exceeds total active stake in epoch ${block.epochNo}`,
      );
    }

    const unproducedStake = epochInfo.totalActiveStake - producerStake;
    if (unproducedStake > 0n) {
      // The verifier needs exact stake for every possible block producer and the
      // exact total active stake. Pools that produced no blocks in this completed
      // epoch can be represented by one deliberately non-pool aggregate entry.
      stakeDistribution.push({
        poolId: `${HISTORICAL_STAKE_REMAINDER_POOL_PREFIX}:${block.epochNo}`,
        stake: unproducedStake,
        vrfKeyHash: "00".repeat(32),
        firstRegistrationSlot: 1n,
        relativeStakeNumerator: unproducedStake,
        relativeStakeDenominator: epochInfo.totalActiveStake,
      });
    }

    return {
      epoch: block.epochNo,
      stakeDistribution,
      verificationContext: {
        epochNonce: verificationContext.epochNonce,
        slotsPerKesPeriod: verificationContext.slotsPerKesPeriod,
        maxKesEvolutions: verificationContext.maxKesEvolutions,
        activeSlotCoefficientNumerator:
          verificationContext.activeSlotCoefficientNumerator,
        activeSlotCoefficientDenominator:
          verificationContext.activeSlotCoefficientDenominator,
        currentEpochStartSlot: slotBounds.currentEpochStartSlot,
        currentEpochEndSlotExclusive: slotBounds.currentEpochEndSlotExclusive,
      },
    };
  }

  private async fetchHistoricalEpochInfo(
    endpoint: string,
    epoch: number,
  ): Promise<{ totalActiveStake: bigint; blockCount: number }> {
    const url = new URL(`${endpoint}/epoch_info`);
    url.searchParams.set("_epoch_no", epoch.toString());
    url.searchParams.set("select", "epoch_no,active_stake,blk_count");
    const rows = (await this.fetchKoiosArray(
      url,
      `historical epoch information for epoch ${epoch}`,
    )) as KoiosEpochInfoRow[];
    if (rows.length !== 1 || Number(rows[0].epoch_no) !== epoch) {
      throw new Error(
        `Koios did not return historical epoch information for epoch ${epoch}`,
      );
    }

    const totalActiveStake = parsePositiveBigInt(
      rows[0].active_stake,
      `active stake for epoch ${epoch}`,
    );
    const blockCount = Number(rows[0].blk_count);
    if (!Number.isSafeInteger(blockCount) || blockCount <= 0) {
      throw new Error(
        `Koios returned an invalid block count for epoch ${epoch}`,
      );
    }
    return { totalActiveStake, blockCount };
  }

  private async fetchHistoricalProducerStakes(
    endpoint: string,
    epoch: number,
    poolIds: string[],
  ): Promise<Map<string, bigint>> {
    const stakeByPool = new Map<string, bigint>();
    for (
      let index = 0;
      index < poolIds.length;
      index += HISTORICAL_STAKE_POOL_CONCURRENCY
    ) {
      const batch = poolIds.slice(
        index,
        index + HISTORICAL_STAKE_POOL_CONCURRENCY,
      );
      const rows = await Promise.all(
        batch.map(async (poolId) => {
          const url = new URL(`${endpoint}/pool_history`);
          url.searchParams.set("_pool_bech32", poolId);
          url.searchParams.set("_epoch_no", epoch.toString());
          url.searchParams.set("select", "epoch_no,active_stake");
          const history = (await this.fetchKoiosArray(
            url,
            `historical stake for pool ${poolId} in epoch ${epoch}`,
          )) as KoiosPoolHistoryRow[];
          if (history.length !== 1 || Number(history[0].epoch_no) !== epoch) {
            throw new Error(
              `Koios did not return historical stake for pool ${poolId} in epoch ${epoch}`,
            );
          }
          return [
            poolId,
            parsePositiveBigInt(
              history[0].active_stake,
              `active stake for pool ${poolId} in epoch ${epoch}`,
            ),
          ] as const;
        }),
      );
      for (const [poolId, stake] of rows) {
        stakeByPool.set(poolId, stake);
      }
    }
    return stakeByPool;
  }

  private async fetchHistoricalProducerRegistrationUpdates(
    endpoint: string,
    poolIds: string[],
  ): Promise<KoiosPoolUpdateRow[]> {
    const updates: KoiosPoolUpdateRow[] = [];
    for (
      let index = 0;
      index < poolIds.length;
      index += POOL_REGISTRATION_LOOKUP_BATCH_SIZE
    ) {
      const batch = poolIds.slice(
        index,
        index + POOL_REGISTRATION_LOOKUP_BATCH_SIZE,
      );
      const url = new URL(`${endpoint}/pool_updates`);
      url.searchParams.set(
        "select",
        "tx_hash,block_time,pool_id_bech32,pool_id_hex,active_epoch_no,vrf_key_hash,update_type",
      );
      url.searchParams.set("pool_id_bech32", `in.(${batch.join(",")})`);
      url.searchParams.set("update_type", "eq.registration");
      url.searchParams.set("order", "block_time.asc");
      const rows = (await this.fetchKoiosArray(
        url,
        `historical registration data for ${batch.length} pools`,
      )) as KoiosPoolUpdateRow[];
      updates.push(...rows);
    }
    return updates;
  }

  private resolveHistoricalProducerRegistrations(
    updates: KoiosPoolUpdateRow[],
    poolIds: string[],
    epoch: number,
    referenceBlock: Pick<HistoryBlock, "slotNo" | "timestampUnixNs">,
  ): Map<string, { vrfKeyHash: string; firstRegistrationSlot: bigint }> {
    const requestedPools = new Set(poolIds);
    const firstRegistrationByPool = new Map<string, bigint>();
    const effectiveRegistrationByPool = new Map<
      string,
      { activeEpoch: number; blockTime: bigint; vrfKeyHash: string }
    >();

    for (const update of updates) {
      if (update.update_type && update.update_type !== "registration") {
        continue;
      }
      const poolId = normalizePoolId(
        update.pool_id_bech32 ?? update.pool_id_hex,
      );
      if (!poolId || !requestedPools.has(poolId)) {
        continue;
      }

      const registrationSlot =
        update.block_time === null || update.block_time === undefined
          ? null
          : this.trySlotFromUnixSeconds(update.block_time, referenceBlock);
      if (registrationSlot !== null) {
        const encodedRegistrationSlot = registrationSlot > 0n
          ? registrationSlot
          : 1n;
        const existing = firstRegistrationByPool.get(poolId);
        if (existing === undefined || encodedRegistrationSlot < existing) {
          firstRegistrationByPool.set(poolId, encodedRegistrationSlot);
        }
      }

      const activeEpoch = Number(update.active_epoch_no);
      const vrfKeyHash = normalizeHex(update.vrf_key_hash);
      if (
        !Number.isSafeInteger(activeEpoch) || activeEpoch > epoch ||
        !/^[0-9a-f]{64}$/.test(vrfKeyHash)
      ) {
        continue;
      }
      const blockTime = parseNonNegativeBigInt(update.block_time) ?? 0n;
      const current = effectiveRegistrationByPool.get(poolId);
      if (
        !current ||
        activeEpoch > current.activeEpoch ||
        (activeEpoch === current.activeEpoch && blockTime > current.blockTime)
      ) {
        effectiveRegistrationByPool.set(poolId, {
          activeEpoch,
          blockTime,
          vrfKeyHash,
        });
      }
    }

    const resolved = new Map<
      string,
      { vrfKeyHash: string; firstRegistrationSlot: bigint }
    >();
    for (const poolId of poolIds) {
      const firstRegistrationSlot = firstRegistrationByPool.get(poolId);
      const effectiveRegistration = effectiveRegistrationByPool.get(poolId);
      if (!firstRegistrationSlot || !effectiveRegistration) {
        throw new Error(
          `Koios did not return complete historical registration data for pool ${poolId} in epoch ${epoch}`,
        );
      }
      resolved.set(poolId, {
        vrfKeyHash: effectiveRegistration.vrfKeyHash,
        firstRegistrationSlot,
      });
    }
    return resolved;
  }

  private async fetchKoiosArray(url: URL, context: string): Promise<unknown[]> {
    let lastError: Error | undefined;
    for (
      let attempt = 0;
      attempt < HISTORICAL_STAKE_LOOKUP_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        HISTORICAL_STAKE_LOOKUP_TIMEOUT_MS,
      );
      let retryDelayMs = HISTORICAL_STAKE_RETRY_DELAY_MS;
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: this.koiosRequestHeaders(),
        });
        if (response.ok) {
          const body = await response.json();
          if (!Array.isArray(body)) {
            throw new HistoricalStakeLookupError(
              `Koios returned an invalid response for ${context}`,
              false,
            );
          }
          return body;
        }

        const retryable = response.status === 408 || response.status === 429 ||
          response.status >= 500;
        throw new HistoricalStakeLookupError(
          `Koios lookup failed for ${context}: HTTP ${response.status}`,
          retryable,
          retryable ? parseRetryAfterMs(response.headers) : undefined,
        );
      } catch (error) {
        const lookupError = error instanceof HistoricalStakeLookupError
          ? error
          : error instanceof Error && error.name === "AbortError"
          ? new HistoricalStakeLookupError(
            `Koios lookup timed out for ${context} after ${HISTORICAL_STAKE_LOOKUP_TIMEOUT_MS}ms`,
            true,
          )
          : error instanceof TypeError
          ? new HistoricalStakeLookupError(
            `Koios lookup failed for ${context}: ${error.message}`,
            true,
          )
          : new HistoricalStakeLookupError(
            error instanceof Error ? error.message : String(error),
            false,
          );
        if (!lookupError.retryable) {
          throw lookupError;
        }
        lastError = lookupError;
        retryDelayMs = Math.min(
          lookupError.retryAfterMs ?? retryDelayMs,
          HISTORICAL_STAKE_RETRY_MAX_DELAY_MS,
        );
      } finally {
        clearTimeout(timeout);
      }

      if (attempt + 1 >= HISTORICAL_STAKE_LOOKUP_MAX_ATTEMPTS) {
        break;
      }
      await sleep(retryDelayMs);
    }
    throw lastError ?? new Error(`Koios lookup failed for ${context}`);
  }

  private async findLocalStalePointEpochContextFallback(
    block: HistoryBlock,
    slotBounds: {
      currentEpochStartSlot: bigint;
      currentEpochEndSlotExclusive: bigint;
    },
    ogmiosEndpoint: string,
    epochNonce: string,
  ): Promise<HistoryEpochContextAtBlock> {
    const [verificationContext, currentStakeDistribution] = await Promise.all([
      queryCurrentEpochVerificationData(ogmiosEndpoint, epochNonce),
      queryCurrentEpochStakeDistribution(
        ogmiosEndpoint,
        process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE === "1",
      ),
    ]);

    const stakeDistribution: HistoryStakeDistributionEntry[] =
      currentStakeDistribution.map((entry) => ({
        poolId: normalizePoolId(entry.poolId),
        stake: entry.stake,
        vrfKeyHash: normalizeHex(entry.vrfKeyHash),
        relativeStakeNumerator: entry.relativeStakeNumerator,
        relativeStakeDenominator: entry.relativeStakeDenominator,
      }));
    const firstRegistrationSlots = await this.findKnownPoolRegistrationSlots(
      stakeDistribution.map((entry) => entry.poolId),
    );

    return {
      epoch: block.epochNo,
      stakeDistribution: stakeDistribution.map((entry) => ({
        ...entry,
        firstRegistrationSlot: firstRegistrationSlots.get(entry.poolId) ?? null,
      })),
      verificationContext: {
        epochNonce: verificationContext.epochNonce,
        slotsPerKesPeriod: verificationContext.slotsPerKesPeriod,
        maxKesEvolutions: verificationContext.maxKesEvolutions,
        activeSlotCoefficientNumerator:
          verificationContext.activeSlotCoefficientNumerator,
        activeSlotCoefficientDenominator:
          verificationContext.activeSlotCoefficientDenominator,
        currentEpochStartSlot: slotBounds.currentEpochStartSlot,
        currentEpochEndSlotExclusive: slotBounds.currentEpochEndSlotExclusive,
      },
    };
  }

  async findClientUtxosByBlockNo(height: number): Promise<UtxoDto[]> {
    const deploymentConfig = this.configService.get("deployment");
    const mintClientScriptHash =
      deploymentConfig.validators.mintClientStt.scriptHash;
    const tokenBase = deploymentConfig.hostStateNFT;
    const clientTokenNamePrefix = this.lucidService.generateTokenName(
      tokenBase,
      CLIENT_PREFIX,
      0n,
    ).slice(0, 40);

    const query = `
      SELECT
        address,
        tx_hash,
        tx_id,
        output_index,
        datum,
        datum_hash,
        assets_policy,
        assets_name,
        block_no,
        block_id
      FROM bridge_utxo_history
      WHERE block_no = $1
        AND assets_policy = $2
        AND lower(assets_name) LIKE lower($3)
      ORDER BY COALESCE(tx_index, 0) ASC, output_index ASC
    `;
    const rows = await this.entityManager.query(query, [
      height,
      mintClientScriptHash,
      `${clientTokenNamePrefix}%`,
    ]);
    return rows.map((row: BridgeUtxoHistoryRow) => this.mapUtxoRow(row));
  }

  async checkExistPoolUpdateByBlockNo(height: number): Promise<boolean> {
    const query = `
      SELECT 1
      FROM bridge_spo_event_history
      WHERE block_no = $1 AND event_type = 'register'
      LIMIT 1
    `;
    const rows = await this.entityManager.query(query, [height]);
    return rows.length > 0;
  }

  async checkExistPoolRetireByBlockNo(height: number): Promise<boolean> {
    const query = `
      SELECT 1
      FROM bridge_spo_event_history
      WHERE block_no = $1 AND event_type = 'unregister'
      LIMIT 1
    `;
    const rows = await this.entityManager.query(query, [height]);
    return rows.length > 0;
  }

  private async fetchEpochNonce(epoch: number): Promise<string> {
    const endpoint = this.configService.get<string>(
      "cardanoEpochParamsEndpoint",
    )?.replace(/\/+$/, "");
    if (!endpoint) {
      const localEpochNonceOverride = normalizeHex(
        process.env.CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE,
      );
      if (
        process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT !==
          undefined &&
        /^[0-9a-f]{64}$/.test(localEpochNonceOverride)
      ) {
        return localEpochNonceOverride;
      }

      const genesisNonce = normalizeHex(
        process.env.CARDANO_EPOCH_NONCE_GENESIS,
      );
      if (epoch === 0 && /^[0-9a-f]{64}$/.test(genesisNonce)) {
        return genesisNonce;
      }
      if (
        process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT !==
          undefined &&
        /^[0-9a-f]{64}$/.test(genesisNonce)
      ) {
        return genesisNonce;
      }
      throw new Error(
        `Cardano epoch params endpoint unavailable for epoch ${epoch}`,
      );
    }

    const cacheKey = this.epochNonceCacheKey(epoch);
    const cachedNonce = this.epochNonceCache.get(cacheKey);
    if (cachedNonce) {
      return cachedNonce;
    }

    const pendingLookup = this.epochNonceLookups.get(cacheKey);
    if (pendingLookup) {
      return pendingLookup;
    }

    const lookup = this.fetchEpochNonceWithRetry(endpoint, epoch);
    this.epochNonceLookups.set(cacheKey, lookup);
    try {
      const nonce = await lookup;
      this.cacheEpochNonce(cacheKey, nonce);
      return nonce;
    } finally {
      this.epochNonceLookups.deleteIfValue(cacheKey, lookup);
    }
  }

  private epochNonceCacheKey(epoch: number): string {
    const chainId = this.configService.get<string>("cardanoChainId") || "";
    const network = this.configService.get<string>("cardanoNetwork") || "";
    const networkMagic = this.configService.get<number>(
      "cardanoChainNetworkMagic",
    );
    return `${chainId}:${network}:${networkMagic ?? ""}:${epoch}`;
  }

  private cacheEpochNonce(cacheKey: string, nonce: string): void {
    this.epochNonceCache.set(cacheKey, nonce);
  }

  private async fetchEpochNonceWithRetry(
    endpoint: string,
    epoch: number,
  ): Promise<string> {
    let lastError: Error | undefined;
    for (
      let attempt = 0;
      attempt < EPOCH_PARAMS_LOOKUP_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.fetchEpochNonceAttempt(endpoint, epoch);
      } catch (error) {
        const lookupError = error instanceof Error
          ? error
          : new Error(String(error));
        lastError = lookupError;
        if (
          !(lookupError instanceof EpochParamsLookupError) ||
          !lookupError.retryable ||
          attempt + 1 >= EPOCH_PARAMS_LOOKUP_MAX_ATTEMPTS
        ) {
          throw lookupError;
        }

        const exponentialDelay = Math.min(
          EPOCH_PARAMS_RETRY_BASE_DELAY_MS * 2 ** attempt,
          EPOCH_PARAMS_RETRY_MAX_DELAY_MS,
        );
        const retryDelay = Math.min(
          lookupError.retryAfterMs ?? exponentialDelay,
          EPOCH_PARAMS_RETRY_MAX_DELAY_MS,
        );
        await sleep(retryDelay);
      }
    }
    throw lastError ??
      new Error(`Cardano epoch params lookup failed for epoch ${epoch}`);
  }

  private async fetchEpochNonceAttempt(
    endpoint: string,
    epoch: number,
  ): Promise<string> {
    const url = new URL(`${endpoint}/epoch_params`);
    url.searchParams.set("_epoch_no", epoch.toString());

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      EPOCH_PARAMS_LOOKUP_TIMEOUT_MS,
    );
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: this.koiosRequestHeaders(),
      });
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 ||
          response.status >= 500;
        throw new EpochParamsLookupError(
          `Cardano epoch params lookup failed for epoch ${epoch}: HTTP ${response.status}`,
          retryable,
          retryable ? parseRetryAfterMs(response.headers) : undefined,
        );
      }

      const body = await response.json();
      const row = Array.isArray(body) && body.length === 1
        ? (body[0] as KoiosEpochParamsRow | undefined)
        : undefined;
      const epochNo = row?.epoch_no;
      const returnedEpoch =
        typeof epochNo === "string" || typeof epochNo === "number"
          ? Number(epochNo)
          : Number.NaN;
      if (!Number.isSafeInteger(returnedEpoch) || returnedEpoch !== epoch) {
        throw new Error(
          `Cardano epoch params lookup did not return params for epoch ${epoch}`,
        );
      }
      const nonce = normalizeHex(row?.nonce);
      if (!/^[0-9a-f]{64}$/.test(nonce)) {
        throw new Error(
          `Cardano epoch params lookup did not return a valid nonce for epoch ${epoch}`,
        );
      }
      return nonce;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Cardano epoch params lookup timed out for epoch ${epoch} after ${EPOCH_PARAMS_LOOKUP_TIMEOUT_MS}ms`,
        );
      }
      if (error instanceof EpochParamsLookupError) {
        throw error;
      }
      if (error instanceof TypeError) {
        throw new EpochParamsLookupError(
          `Cardano epoch params lookup failed for epoch ${epoch}: ${error.message}`,
          true,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async findFirstPoolRegistrationSlots(
    poolIds: string[],
    referenceBlock: Pick<HistoryBlock, "slotNo" | "timestampUnixNs">,
  ): Promise<Map<string, bigint>> {
    const mergedSlots = await this.findKnownPoolRegistrationSlots(poolIds);
    const normalizedPoolIds = Array.from(
      new Set(poolIds.map((poolId) => normalizePoolId(poolId)).filter(Boolean)),
    );
    const missingAfterLocal = normalizedPoolIds.filter((poolId) =>
      !mergedSlots.has(poolId)
    );
    if (missingAfterLocal.length === 0) {
      return mergedSlots;
    }

    const externalSlots = await this.lookupExternalPoolRegistrationSlots(
      missingAfterLocal,
      referenceBlock,
    );
    if (externalSlots.size > 0) {
      await this.cachePoolRegistrationSlots(externalSlots, "external");
    }

    return new Map([...mergedSlots, ...externalSlots]);
  }

  private async findKnownPoolRegistrationSlots(
    poolIds: string[],
  ): Promise<Map<string, bigint>> {
    const normalizedPoolIds = Array.from(
      new Set(poolIds.map((poolId) => normalizePoolId(poolId)).filter(Boolean)),
    );
    if (normalizedPoolIds.length === 0) {
      return new Map();
    }

    await this.ensurePoolRegistrationCacheTable();

    const cachedSlots = await this.findCachedPoolRegistrationSlots(
      normalizedPoolIds,
    );
    const missingAfterCache = normalizedPoolIds.filter((poolId) =>
      !cachedSlots.has(poolId)
    );
    if (missingAfterCache.length === 0) {
      return cachedSlots;
    }

    const localSlots = await this.findLocalPoolRegistrationSlots(
      missingAfterCache,
    );
    if (localSlots.size > 0) {
      await this.cachePoolRegistrationSlots(localSlots, "yaci");
    }

    const mergedSlots = new Map([...cachedSlots, ...localSlots]);
    const assumedRegistrationSlot = getAssumedPoolRegistrationSlot();
    if (assumedRegistrationSlot !== undefined) {
      for (const poolId of normalizedPoolIds) {
        if (!mergedSlots.has(poolId)) {
          mergedSlots.set(poolId, assumedRegistrationSlot);
        }
      }
    }

    return mergedSlots;
  }

  private async ensurePoolRegistrationCacheTable(): Promise<void> {
    if (this.poolRegistrationCacheTableReady) {
      return;
    }

    await this.entityManager.query(`
      CREATE TABLE IF NOT EXISTS bridge_pool_registration_cache (
        pool_id text PRIMARY KEY,
        first_registration_slot bigint NOT NULL,
        source text NOT NULL,
        source_tx_hash varchar(64),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_bridge_pool_registration_cache_slot
        ON bridge_pool_registration_cache(first_registration_slot);
    `);
    this.poolRegistrationCacheTableReady = true;
  }

  private async findCachedPoolRegistrationSlots(
    poolIds: string[],
  ): Promise<Map<string, bigint>> {
    const rows = await this.entityManager.query(
      `
        SELECT lower(pool_id) AS pool_id, first_registration_slot::text AS first_registration_slot
        FROM bridge_pool_registration_cache
        WHERE lower(pool_id) = ANY($1::text[])
      `,
      [poolIds.map((poolId) => poolId.toLowerCase())],
    );

    return this.mapPoolRegistrationSlotRows(rows);
  }

  private async findLocalPoolRegistrationSlots(
    poolIds: string[],
  ): Promise<Map<string, bigint>> {
    const query = `
      WITH registration_slots AS (
        SELECT lower(pool_id) AS pool_id, slot_no::bigint AS first_registration_slot
        FROM bridge_spo_event_history
        WHERE event_type = 'register'
          AND lower(pool_id) = ANY($1::text[])
          AND slot_no IS NOT NULL
        UNION ALL
        SELECT lower(pool_id) AS pool_id, registration_slot::bigint AS first_registration_slot
        FROM pool
        WHERE lower(pool_id) = ANY($1::text[])
          AND registration_slot IS NOT NULL
      )
      SELECT pool_id, MIN(first_registration_slot)::text AS first_registration_slot
      FROM registration_slots
      GROUP BY pool_id
    `;
    const rows = await this.entityManager.query(query, [
      poolIds.map((poolId) => poolId.toLowerCase()),
    ]);
    return this.mapPoolRegistrationSlotRows(rows);
  }

  private mapPoolRegistrationSlotRows(
    rows: PoolRegistrationSlotRow[] | CachedPoolRegistrationRow[],
  ): Map<string, bigint> {
    const registrationRows: CachedPoolRegistrationRow[] = rows;
    return new Map(
      registrationRows
        .filter((row): row is PoolRegistrationSlotRow =>
          row.first_registration_slot !== null &&
          row.first_registration_slot !== undefined
        )
        .map((
          row,
        ) => [
          normalizePoolId(row.pool_id),
          BigInt(row.first_registration_slot),
        ]),
    );
  }

  private async cachePoolRegistrationSlots(
    slotsByPoolId: Map<string, bigint>,
    source: string,
  ): Promise<void> {
    if (slotsByPoolId.size === 0) {
      return;
    }

    const rows = Array.from(slotsByPoolId.entries()).map((
      [poolId, firstRegistrationSlot],
    ) => ({
      pool_id: poolId,
      first_registration_slot: firstRegistrationSlot.toString(),
    }));

    await this.entityManager.query(
      `
        INSERT INTO bridge_pool_registration_cache(pool_id, first_registration_slot, source)
        SELECT row.pool_id, row.first_registration_slot::bigint, $2
        FROM jsonb_to_recordset($1::jsonb) AS row(pool_id text, first_registration_slot text)
        ON CONFLICT (pool_id) DO UPDATE SET
          first_registration_slot = LEAST(
            bridge_pool_registration_cache.first_registration_slot,
            EXCLUDED.first_registration_slot
          ),
          source = EXCLUDED.source,
          updated_at = now()
      `,
      [JSON.stringify(rows), source],
    );
  }

  private async lookupExternalPoolRegistrationSlots(
    poolIds: string[],
    referenceBlock: Pick<HistoryBlock, "slotNo" | "timestampUnixNs">,
  ): Promise<Map<string, bigint>> {
    const endpoint = this.configService.get<string>(
      "cardanoPoolRegistrationHistoryEndpoint",
    )?.replace(/\/+$/, "");
    if (!endpoint) {
      return new Map();
    }

    const resolvedSlots = new Map<string, bigint>();
    for (
      let index = 0;
      index < poolIds.length;
      index += POOL_REGISTRATION_LOOKUP_BATCH_SIZE
    ) {
      const batch = poolIds.slice(
        index,
        index + POOL_REGISTRATION_LOOKUP_BATCH_SIZE,
      );
      const updates = await this.fetchKoiosPoolRegistrationUpdates(
        endpoint,
        batch,
      );

      for (const update of updates) {
        if (update.update_type && update.update_type !== "registration") {
          continue;
        }

        const poolId = normalizePoolId(
          update.pool_id_bech32 ?? update.pool_id_hex,
        );
        if (
          !poolId || !batch.includes(poolId) || update.block_time === null ||
          update.block_time === undefined
        ) {
          continue;
        }

        const firstRegistrationSlot = this.trySlotFromUnixSeconds(
          update.block_time,
          referenceBlock,
        );
        if (firstRegistrationSlot === null) {
          continue;
        }
        if (firstRegistrationSlot <= 0n) {
          continue;
        }
        const existingSlot = resolvedSlots.get(poolId);
        if (
          existingSlot === undefined || firstRegistrationSlot < existingSlot
        ) {
          resolvedSlots.set(poolId, firstRegistrationSlot);
        }
      }
    }

    return resolvedSlots;
  }

  private async fetchKoiosPoolRegistrationUpdates(
    endpoint: string,
    poolIds: string[],
  ): Promise<KoiosPoolUpdateRow[]> {
    const url = new URL(`${endpoint}/pool_updates`);
    url.searchParams.set(
      "select",
      "tx_hash,block_time,pool_id_bech32,pool_id_hex,update_type",
    );
    url.searchParams.set("pool_id_bech32", `in.(${poolIds.join(",")})`);
    url.searchParams.set("update_type", "eq.registration");
    url.searchParams.set("order", "block_time.asc");

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      POOL_REGISTRATION_LOOKUP_TIMEOUT_MS,
    );
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: this.koiosRequestHeaders(),
      });
      if (!response.ok) {
        return [];
      }

      const body = await response.json();
      return Array.isArray(body) ? (body as KoiosPoolUpdateRow[]) : [];
    } catch (_error) {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private trySlotFromUnixSeconds(
    unixSeconds: string | number,
    referenceBlock: Pick<HistoryBlock, "slotNo" | "timestampUnixNs">,
  ): bigint | null {
    let parsedSeconds: bigint;
    try {
      parsedSeconds = BigInt(unixSeconds);
    } catch (_error) {
      return null;
    }
    if (parsedSeconds < 0n) {
      return null;
    }

    const systemStartUnixNs = referenceBlock.timestampUnixNs -
      referenceBlock.slotNo * CARDANO_SLOT_LENGTH_NS;
    const unixNs = parsedSeconds * CARDANO_SLOT_LENGTH_NS;
    if (unixNs <= systemStartUnixNs) {
      return 0n;
    }

    return (unixNs - systemStartUnixNs) / CARDANO_SLOT_LENGTH_NS;
  }

  async findTxByHash(hash: string): Promise<TxDto | null> {
    const query = `
      SELECT
        tx_hash,
        id AS tx_id,
        gas_fee,
        tx_size,
        block_no,
        block_hash,
        slot_no,
        tx_index
      FROM bridge_tx_history
      WHERE tx_hash = $1
      LIMIT 1
    `;
    const rows = await this.entityManager.query(query, [hash.toLowerCase()]);
    if (rows.length <= 0) {
      return null;
    }

    return this.mapTxRow(rows[0]);
  }

  async findTransactionEvidenceByHash(
    hash: string,
  ): Promise<HistoryTxEvidence | null> {
    const query = `
      SELECT
        tx_hash,
        block_no,
        block_hash,
        slot_no,
        tx_index,
        encode(tx_cbor, 'hex') AS tx_cbor_hex,
        encode(tx_body_cbor, 'hex') AS tx_body_cbor_hex,
        redeemers_json,
        host_state_output_index,
        host_state_datum,
        host_state_datum_hash,
        host_state_root,
        gas_fee,
        tx_size
      FROM bridge_tx_evidence
      WHERE tx_hash = $1
      LIMIT 1
    `;
    const rows = await this.entityManager.query(query, [hash.toLowerCase()]);
    return rows[0] ? this.mapTxEvidenceRow(rows[0]) : null;
  }

  private mapUtxoRow(row: BridgeUtxoHistoryRow): UtxoDto {
    return {
      address: row.address,
      txHash: row.tx_hash,
      txId: row.tx_id === undefined ? 0 : Number(row.tx_id),
      outputIndex: Number(row.output_index),
      datum: row.datum ?? undefined,
      datumHash: row.datum_hash ?? undefined,
      assetsName: row.assets_name,
      assetsPolicy: row.assets_policy,
      blockNo: Number(row.block_no),
      blockId: row.block_id === undefined
        ? Number(row.block_no)
        : Number(row.block_id),
    } as UtxoDto;
  }

  private mapTxRow(row: BridgeTxHistoryRow): TxDto {
    return {
      hash: row.tx_hash,
      tx_id: row.tx_id === undefined ? 0 : Number(row.tx_id),
      gas_fee: Number(row.gas_fee),
      tx_size: Number(row.tx_size),
      height: Number(row.block_no),
    };
  }

  private mapTxEvidenceRow(row: BridgeTxEvidenceRow): HistoryTxEvidence {
    return {
      txHash: row.tx_hash,
      blockNo: Number(row.block_no),
      blockHash: row.block_hash ?? null,
      slotNo: row.slot_no === undefined || row.slot_no === null
        ? null
        : BigInt(row.slot_no),
      txIndex: Number(row.tx_index),
      txCborHex: row.tx_cbor_hex,
      txBodyCborHex: row.tx_body_cbor_hex,
      redeemers: Array.isArray(row.redeemers_json) ? row.redeemers_json : [],
      hostStateOutputIndex: row.host_state_output_index === undefined ||
          row.host_state_output_index === null
        ? null
        : Number(row.host_state_output_index),
      hostStateDatum: row.host_state_datum ?? null,
      hostStateDatumHash: row.host_state_datum_hash ?? null,
      hostStateRoot: row.host_state_root ?? null,
      gasFee: row.gas_fee === undefined || row.gas_fee === null
        ? null
        : Number(row.gas_fee),
      txSize: row.tx_size === undefined || row.tx_size === null
        ? null
        : Number(row.tx_size),
    };
  }

  private mapHistoryBlockRow(row: HistoryBlockRow): HistoryBlock {
    const blockTimeMs = row.block_time instanceof Date
      ? row.block_time.valueOf()
      : Number(row.block_time) * 1_000;
    return {
      height: Number(row.number),
      hash: row.hash,
      prevHash: row.prev_hash,
      slotNo: BigInt(row.slot),
      epochNo: Number(row.epoch),
      timestampUnixNs: BigInt(blockTimeMs) * 1_000_000n,
      slotLeader: normalizePoolId(row.slot_leader ?? ""),
    };
  }

  private async findEpochSlotBounds(
    epoch: number,
  ): Promise<
    Pick<
      HistoryEpochVerificationContext,
      "currentEpochStartSlot" | "currentEpochEndSlotExclusive"
    > | null
  > {
    const startSlotQuery = `
      SELECT MIN(slot) AS start_slot
      FROM block
      WHERE epoch = $1
        AND slot >= 0
    `;
    const nextEpochStartSlotQuery = `
      SELECT MIN(slot) AS start_slot
      FROM block
      WHERE epoch = $1
        AND slot >= 0
    `;

    const [startSlotRow] = await this.entityManager.query(startSlotQuery, [
      epoch,
    ]);
    const startSlot = this.parseSlot(startSlotRow);
    if (startSlot === null) {
      return null;
    }

    const [nextEpochStartSlotRow] = await this.entityManager.query(
      nextEpochStartSlotQuery,
      [epoch + 1],
    );
    const nextEpochStartSlot = this.parseSlot(nextEpochStartSlotRow);
    const configuredEpochLength = BigInt(
      this.configService.get<number>("cardanoEpochLength") || 0,
    );
    const currentEpochEndSlotExclusive = nextEpochStartSlot ??
      (configuredEpochLength > 0n ? startSlot + configuredEpochLength : null);
    if (currentEpochEndSlotExclusive === null) {
      return null;
    }

    return {
      currentEpochStartSlot: startSlot,
      currentEpochEndSlotExclusive,
    };
  }

  private async findLatestBlockInEpoch(
    epoch: number,
  ): Promise<HistoryBlock | null> {
    const query = `
      SELECT
        number,
        hash,
        prev_hash,
        slot,
        epoch,
        block_time,
        slot_leader
      FROM block
      WHERE epoch = $1
      ORDER BY number DESC
      LIMIT 1
    `;
    const rows = await this.entityManager.query(query, [epoch]);
    return rows[0] ? this.mapHistoryBlockRow(rows[0]) : null;
  }

  private parseSlot(row?: EpochStartSlotRow | null): bigint | null {
    const slot = row?.start_slot;
    if (slot === undefined || slot === null) {
      return null;
    }
    const parsedSlot = BigInt(slot);
    if (parsedSlot < 0n) {
      return null;
    }
    return parsedSlot;
  }
}

function normalizeHex(value?: string | null): string {
  const trimmed = value?.trim().toLowerCase() || "";
  return trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const retryAfter = headers?.get?.("retry-after")?.trim();
  if (!retryAfter) {
    return undefined;
  }

  if (/^\d+$/.test(retryAfter)) {
    return Number(retryAfter) * 1_000;
  }

  const retryAt = Date.parse(retryAfter);
  if (!Number.isFinite(retryAt)) {
    return undefined;
  }
  return Math.max(0, retryAt - Date.now());
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function parseNonNegativeBigInt(value?: string | number | null): bigint | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    return null;
  }
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function parsePositiveBigInt(
  value: string | number | null | undefined,
  field: string,
): bigint {
  const parsed = parseNonNegativeBigInt(value);
  if (parsed === null || parsed <= 0n) {
    throw new Error(`Koios returned an invalid ${field}`);
  }
  return parsed;
}

function normalizePoolId(value?: string | null): string {
  const trimmed = value?.trim().toLowerCase() || "";
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("pool1")) {
    return trimmed;
  }
  if (/^[0-9a-f]{56}$/.test(trimmed)) {
    return bech32.encode("pool", bech32.toWords(Buffer.from(trimmed, "hex")));
  }
  return trimmed;
}
