import { InjectEntityManager } from "@nestjs/typeorm";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EntityManager } from "typeorm";
import { bech32 } from "bech32";
import { GrpcNotFoundException } from "~@/exception/grpc_exceptions";
import { CLIENT_PREFIX } from "../../constant";
import {
  queryCurrentEpochStakeDistribution,
  queryCurrentEpochVerificationData,
  queryEpochContextAtPoint,
} from "../../shared/helpers/ogmios";
import { LucidService } from "../../shared/modules/lucid/lucid.service";
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
  update_type?: string | null;
};

type KoiosEpochParamsRow = {
  nonce?: string | null;
};

const CARDANO_SLOT_LENGTH_NS = 1_000_000_000n;
const POOL_REGISTRATION_LOOKUP_BATCH_SIZE = 25;
const POOL_REGISTRATION_LOOKUP_TIMEOUT_MS = 10_000;
const EPOCH_PARAMS_LOOKUP_TIMEOUT_MS = 10_000;

@Injectable()
export class YaciHistoryService implements HistoryService {
  private poolRegistrationCacheTableReady = false;

  constructor(
    private readonly configService: ConfigService,
    @Inject(LucidService) private readonly lucidService: LucidService,
    @InjectEntityManager("history") private readonly entityManager:
      EntityManager,
  ) {}

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
      );

    let epochContext;
    try {
      epochContext = await queryEpochContext(block);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallbackBlock = await this.findLatestBlockInEpoch(block.epochNo);
      const canRetryWithSameEpochPoint = fallbackBlock &&
        fallbackBlock.height !== block.height &&
        (message.includes("Target point is too old") ||
          message.includes("Failed to acquire requested point"));

      if (!canRetryWithSameEpochPoint) {
        if (this.canUseLocalStalePointEpochContextFallback(message)) {
          return this.findLocalStalePointEpochContextFallback(
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
        const fallbackMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        if (this.canUseLocalStalePointEpochContextFallback(fallbackMessage)) {
          return this.findLocalStalePointEpochContextFallback(
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

    const stakeDistribution: HistoryStakeDistributionEntry[] = epochContext
      .stakeDistribution.map((entry) => ({
        poolId: normalizePoolId(entry.poolId),
        stake: entry.stake,
        vrfKeyHash: normalizeHex(entry.vrfKeyHash),
      }));
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
        currentEpochStartSlot: slotBounds.currentEpochStartSlot,
        currentEpochEndSlotExclusive: slotBounds.currentEpochEndSlotExclusive,
      },
    };
  }

  private canUseLocalStalePointEpochContextFallback(message: string): boolean {
    return (
      process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT !==
        undefined &&
      (message.includes("Target point is too old") ||
        message.includes("Failed to acquire requested point"))
    );
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
      queryCurrentEpochStakeDistribution(ogmiosEndpoint),
    ]);

    const stakeDistribution: HistoryStakeDistributionEntry[] =
      currentStakeDistribution.map((entry) => ({
        poolId: normalizePoolId(entry.poolId),
        stake: entry.stake,
        vrfKeyHash: normalizeHex(entry.vrfKeyHash),
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
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(
          `Cardano epoch params lookup failed for epoch ${epoch}: HTTP ${response.status}`,
        );
      }

      const body = await response.json();
      const row = Array.isArray(body)
        ? (body[0] as KoiosEpochParamsRow | undefined)
        : undefined;
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
    return new Map(
      rows
        .filter((row) =>
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
        headers: { accept: "application/json" },
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

  async findTxByHash(hash: string): Promise<TxDto> {
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
  ): Promise<HistoryEpochVerificationContext | null> {
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
      epochNonce: "",
      slotsPerKesPeriod: 0,
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
