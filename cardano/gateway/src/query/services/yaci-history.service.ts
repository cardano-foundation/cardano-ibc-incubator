import { InjectEntityManager } from '@nestjs/typeorm';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { bech32 } from 'bech32';
import { validatePublicNetworkStabilityConfig } from '../../config';
import { GrpcNotFoundException } from '~@/exception/grpc_exceptions';
import { CLIENT_PREFIX } from '../../constant';
import {
  queryCurrentEpochStakeDistribution,
  queryCurrentEpochVerificationData,
  queryEpochContextAtPoint,
  queryOperationalCertificateCountersAtPoint,
} from '../../shared/helpers/ogmios';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { BoundedCache } from '../../shared/helpers/bounded-cache';
import { MetricsService } from '../../health/metrics.service';
import { UtxoDto } from '../dtos/utxo.dto';
import { TxDto } from '../dtos/tx.dto';
import {
  HistoryBlock,
  HistoryEpochContextAtBlock,
  HistoryEpochVerificationContext,
  HistoryService,
  HistoryStakeDistributionEntry,
  HistoryTxEvidence,
  HistoryTxRedeemer,
} from './history.service';

import { reconstructHistoricalIbcTree } from './historical-ibc-tree';
import { readLocalEpochStake } from './local-epoch-stake';
import { YaciRestClient } from '../../shared/helpers/yaci-rest';
import { YaciRestHistory, type RestOutput, type RestTransaction } from '../../shared/helpers/yaci-rest-history';
import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import {
  StaleIbcTreeStateError,
  type IbcTreeHostStateRef,
  type IbcTreeSnapshot,
} from '../../shared/helpers/ibc-state-root';

type HistoryBlockRow = {
  number: string | number;
  hash: string;
  prev_hash: string;
  slot: string | number;
  epoch: string | number;
  block_time: string | Date;
  slot_leader?: string | null;
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
  const configuredSlot = process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT;
  return configuredSlot ? BigInt(configuredSlot) : undefined;
}

type BlockfrostPoolUpdateRow = {
  tx_hash?: string | null;
  block_time?: string | number | null;
  registration_slot?: string | number | null;
  pool_id_bech32?: string | null;
  pool_id_hex?: string | null;
  active_epoch_no?: string | number | null;
  vrf_key_hash?: string | null;
  update_type?: string | null;
};

type BlockfrostEpochParamsRow = {
  epoch?: string | number | null;
  nonce?: string | null;
};

type BlockfrostEpochInfoRow = {
  epoch?: string | number | null;
  active_stake?: string | number | null;
  block_count?: string | number | null;
};

type BlockfrostPoolHistoryRow = {
  epoch?: string | number | null;
  active_stake?: string | number | null;
};

type BlockfrostTipRow = {
  epoch?: string | number | null;
};

type BlockfrostPoolListRow = {
  pool_id?: string | null;
  hex?: string | null;
  active_stake?: string | number | null;
};

type HistoricalEpochProducerSummaryRow = {
  block_count?: string | number | null;
  pool_ids?: string[] | null;
};

type BlockfrostRequestHeaders = {
  accept: string;
  project_id?: string;
};

const NANOSECONDS_PER_SECOND = 1_000_000_000n;
const POOL_REGISTRATION_LOOKUP_BATCH_SIZE = 5;
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
const HISTORICAL_STAKE_REMAINDER_POOL_PREFIX = '__historical_unproduced_stake__';
const CURRENT_EPOCH_STAKE_PAGE_SIZE = 100;
const CURRENT_EPOCH_STAKE_MAX_PAGES = 100;

const EPOCH_NONCE_CACHE_METRIC = 'epoch_nonce';
const EPOCH_NONCE_LOOKUPS_METRIC = 'epoch_nonce_lookups';
const HISTORICAL_EPOCH_CONTEXT_CACHE_METRIC = 'historical_epoch_context';
const HISTORICAL_EPOCH_CONTEXT_LOOKUPS_METRIC = 'historical_epoch_context_lookups';
const CURRENT_EPOCH_STAKE_SNAPSHOT_CACHE_METRIC = 'current_epoch_stake_snapshot';
const CURRENT_EPOCH_STAKE_SNAPSHOT_LOOKUPS_METRIC = 'current_epoch_stake_snapshot_lookups';

class EpochParamsLookupError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'EpochParamsLookupError';
  }
}

class HistoricalStakeLookupError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'HistoricalStakeLookupError';
  }
}

@Injectable()
export class YaciHistoryService implements HistoryService {
  private poolRegistrationCacheTableReady = false;
  private readonly historicalTreeRebuilds = new Map<string, Promise<IbcTreeSnapshot>>();

  async rebuildIbcStateTreeAtBlock(height: bigint, hostState: IbcTreeHostStateRef): Promise<IbcTreeSnapshot> {
    const captured = { ...hostState };
    const key = `${height}:${captured.txHash}#${captured.outputIndex}`;
    let pending = this.historicalTreeRebuilds.get(key);
    if (!pending) {
      if (this.historicalTreeRebuilds.size >= 4) {
        throw new Error('Historical IBC tree rebuild capacity reached; retry later');
      }
      const source = this.restHistory();
      pending = source.snapshot(height, async () => {
        const snapshot = await reconstructHistoricalIbcTree(
          source,
          this.configService.getOrThrow('deployment'),
          this.configService.getOrThrow('cardanoNetwork'),
          this.lucidService,
          height,
          captured,
        );
        return { root: snapshot.root, hostState: snapshot.hostState, tree: snapshot.tree };
      });
      this.historicalTreeRebuilds.set(key, pending);
    }
    try {
      const snapshot = await pending;
      return { ...snapshot, tree: snapshot.tree.clone() };
    } finally {
      if (this.historicalTreeRebuilds.get(key) === pending) {
        this.historicalTreeRebuilds.delete(key);
      }
    }
  }
  private readonly epochNonceCache: BoundedCache<string, string>;
  private readonly epochNonceLookups: BoundedCache<string, Promise<string>>;
  private readonly historicalEpochContextCache: BoundedCache<string, HistoryEpochContextAtBlock>;
  private readonly historicalEpochContextLookups: BoundedCache<string, Promise<HistoryEpochContextAtBlock>>;
  private readonly currentEpochStakeSnapshotCache: BoundedCache<string, HistoryStakeDistributionEntry[]>;
  private readonly currentEpochStakeSnapshotLookups: BoundedCache<string, Promise<HistoryStakeDistributionEntry[]>>;

  constructor(
    private readonly configService: ConfigService,
    @Inject(LucidService) private readonly lucidService: LucidService,
    @InjectEntityManager('gateway') private readonly entityManager: EntityManager,
    @Optional() @Inject(MetricsService) metricsService?: MetricsService,
  ) {
    const cache = <Value>(maxEntries: number, metric: string): BoundedCache<string, Value> =>
      new BoundedCache({
        maxEntries,
        onSizeChange: (size) => metricsService?.setCacheEntries(metric, size),
      });

    this.epochNonceCache = cache(EPOCH_PARAMS_CACHE_MAX_ENTRIES, EPOCH_NONCE_CACHE_METRIC);
    this.epochNonceLookups = cache(EPOCH_LOOKUP_MAX_ENTRIES, EPOCH_NONCE_LOOKUPS_METRIC);
    this.historicalEpochContextCache = cache(
      HISTORICAL_EPOCH_CONTEXT_CACHE_MAX_ENTRIES,
      HISTORICAL_EPOCH_CONTEXT_CACHE_METRIC,
    );
    this.historicalEpochContextLookups = cache(EPOCH_LOOKUP_MAX_ENTRIES, HISTORICAL_EPOCH_CONTEXT_LOOKUPS_METRIC);
    this.currentEpochStakeSnapshotCache = cache(
      CURRENT_EPOCH_STAKE_SNAPSHOT_CACHE_MAX_ENTRIES,
      CURRENT_EPOCH_STAKE_SNAPSHOT_CACHE_METRIC,
    );
    this.currentEpochStakeSnapshotLookups = cache(
      EPOCH_LOOKUP_MAX_ENTRIES,
      CURRENT_EPOCH_STAKE_SNAPSHOT_LOOKUPS_METRIC,
    );
  }

  private blockfrostRequestHeaders(): BlockfrostRequestHeaders {
    const projectId = this.configService.get<string>('cardanoBlockfrostProjectId')?.trim();
    if (!projectId) {
      return { accept: 'application/json' };
    }

    return {
      accept: 'application/json',
      project_id: projectId,
    };
  }

  private restHistory(): YaciRestHistory {
    return new YaciRestHistory(new YaciRestClient(this.configService.get<string>('yaciStoreEndpoint')));
  }

  private restOutput(row: RestOutput, unit: string): UtxoDto {
    return {
      address: row.address,
      txHash: row.tx_hash,
      txId: 0,
      outputIndex: row.output_index,
      index: row.tx_index,
      datum: row.inline_datum ?? undefined,
      datumHash: row.data_hash ?? undefined,
      assetsPolicy: unit.slice(0, 56),
      assetsName: unit.slice(56),
      blockNo: row.block,
      blockId: row.block,
    };
  }

  async findUtxosByPolicyIdAndPrefixTokenName(policyId: string, prefixTokenName: string): Promise<UtxoDto[]> {
    const source = this.restHistory();
    return source.snapshot('latest', async (tip) => {
      const units = (await source.policyUnits(policyId)).filter((unit) =>
        unit.slice(56).includes(prefixTokenName.toLowerCase()),
      );
      const result: UtxoDto[] = [];
      for (const unit of units)
        for (const output of await source.outputs({ policy: policyId, unit, unspent: false }, tip.number))
          result.push(this.restOutput(output, unit));
      return result.sort((a, b) => b.blockNo - a.blockNo || b.outputIndex - a.outputIndex);
    });
  }

  async findUtxosByBlockNo(height: number): Promise<UtxoDto[]> {
    const source = this.restHistory();
    return source.snapshot(height, async () => {
      const deployment = this.configService.getOrThrow('deployment');
      const policies = new Set<string>(
        [
          deployment.hostStateNFT.policyId,
          ...Object.values(deployment.validators).map((v: any) => v.scriptHash),
          deployment.packetState?.state?.scriptHash,
          deployment.packetState?.batch?.scriptHash,
          deployment.packetState?.configToken?.policyId,
        ].filter(Boolean),
      );
      const result: UtxoDto[] = [];
      for (const tx of await source.blockTransactions(height))
        for (const output of tx.outputs) {
          for (const amount of output.amounts)
            if (policies.has(amount.unit.slice(0, 56)) && BigInt(amount.quantity) > 0n)
              result.push(this.restOutput(output, amount.unit));
        }
      return result;
    });
  }

  async findUtxoByUnitAtOrBeforeBlockNo(unit: string, height: bigint): Promise<UtxoDto> {
    if (!/^[0-9a-f]{56}(?:[0-9a-f]{2}){1,32}$/i.test(unit))
      throw new GrpcNotFoundException('Not found: invalid asset unit for historical UTxO lookup');
    return this.findCanonicalStateNftAtHeight(
      unit.slice(0, 56).toLowerCase(),
      unit.slice(56).toLowerCase(),
      height,
      `UTxO ${unit}`,
    );
  }

  async findHostStateUtxoAtOrBeforeBlockNo(height: bigint): Promise<UtxoDto> {
    const { hostStateNFT } = this.configService.get('deployment');
    return this.findCanonicalStateNftAtHeight(hostStateNFT.policyId, hostStateNFT.name, height, 'HostState UTxO');
  }

  private async findCanonicalStateNftAtHeight(
    policyId: string,
    assetName: string,
    height: bigint,
    label: string,
  ): Promise<UtxoDto> {
    const source = this.restHistory();
    return source.snapshot(height, async () => {
      const rows = await source.outputs(
        { policy: policyId, unit: policyId + assetName, unspent: true },
        Number(height),
      );
      if (!rows.length) throw new GrpcNotFoundException(`Not found: ${label} not found at or before height ${height}`);
      if (rows.length !== 1)
        throw new StaleIbcTreeStateError(`Multiple canonical ${label} outputs at height ${height}`);
      return this.restOutput(rows[0], policyId + assetName);
    });
  }

  async findLatestBlock(): Promise<HistoryBlock | null> {
    const block = await this.restHistory().api.block('latest');
    return block ? this.mapRestBlock(block) : null;
  }

  async findBlockByHeight(height: bigint): Promise<HistoryBlock | null> {
    const block = await this.restHistory().api.block(height);
    return block ? this.mapRestBlock(block) : null;
  }

  private mapRestBlock(block: import('../../shared/helpers/yaci-rest').YaciRestBlock): HistoryBlock {
    return this.mapHistoryBlockRow({ ...block, prev_hash: block.previous_block ?? '', block_time: String(block.time) });
  }

  async findBridgeBlocks(trustedHeight: bigint, anchorHeight: bigint): Promise<HistoryBlock[]> {
    if (anchorHeight <= trustedHeight || anchorHeight > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error('Invalid bridge block range');
    const source = this.restHistory();
    return source.snapshot(anchorHeight, async () => {
      const blocks: HistoryBlock[] = [];
      let previous = await source.api.block(trustedHeight);
      if (!previous) throw new Error('Trusted Cardano block is unavailable');
      for (let height = trustedHeight + 1n; height <= anchorHeight; height++) {
        const next = await source.api.block(height);
        if (!next || next.previous_block !== previous.hash)
          throw new Error('Yaci REST block range is incomplete or changed');
        if (height < anchorHeight) blocks.push(this.mapRestBlock(next));
        previous = next;
      }
      return blocks;
    });
  }

  async findDescendantBlocks(anchorHeight: bigint, limit: number): Promise<HistoryBlock[]> {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid descendant limit');
    const source = this.restHistory();
    return source.snapshot('latest', async (tip) => {
      const last = BigInt(Math.min(tip.number, Number(anchorHeight) + limit));
      if (last <= anchorHeight) return [];
      const blocks = await this.findBridgeBlocks(anchorHeight, last);
      const end = await source.api.block(last);
      if (!end) throw new Error('Yaci descendant block is unavailable');
      return [...blocks, this.mapRestBlock(end)];
    });
  }

  // These indexed observations guide standalone proof-height discovery. They are
  // never supplied as client history, bootstrap requires an explicit trusted file.
  async findObservedPoolProductionAtBlock(block: HistoryBlock) {
    const source = this.restHistory();
    return source.snapshot(block.height, async (anchor) => {
      if (anchor.hash !== block.hash)
        throw new StaleIbcTreeStateError('Observed production anchor changed');
      const rows: Array<{ epoch: number; slot_leader: string }> = [];
      for (let epoch = Math.max(0, block.epochNo - 5); epoch <= block.epochNo; epoch++) {
        for (const row of await source.epochBlocks(epoch)) {
          if (row.number <= anchor.number) rows.push(row);
        }
      }
      const pools = new Map<string, { pool_id: string; completed_epochs_bitmap: number; produced_current_epoch: boolean }>();
      for (const row of rows) {
        if (!row.slot_leader) continue;
        const pool = normalizePoolId(row.slot_leader);
        const record = pools.get(pool) ?? { pool_id: pool, completed_epochs_bitmap: 0, produced_current_epoch: false };
        const distance = block.epochNo - Number(row.epoch);
        if (distance === 0) record.produced_current_epoch = true;
        else if (distance >= 1 && distance <= 5) record.completed_epochs_bitmap |= 1 << (distance - 1);
        if (record.completed_epochs_bitmap || record.produced_current_epoch) pools.set(pool, record);
      }
      return { epoch: BigInt(block.epochNo), pools: [...pools.values()].sort((a, b) => a.pool_id.localeCompare(b.pool_id)) };
    });
  }

  async findEpochContextAtBlock(block: HistoryBlock): Promise<HistoryEpochContextAtBlock | null> {
    validatePublicNetworkStabilityConfig(
      this.configService.get<string>('cardanoNetwork'),
      this.configService.get<string>('cardanoEpochParamsEndpoint'),
    );
    const slotBounds = await this.findEpochSlotBounds(block.epochNo);
    if (!slotBounds) {
      return null;
    }

    const ogmiosEndpoint = this.configService.get<string>('ogmiosEndpoint');
    if (!ogmiosEndpoint) {
      return null;
    }
    const epochNonce = await this.fetchEpochNonce(block.epochNo);

    const localSnapshotDirectory = process.env.CARDANO_LOCAL_EPOCH_SNAPSHOT_DIR;
    if (localSnapshotDirectory) {
      if (!this.isExplicitLocalDevnet()) {
        throw new Error('Local ledger stake snapshots require the explicit magic-42 cardano-devnet configuration');
      }
      const stakeDistribution = (
        await readLocalEpochStake(
          localSnapshotDirectory,
          block.epochNo,
          normalizeHex(process.env.CARDANO_EPOCH_NONCE_GENESIS),
          this.restHistory(),
        )
      ).map((entry) => ({ ...entry, poolId: normalizePoolId(entry.poolId) }));
      const verification = await queryCurrentEpochVerificationData(ogmiosEndpoint, epochNonce);
      return {
        epoch: block.epochNo,
        stakeDistribution,
        verificationContext: { ...verification, ...slotBounds },
      };
    }

    const queryEpochContext = async (pointBlock: Pick<HistoryBlock, 'slotNo' | 'hash'>) =>
      queryEpochContextAtPoint(
        ogmiosEndpoint,
        {
          slot: pointBlock.slotNo,
          hash: pointBlock.hash,
        },
        epochNonce,
        process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE === '1',
      );

    let epochContext;
    try {
      epochContext = await queryEpochContext(block);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallbackBlock = await this.findLatestBlockInEpoch(block.epochNo);
      const canRetryWithSameEpochPoint =
        fallbackBlock && fallbackBlock.height !== block.height && this.isStaleOgmiosPointError(message);

      if (!canRetryWithSameEpochPoint) {
        if (this.isStaleOgmiosPointError(message)) {
          return this.findStalePointEpochContextFallback(block, slotBounds, ogmiosEndpoint, epochNonce);
        }
        throw error;
      }

      try {
        epochContext = await queryEpochContext(fallbackBlock);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        if (this.isStaleOgmiosPointError(fallbackMessage)) {
          return this.findStalePointEpochContextFallback(block, slotBounds, ogmiosEndpoint, epochNonce);
        }
        throw fallbackError;
      }
    }

    if (epochContext.currentEpoch !== block.epochNo) {
      throw new Error(
        `Ogmios acquired epoch ${epochContext.currentEpoch} at block ${block.height}, expected epoch ${block.epochNo}`,
      );
    }

    const ogmiosStakeDistribution: HistoryStakeDistributionEntry[] = epochContext.stakeDistribution.map((entry) => ({
      poolId: normalizePoolId(entry.poolId),
      stake: entry.stake,
      vrfKeyHash: normalizeHex(entry.vrfKeyHash),
      relativeStakeNumerator: entry.relativeStakeNumerator,
      relativeStakeDenominator: entry.relativeStakeDenominator,
    }));
    const stakeDistribution = await this.findCurrentEpochStakeSnapshot(block, ogmiosStakeDistribution);
    if (stakeDistribution === null) {
      const historicalStakeEndpoint = this.configService.get<string>('cardanoEpochParamsEndpoint')?.replace(/\/+$/, '');
      if (!historicalStakeEndpoint) {
        throw new Error(`Historical stake-distribution endpoint unavailable for completed epoch ${block.epochNo}`);
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
        firstRegistrationSlot: firstRegistrationSlots.get(entry.poolId) ?? entry.firstRegistrationSlot ?? null,
      })),
      verificationContext: {
        epochNonce: epochContext.epochNonce,
        slotsPerKesPeriod: epochContext.slotsPerKesPeriod,
        maxKesEvolutions: epochContext.maxKesEvolutions,
        activeSlotCoefficientNumerator: epochContext.activeSlotCoefficientNumerator,
        activeSlotCoefficientDenominator: epochContext.activeSlotCoefficientDenominator,
        currentEpochStartSlot: slotBounds.currentEpochStartSlot,
        currentEpochEndSlotExclusive: slotBounds.currentEpochEndSlotExclusive,
      },
    };
  }

  async findOperationalCertificateCountersAtBlock(block: HistoryBlock): Promise<Map<string, bigint>> {
    const ogmiosEndpoint = this.configService.get<string>('ogmiosEndpoint');
    if (!ogmiosEndpoint) {
      throw new Error('Ogmios endpoint is required to query operational certificate counters');
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
    const cardanoNetwork = this.configService.get<string>('cardanoNetwork');
    const isPublicNetwork =
      cardanoNetwork === 'Preprod' || cardanoNetwork === 'Preview' || cardanoNetwork === 'Mainnet';
    const endpoint = this.configService.get<string>('cardanoEpochParamsEndpoint')?.trim().replace(/\/+$/, '');
    if (!isPublicNetwork) {
      const localEndpoint = this.configService.get<string>('cardanoLocalEpochContextEndpoint')?.trim();
      if (localEndpoint) {
        return this.findLocalEpochStakeSnapshot(localEndpoint, block.epochNo);
      }
      return ogmiosStakeDistribution;
    }
    if (!endpoint) {
      throw new Error(`CARDANO_BLOCKFROST_ENDPOINT is required for stake-weighted-stability on ${cardanoNetwork}`);
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

    const tipEpoch = await this.fetchBlockfrostTipEpoch(endpoint);
    if (tipEpoch < block.epochNo) {
      throw new Error(
        `Blockfrost tip epoch ${tipEpoch} is behind requested block epoch ${block.epochNo}; refusing live Ogmios stake fallback`,
      );
    }
    if (tipEpoch > block.epochNo) {
      // The requested epoch is complete. Ogmios liveStakeDistribution is a
      // current-ledger wallet distribution, not the epoch's Praos Set snapshot.
      // Signal the caller to use the completed-epoch reconstruction instead.
      return null;
    }

    const lookup = this.buildCurrentEpochStakeSnapshot(endpoint, block, ogmiosStakeDistribution);
    this.currentEpochStakeSnapshotLookups.set(cacheKey, lookup);
    try {
      const snapshot = await lookup;
      this.currentEpochStakeSnapshotCache.set(cacheKey, snapshot);
      return snapshot.map((entry) => ({ ...entry }));
    } finally {
      this.currentEpochStakeSnapshotLookups.deleteIfValue(cacheKey, lookup);
    }
  }

  private async findLocalEpochStakeSnapshot(endpoint: string, epoch: number): Promise<HistoryStakeDistributionEntry[]> {
    const url = new URL(`${endpoint.replace(/\/+$/, '')}/epoch_stake`);
    url.searchParams.set('_epoch_no', epoch.toString());
    const response = await fetch(url, {
      signal: AbortSignal.timeout(EPOCH_PARAMS_LOOKUP_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Local epoch stake lookup failed for epoch ${epoch}: HTTP ${response.status}`);
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Local epoch stake response must be an object');
    }
    const snapshot = body as Record<string, unknown>;
    if (snapshot.epoch_no !== epoch) {
      throw new Error(`Local epoch stake response does not match epoch ${epoch}`);
    }
    const positiveStake = (value: unknown): bigint => {
      if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
        throw new Error('Local epoch stake values must be positive decimal strings');
      }
      return BigInt(value);
    };
    const totalStake = positiveStake(snapshot.total_active_stake);
    if (!Array.isArray(snapshot.pools) || snapshot.pools.length === 0) {
      throw new Error(`Local epoch stake response has no active pools for epoch ${epoch}`);
    }
    const seen = new Set<string>();
    const distribution = snapshot.pools.map((row: unknown): HistoryStakeDistributionEntry => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error('Local epoch stake contains an invalid pool row');
      }
      const pool = row as Record<string, unknown>;
      if (typeof pool.pool_id_hex !== 'string' || !/^[0-9a-f]{56}$/i.test(pool.pool_id_hex)) {
        throw new Error('Local epoch stake contains an invalid pool id');
      }
      const poolId = normalizePoolId(pool.pool_id_hex);
      if (seen.has(poolId)) {
        throw new Error(`Local epoch stake contains duplicate pool ${poolId}`);
      }
      seen.add(poolId);
      const stake = positiveStake(pool.active_stake);
      const vrfKeyHash = pool.vrf_key_hash;
      if (typeof vrfKeyHash !== 'string' || !/^[0-9a-f]{64}$/.test(vrfKeyHash)) {
        throw new Error(`Frozen VRF key is unavailable for local epoch pool ${poolId}`);
      }
      return {
        poolId,
        stake,
        vrfKeyHash,
        relativeStakeNumerator: stake,
        relativeStakeDenominator: totalStake,
      };
    });
    if (distribution.reduce((total, pool) => total + pool.stake, 0n) !== totalStake) {
      throw new Error(`Local epoch stake total does not match active stake for epoch ${epoch}`);
    }
    return distribution.sort((left, right) => left.poolId.localeCompare(right.poolId));
  }

  private async buildCurrentEpochStakeSnapshot(
    endpoint: string,
    block: HistoryBlock,
    ogmiosStakeDistribution: HistoryStakeDistributionEntry[],
  ): Promise<HistoryStakeDistributionEntry[]> {
    const [poolRows, totalActiveStake] = await Promise.all([
      this.fetchBlockfrostCurrentEpochPoolList(endpoint, block.epochNo),
      this.fetchBlockfrostEpochActiveStake(endpoint, block.epochNo),
    ]);
    const stakeByPool = new Map<string, bigint>();
    for (const row of poolRows) {
      const poolId = normalizePoolId(row.pool_id ?? row.hex);
      if (!poolId) {
        throw new Error(`Blockfrost returned an invalid current epoch pool id for epoch ${block.epochNo}`);
      }
      if (row.active_stake === null || row.active_stake === undefined || row.active_stake === '') {
        continue;
      }
      const stake = parseNonNegativeBigInt(row.active_stake);
      if (stake === null) {
        throw new Error(`Blockfrost returned an invalid current epoch stake entry for epoch ${block.epochNo}`);
      }
      if (stake === 0n) {
        continue;
      }
      if (stakeByPool.has(poolId)) {
        throw new Error(
          `Blockfrost returned duplicate current epoch stake for pool ${poolId} in epoch ${block.epochNo}`,
        );
      }
      stakeByPool.set(poolId, stake);
    }

    if (stakeByPool.size === 0) {
      throw new Error(`Blockfrost returned an empty current epoch stake snapshot for epoch ${block.epochNo}`);
    }

    const snapshotTotal = Array.from(stakeByPool.values()).reduce((sum, stake) => sum + stake, 0n);
    if (snapshotTotal > totalActiveStake) {
      throw new Error(
        `Blockfrost current epoch stake snapshot total ${snapshotTotal.toString()} exceeds epoch ${block.epochNo} active stake ${totalActiveStake.toString()}`,
      );
    }

    const vrfByPool = new Map(ogmiosStakeDistribution.map((entry) => [entry.poolId, normalizeHex(entry.vrfKeyHash)]));
    const missingVrfPoolIds = Array.from(stakeByPool.keys()).filter(
      (poolId) => !/^[0-9a-f]{64}$/.test(vrfByPool.get(poolId) ?? ''),
    );
    if (missingVrfPoolIds.length > 0) {
      const registrationEndpoint =
        this.configService.get<string>('cardanoPoolRegistrationHistoryEndpoint')?.replace(/\/+$/, '') || endpoint;
      const updates = await this.fetchHistoricalProducerRegistrationUpdates(registrationEndpoint, missingVrfPoolIds);
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

    const stakeDistribution: HistoryStakeDistributionEntry[] = Array.from(stakeByPool.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([poolId, stake]) => {
        const vrfKeyHash = normalizeHex(vrfByPool.get(poolId));
        if (!/^[0-9a-f]{64}$/.test(vrfKeyHash)) {
          throw new Error(`Current epoch VRF key hash unavailable for pool ${poolId} in epoch ${block.epochNo}`);
        }
        return {
          poolId,
          stake,
          vrfKeyHash,
          relativeStakeNumerator: stake,
          relativeStakeDenominator: totalActiveStake,
        };
      });
    const unproducedStake = totalActiveStake - snapshotTotal;
    if (unproducedStake > 0n) {
      stakeDistribution.push({
        poolId: `${HISTORICAL_STAKE_REMAINDER_POOL_PREFIX}:${block.epochNo}`,
        stake: unproducedStake,
        vrfKeyHash: '00'.repeat(32),
        firstRegistrationSlot: 1n,
        relativeStakeNumerator: unproducedStake,
        relativeStakeDenominator: totalActiveStake,
      });
    }
    return stakeDistribution;
  }

  private async fetchBlockfrostTipEpoch(endpoint: string): Promise<number> {
    const row = (await this.fetchBlockfrostJson(
      new URL(`${endpoint}/blocks/latest`),
      'current Cardano epoch',
    )) as BlockfrostTipRow;
    const epoch = Number(row?.epoch);
    if (!Number.isSafeInteger(epoch) || epoch < 0) {
      throw new Error('Blockfrost did not return a valid current Cardano epoch');
    }
    return epoch;
  }

  private async fetchBlockfrostCurrentEpochPoolList(endpoint: string, epoch: number): Promise<BlockfrostPoolListRow[]> {
    const rows: BlockfrostPoolListRow[] = [];
    for (let page = 1; page <= CURRENT_EPOCH_STAKE_MAX_PAGES; page += 1) {
      const url = new URL(`${endpoint}/pools/extended`);
      url.searchParams.set('count', CURRENT_EPOCH_STAKE_PAGE_SIZE.toString());
      url.searchParams.set('page', page.toString());
      const pageRows = (await this.fetchBlockfrostArray(
        url,
        `current epoch stake pool page ${page} for epoch ${epoch}`,
      )) as BlockfrostPoolListRow[];
      rows.push(...pageRows);
      if (pageRows.length < CURRENT_EPOCH_STAKE_PAGE_SIZE) {
        return rows;
      }
    }

    throw new Error(
      `Blockfrost current epoch stake pool list exceeded ${
        CURRENT_EPOCH_STAKE_MAX_PAGES * CURRENT_EPOCH_STAKE_PAGE_SIZE
      } rows for epoch ${epoch}`,
    );
  }

  private async fetchBlockfrostEpochActiveStake(endpoint: string, epoch: number): Promise<bigint> {
    const row = (await this.fetchBlockfrostJson(
      new URL(`${endpoint}/epochs/${epoch}`),
      `active stake for epoch ${epoch}`,
    )) as BlockfrostEpochInfoRow;
    if (Number(row?.epoch) !== epoch) {
      throw new Error(`Blockfrost did not return active stake for epoch ${epoch}`);
    }
    return parsePositiveBigInt(row.active_stake, `active stake for epoch ${epoch}`);
  }

  private isStaleOgmiosPointError(message: string): boolean {
    return message.includes('Target point is too old') || message.includes('Failed to acquire requested point');
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
    const cardanoNetwork = this.configService.get<string>('cardanoNetwork');
    const isPublicNetwork =
      cardanoNetwork === 'Preprod' || cardanoNetwork === 'Preview' || cardanoNetwork === 'Mainnet';
    const historicalStakeEndpoint = this.configService.get<string>('cardanoEpochParamsEndpoint')?.replace(/\/+$/, '');

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

    const localEndpoint = this.configService.get<string>('cardanoLocalEpochContextEndpoint')?.trim();
    if (localEndpoint) {
      return this.findObservedLocalEpochContext(block, slotBounds, ogmiosEndpoint, epochNonce, localEndpoint);
    }

    if (
      process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT !== undefined &&
      process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE === '1'
    ) {
      return this.findLocalStalePointEpochContextFallback(block, slotBounds, ogmiosEndpoint, epochNonce);
    }

    throw new Error(
      `Ogmios can no longer acquire epoch ${block.epochNo}, and no historical stake-distribution fallback is configured`,
    );
  }

  private async findObservedLocalEpochContext(
    block: HistoryBlock,
    slotBounds: { currentEpochStartSlot: bigint; currentEpochEndSlotExclusive: bigint },
    ogmiosEndpoint: string,
    epochNonce: string,
    endpoint: string,
  ): Promise<HistoryEpochContextAtBlock> {
    // Genesis parameters are constant for this chain. Stake and VRF keys must
    // come from the recorded epoch, even when Ogmios has forgotten its blocks.
    const [verification, stakeDistribution] = await Promise.all([
      queryCurrentEpochVerificationData(ogmiosEndpoint, epochNonce),
      this.findLocalEpochStakeSnapshot(endpoint, block.epochNo),
    ]);
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
        epochNonce: verification.epochNonce,
        slotsPerKesPeriod: verification.slotsPerKesPeriod,
        maxKesEvolutions: verification.maxKesEvolutions,
        activeSlotCoefficientNumerator: verification.activeSlotCoefficientNumerator,
        activeSlotCoefficientDenominator: verification.activeSlotCoefficientDenominator,
        ...slotBounds,
      },
    };
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
      this.restHistory()
        .epochBlocks(block.epochNo)
        .then((blocks) => [
          {
            block_count: String(blocks.length),
            pool_ids: [...new Set(blocks.map((item) => item.slot_leader))],
          },
        ]),
      queryCurrentEpochVerificationData(ogmiosEndpoint, epochNonce),
    ]);
    const producerSummary = (producerSummaryRows as HistoricalEpochProducerSummaryRow[])[0];
    const indexedBlockCount = Number(producerSummary?.block_count);
    const producerPoolIds = Array.from(
      new Set((producerSummary?.pool_ids ?? []).map((poolId) => normalizePoolId(poolId)).filter(Boolean)),
    ).sort();

    if (!Number.isSafeInteger(indexedBlockCount) || indexedBlockCount <= 0) {
      throw new Error(
        `Yaci has no complete block history for historical stake reconstruction in epoch ${block.epochNo}`,
      );
    }
    if (producerPoolIds.length === 0) {
      throw new Error(`Yaci has no slot leaders for historical stake reconstruction in epoch ${block.epochNo}`);
    }

    const registrationEndpoint =
      this.configService.get<string>('cardanoPoolRegistrationHistoryEndpoint')?.replace(/\/+$/, '') ||
      historicalStakeEndpoint;
    const epochInfo = await this.fetchHistoricalEpochInfo(historicalStakeEndpoint, block.epochNo);
    if (epochInfo.blockCount !== indexedBlockCount) {
      throw new Error(
        `Yaci epoch ${block.epochNo} history is incomplete: indexed ${indexedBlockCount} of ${epochInfo.blockCount} blocks`,
      );
    }

    const [stakeByPool, registrationUpdates] = await Promise.all([
      this.fetchHistoricalProducerStakes(historicalStakeEndpoint, block.epochNo, producerPoolIds),
      this.fetchHistoricalProducerRegistrationUpdates(registrationEndpoint, producerPoolIds),
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
        throw new Error(`Historical stake evidence is incomplete for pool ${poolId} in epoch ${block.epochNo}`);
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
    const producerStake = stakeDistribution.reduce((sum, entry) => sum + entry.stake, 0n);
    if (producerStake > epochInfo.totalActiveStake) {
      throw new Error(`Historical producer stake exceeds total active stake in epoch ${block.epochNo}`);
    }

    const unproducedStake = epochInfo.totalActiveStake - producerStake;
    if (unproducedStake > 0n) {
      // The verifier needs exact stake for every possible block producer and the
      // exact total active stake. Pools that produced no blocks in this completed
      // epoch can be represented by one deliberately non-pool aggregate entry.
      stakeDistribution.push({
        poolId: `${HISTORICAL_STAKE_REMAINDER_POOL_PREFIX}:${block.epochNo}`,
        stake: unproducedStake,
        vrfKeyHash: '00'.repeat(32),
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
        activeSlotCoefficientNumerator: verificationContext.activeSlotCoefficientNumerator,
        activeSlotCoefficientDenominator: verificationContext.activeSlotCoefficientDenominator,
        currentEpochStartSlot: slotBounds.currentEpochStartSlot,
        currentEpochEndSlotExclusive: slotBounds.currentEpochEndSlotExclusive,
      },
    };
  }

  private async fetchHistoricalEpochInfo(
    endpoint: string,
    epoch: number,
  ): Promise<{ totalActiveStake: bigint; blockCount: number }> {
    const row = (await this.fetchBlockfrostJson(
      new URL(`${endpoint}/epochs/${epoch}`),
      `historical epoch information for epoch ${epoch}`,
    )) as BlockfrostEpochInfoRow;
    if (Number(row?.epoch) !== epoch) {
      throw new Error(`Blockfrost did not return historical epoch information for epoch ${epoch}`);
    }

    const totalActiveStake = parsePositiveBigInt(row.active_stake, `active stake for epoch ${epoch}`);
    const blockCount = Number(row.block_count);
    if (!Number.isSafeInteger(blockCount) || blockCount <= 0) {
      throw new Error(`Blockfrost returned an invalid block count for epoch ${epoch}`);
    }
    return { totalActiveStake, blockCount };
  }

  private async fetchHistoricalProducerStakes(
    endpoint: string,
    epoch: number,
    poolIds: string[],
  ): Promise<Map<string, bigint>> {
    const stakeByPool = new Map<string, bigint>();
    for (let index = 0; index < poolIds.length; index += HISTORICAL_STAKE_POOL_CONCURRENCY) {
      const batch = poolIds.slice(index, index + HISTORICAL_STAKE_POOL_CONCURRENCY);
      const rows = await Promise.all(
        batch.map(async (poolId) => {
          return [poolId, await this.fetchBlockfrostPoolStake(endpoint, poolId, epoch)] as const;
        }),
      );
      for (const [poolId, stake] of rows) {
        stakeByPool.set(poolId, stake);
      }
    }
    return stakeByPool;
  }

  private async fetchBlockfrostPoolStake(endpoint: string, poolId: string, epoch: number): Promise<bigint> {
    for (let page = 1; page <= 50; page += 1) {
      const url = new URL(`${endpoint}/pools/${poolId}/history`);
      url.searchParams.set('order', 'desc');
      url.searchParams.set('count', '100');
      url.searchParams.set('page', page.toString());
      const history = (await this.fetchBlockfrostArray(
        url,
        `historical stake for pool ${poolId} in epoch ${epoch}`,
      )) as BlockfrostPoolHistoryRow[];
      const matches = history.filter((row) => Number(row.epoch) === epoch);
      if (matches.length === 1) {
        return parsePositiveBigInt(matches[0].active_stake, `active stake for pool ${poolId} in epoch ${epoch}`);
      }
      if (matches.length > 1) {
        throw new Error(`Blockfrost returned duplicate historical stake for pool ${poolId} in epoch ${epoch}`);
      }
      if (history.length === 0 || history.some((row) => Number(row.epoch) < epoch)) {
        break;
      }
    }
    // The epoch-stakes route reads the same delegated-stake snapshot directly.
    // It also covers an epoch before the derived pool-history row is available.
    let total = 0n;
    let found = false;
    for (let page = 1; page <= 1_000; page += 1) {
      const url = new URL(`${endpoint}/epochs/${epoch}/stakes/${poolId}`);
      url.searchParams.set('count', '100');
      url.searchParams.set('page', page.toString());
      const rows = (await this.fetchBlockfrostArray(url, `epoch ${epoch} stake for pool ${poolId}`)) as {
        amount?: string | number | null;
      }[];
      for (const row of rows) {
        const amount = parseNonNegativeBigInt(row.amount);
        if (amount === null) {
          throw new Error(`Blockfrost returned invalid stake for pool ${poolId} in epoch ${epoch}`);
        }
        total += amount;
        found = true;
      }
      if (rows.length < 100) {
        if (!found || total === 0n) {
          throw new Error(`Blockfrost did not return historical stake for pool ${poolId} in epoch ${epoch}`);
        }
        return total;
      }
    }
    throw new Error(`Blockfrost epoch ${epoch} stake for pool ${poolId} exceeded 100,000 delegators`);
  }

  private async fetchHistoricalProducerRegistrationUpdates(
    endpoint: string,
    poolIds: string[],
  ): Promise<BlockfrostPoolUpdateRow[]> {
    const updates: BlockfrostPoolUpdateRow[] = [];
    for (let index = 0; index < poolIds.length; index += POOL_REGISTRATION_LOOKUP_BATCH_SIZE) {
      const batch = poolIds.slice(index, index + POOL_REGISTRATION_LOOKUP_BATCH_SIZE);
      const results = await Promise.all(
        batch.map((poolId) => this.fetchBlockfrostPoolRegistrationUpdates(endpoint, poolId)),
      );
      for (const rows of results) updates.push(...rows);
    }
    return updates;
  }

  private resolveHistoricalProducerRegistrations(
    updates: BlockfrostPoolUpdateRow[],
    poolIds: string[],
    epoch: number,
    referenceBlock: Pick<HistoryBlock, 'slotNo' | 'timestampUnixNs'>,
  ): Map<string, { vrfKeyHash: string; firstRegistrationSlot: bigint }> {
    const requestedPools = new Set(poolIds);
    const firstRegistrationByPool = new Map<string, bigint>();
    const effectiveRegistrationByPool = new Map<
      string,
      { activeEpoch: number; registrationSlot: bigint; vrfKeyHash: string }
    >();

    for (const update of updates) {
      if (update.update_type && update.update_type !== 'registration') {
        continue;
      }
      const poolId = normalizePoolId(update.pool_id_bech32 ?? update.pool_id_hex);
      if (!poolId || !requestedPools.has(poolId)) {
        continue;
      }

      const registrationSlot =
        update.registration_slot !== undefined
          ? parseNonNegativeBigInt(update.registration_slot)
          : update.block_time === null || update.block_time === undefined
            ? null
            : this.trySlotFromUnixSeconds(update.block_time, referenceBlock);
      if (registrationSlot !== null) {
        const encodedRegistrationSlot = registrationSlot > 0n ? registrationSlot : 1n;
        const existing = firstRegistrationByPool.get(poolId);
        if (existing === undefined || encodedRegistrationSlot < existing) {
          firstRegistrationByPool.set(poolId, encodedRegistrationSlot);
        }
      }

      const activeEpoch = Number(update.active_epoch_no);
      const vrfKeyHash = normalizeHex(update.vrf_key_hash);
      if (!Number.isSafeInteger(activeEpoch) || activeEpoch > epoch || !/^[0-9a-f]{64}$/.test(vrfKeyHash)) {
        continue;
      }
      const updateSlot = registrationSlot ?? 0n;
      const current = effectiveRegistrationByPool.get(poolId);
      if (
        !current ||
        activeEpoch > current.activeEpoch ||
        (activeEpoch === current.activeEpoch && updateSlot >= current.registrationSlot)
      ) {
        effectiveRegistrationByPool.set(poolId, {
          activeEpoch,
          registrationSlot: updateSlot,
          vrfKeyHash,
        });
      }
    }

    const resolved = new Map<string, { vrfKeyHash: string; firstRegistrationSlot: bigint }>();
    for (const poolId of poolIds) {
      const firstRegistrationSlot = firstRegistrationByPool.get(poolId);
      const effectiveRegistration = effectiveRegistrationByPool.get(poolId);
      if (!firstRegistrationSlot || !effectiveRegistration) {
        throw new Error(
          `Blockfrost did not return complete historical registration data for pool ${poolId} in epoch ${epoch}`,
        );
      }
      resolved.set(poolId, {
        vrfKeyHash: effectiveRegistration.vrfKeyHash,
        firstRegistrationSlot,
      });
    }
    return resolved;
  }

  private async fetchBlockfrostJson(url: URL, context: string): Promise<unknown> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < HISTORICAL_STAKE_LOOKUP_MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HISTORICAL_STAKE_LOOKUP_TIMEOUT_MS);
      let retryDelayMs = HISTORICAL_STAKE_RETRY_DELAY_MS;
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: this.blockfrostRequestHeaders(),
        });
        if (response.ok) {
          const body = await response.json();
          return body;
        }

        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new HistoricalStakeLookupError(
          `Blockfrost lookup failed for ${context}: HTTP ${response.status}`,
          retryable,
          retryable ? parseRetryAfterMs(response.headers) : undefined,
        );
      } catch (error) {
        const lookupError =
          error instanceof HistoricalStakeLookupError
            ? error
            : error instanceof Error && error.name === 'AbortError'
              ? new HistoricalStakeLookupError(
                  `Blockfrost lookup timed out for ${context} after ${HISTORICAL_STAKE_LOOKUP_TIMEOUT_MS}ms`,
                  true,
                )
              : error instanceof TypeError
                ? new HistoricalStakeLookupError(`Blockfrost lookup failed for ${context}: ${error.message}`, true)
                : new HistoricalStakeLookupError(error instanceof Error ? error.message : String(error), false);
        if (!lookupError.retryable) {
          throw lookupError;
        }
        lastError = lookupError;
        retryDelayMs = Math.min(lookupError.retryAfterMs ?? retryDelayMs, HISTORICAL_STAKE_RETRY_MAX_DELAY_MS);
      } finally {
        clearTimeout(timeout);
      }

      if (attempt + 1 >= HISTORICAL_STAKE_LOOKUP_MAX_ATTEMPTS) {
        break;
      }
      await sleep(retryDelayMs);
    }
    throw lastError ?? new Error(`Blockfrost lookup failed for ${context}`);
  }

  private async fetchBlockfrostArray(url: URL, context: string): Promise<unknown[]> {
    const body = await this.fetchBlockfrostJson(url, context);
    if (!Array.isArray(body)) {
      throw new Error(`Blockfrost returned an invalid response for ${context}`);
    }
    return body;
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
      queryCurrentEpochStakeDistribution(ogmiosEndpoint, process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE === '1'),
    ]);

    const stakeDistribution: HistoryStakeDistributionEntry[] = currentStakeDistribution.map((entry) => ({
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
        activeSlotCoefficientNumerator: verificationContext.activeSlotCoefficientNumerator,
        activeSlotCoefficientDenominator: verificationContext.activeSlotCoefficientDenominator,
        currentEpochStartSlot: slotBounds.currentEpochStartSlot,
        currentEpochEndSlotExclusive: slotBounds.currentEpochEndSlotExclusive,
      },
    };
  }

  async findClientUtxosByBlockNo(height: number): Promise<UtxoDto[]> {
    const deployment = this.configService.get('deployment');
    const prefix = this.lucidService.generateTokenName(deployment.hostStateNFT, CLIENT_PREFIX, 0n).slice(0, 40);
    return (await this.findUtxosByBlockNo(height)).filter(
      (output) =>
        output.assetsPolicy === deployment.validators.mintClientStt.scriptHash && output.assetsName.startsWith(prefix),
    );
  }

  async checkExistPoolUpdateByBlockNo(height: number): Promise<boolean> {
    return (await this.restHistory().blockTransactions(height)).some((tx) => this.hasCertificate(tx, 'register'));
  }

  async checkExistPoolRetireByBlockNo(height: number): Promise<boolean> {
    return (await this.restHistory().blockTransactions(height)).some((tx) => this.hasCertificate(tx, 'retire'));
  }

  private hasCertificate(tx: RestTransaction, kind: 'register' | 'retire'): boolean {
    if (!tx.valid) return false;
    const certificates = tx.body.certs();
    for (let i = 0; certificates && i < certificates.len(); i++) {
      const cert = certificates.get(i);
      if (kind === 'register' ? cert.as_pool_registration() : cert.as_pool_retirement()) return true;
    }
    return false;
  }

  private async fetchEpochNonce(epoch: number): Promise<string> {
    const endpoint = this.configService.get<string>('cardanoEpochParamsEndpoint')?.replace(/\/+$/, '');
    if (!endpoint) {
      if (this.isExplicitLocalDevnet()) {
        throw new Error(
          'Local epoch nonces require CARDANO_EPOCH_PARAMS_ENDPOINT. Direct Yaci database nonce reads are no longer supported',
        );
      }
      const localEpochNonceOverride = normalizeHex(process.env.CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE);
      if (
        process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT !== undefined &&
        /^[0-9a-f]{64}$/.test(localEpochNonceOverride)
      ) {
        return localEpochNonceOverride;
      }

      const genesisNonce = normalizeHex(process.env.CARDANO_EPOCH_NONCE_GENESIS);
      if (epoch === 0 && /^[0-9a-f]{64}$/.test(genesisNonce)) {
        return genesisNonce;
      }
      if (
        process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT !== undefined &&
        /^[0-9a-f]{64}$/.test(genesisNonce)
      ) {
        return genesisNonce;
      }
      throw new Error(`Cardano epoch params endpoint unavailable for epoch ${epoch}`);
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

  private isExplicitLocalDevnet(): boolean {
    // Never infer this exception from the configuration's local defaults.
    return (
      process.env.CARDANO_CHAIN_ID === 'cardano-devnet' &&
      process.env.CARDANO_NETWORK_MAGIC === '42' &&
      process.env.CARDANO_CHAIN_NETWORK_MAGIC === '42' &&
      this.configService.get<string>('cardanoChainId') === 'cardano-devnet' &&
      this.configService.get<number>('cardanoChainNetworkMagic') === 42 &&
      this.configService.get<string>('cardanoNetwork') === 'Custom'
    );
  }

  private epochNonceCacheKey(epoch: number): string {
    const chainId = this.configService.get<string>('cardanoChainId') || '';
    const network = this.configService.get<string>('cardanoNetwork') || '';
    const networkMagic = this.configService.get<number>('cardanoChainNetworkMagic');
    return `${chainId}:${network}:${networkMagic ?? ''}:${epoch}`;
  }

  private cacheEpochNonce(cacheKey: string, nonce: string): void {
    this.epochNonceCache.set(cacheKey, nonce);
  }

  private async fetchEpochNonceWithRetry(endpoint: string, epoch: number): Promise<string> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < EPOCH_PARAMS_LOOKUP_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.fetchEpochNonceAttempt(endpoint, epoch);
      } catch (error) {
        const lookupError = error instanceof Error ? error : new Error(String(error));
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
        const retryDelay = Math.min(lookupError.retryAfterMs ?? exponentialDelay, EPOCH_PARAMS_RETRY_MAX_DELAY_MS);
        await sleep(retryDelay);
      }
    }
    throw lastError ?? new Error(`Cardano epoch params lookup failed for epoch ${epoch}`);
  }

  private async fetchEpochNonceAttempt(endpoint: string, epoch: number): Promise<string> {
    const url = new URL(`${endpoint}/epochs/${epoch}/parameters`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EPOCH_PARAMS_LOOKUP_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: this.blockfrostRequestHeaders(),
      });
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new EpochParamsLookupError(
          `Cardano epoch params lookup failed for epoch ${epoch}: HTTP ${response.status}`,
          retryable,
          retryable ? parseRetryAfterMs(response.headers) : undefined,
        );
      }

      const body = await response.json();
      const row = body as BlockfrostEpochParamsRow;
      const epochNo = row?.epoch;
      const returnedEpoch = typeof epochNo === 'string' || typeof epochNo === 'number' ? Number(epochNo) : Number.NaN;
      if (!Number.isSafeInteger(returnedEpoch) || returnedEpoch !== epoch) {
        throw new Error(`Cardano epoch params lookup did not return params for epoch ${epoch}`);
      }
      const nonce = normalizeHex(row?.nonce);
      if (!/^[0-9a-f]{64}$/.test(nonce)) {
        throw new Error(`Cardano epoch params lookup did not return a valid nonce for epoch ${epoch}`);
      }
      return nonce;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
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
    referenceBlock: Pick<HistoryBlock, 'slotNo' | 'timestampUnixNs'>,
  ): Promise<Map<string, bigint>> {
    const mergedSlots = await this.findKnownPoolRegistrationSlots(poolIds);
    const normalizedPoolIds = Array.from(new Set(poolIds.map((poolId) => normalizePoolId(poolId)).filter(Boolean)));
    const missingAfterLocal = normalizedPoolIds.filter((poolId) => !mergedSlots.has(poolId));
    if (missingAfterLocal.length === 0) {
      return mergedSlots;
    }

    const externalSlots = await this.lookupExternalPoolRegistrationSlots(missingAfterLocal, referenceBlock);
    if (externalSlots.size > 0) {
      await this.cachePoolRegistrationSlots(externalSlots, 'external');
    }

    return new Map([...mergedSlots, ...externalSlots]);
  }

  private async findKnownPoolRegistrationSlots(poolIds: string[]): Promise<Map<string, bigint>> {
    const normalizedPoolIds = Array.from(new Set(poolIds.map((poolId) => normalizePoolId(poolId)).filter(Boolean)));
    if (normalizedPoolIds.length === 0) {
      return new Map();
    }

    await this.ensurePoolRegistrationCacheTable();

    const cachedSlots = await this.findCachedPoolRegistrationSlots(normalizedPoolIds);
    const missingAfterCache = normalizedPoolIds.filter((poolId) => !cachedSlots.has(poolId));
    if (missingAfterCache.length === 0) {
      return cachedSlots;
    }

    // Public pool ages can predate the provider's raw-block retention checkpoint.
    // The existing external pool-history provider supplies those registrations.
    const localSlots = this.configService.get<string>('cardanoPoolRegistrationHistoryEndpoint')
      ? new Map<string, bigint>()
      : await this.findLocalPoolRegistrationSlots(missingAfterCache);
    // Chain-derived registration ages are read through REST on each lookup.
    // Only results from the external registration provider are cached.

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
      CREATE TABLE IF NOT EXISTS gateway_pool_registration_cache (
        network_key text NOT NULL,
        pool_id text NOT NULL,
        first_registration_slot bigint NOT NULL,
        source text NOT NULL,
        source_tx_hash varchar(64),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (network_key, pool_id)
      );

      CREATE INDEX IF NOT EXISTS idx_gateway_pool_registration_cache_slot
        ON gateway_pool_registration_cache(first_registration_slot);
    `);
    this.poolRegistrationCacheTableReady = true;
  }

  private async findCachedPoolRegistrationSlots(poolIds: string[]): Promise<Map<string, bigint>> {
    const rows = await this.entityManager.query(
      `
        SELECT lower(pool_id) AS pool_id, first_registration_slot::text AS first_registration_slot
        FROM gateway_pool_registration_cache
        WHERE lower(pool_id) = ANY($1::text[]) AND network_key = $2 AND source = 'external'
      `,
      [poolIds.map((poolId) => poolId.toLowerCase()), this.epochNonceCacheKey(0)],
    );

    return this.mapPoolRegistrationSlotRows(rows);
  }

  private async findLocalPoolRegistrationSlots(poolIds: string[]): Promise<Map<string, bigint>> {
    const source = this.restHistory();
    return source.snapshot('latest', async (tip) => {
      const slots = new Map<string, bigint>();
      const wanted = new Set(poolIds.map(normalizePoolId));
      for await (const row of source.pages('pools/registrations')) {
        if (!wanted.has(normalizePoolId(row.pool_id))) continue;
        const number = Number(row.block_number ?? row.block);
        if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid Yaci pool registration block');
        if (number > tip.number) continue;
        for (const tx of await source.blockTransactions(number)) {
          if (!tx.valid) continue;
          const certificates = tx.body.certs();
          for (let i = 0; certificates && i < certificates.len(); i++) {
            const registration = certificates.get(i).as_pool_registration();
            if (!registration) continue;
            const pool = normalizePoolId(registration.pool_params().operator().to_hex());
            const slot = BigInt(tx.block.slot);
            if (wanted.has(pool) && (!slots.has(pool) || slots.get(pool)! > slot)) slots.set(pool, slot);
          }
        }
      }
      return slots;
    });
  }

  private mapPoolRegistrationSlotRows(
    rows: PoolRegistrationSlotRow[] | CachedPoolRegistrationRow[],
  ): Map<string, bigint> {
    const registrationRows: CachedPoolRegistrationRow[] = rows;
    return new Map(
      registrationRows
        .filter(
          (row): row is PoolRegistrationSlotRow =>
            row.first_registration_slot !== null && row.first_registration_slot !== undefined,
        )
        .map((row) => [normalizePoolId(row.pool_id), BigInt(row.first_registration_slot)]),
    );
  }

  private async cachePoolRegistrationSlots(slotsByPoolId: Map<string, bigint>, source: 'external'): Promise<void> {
    if (slotsByPoolId.size === 0) {
      return;
    }

    const rows = Array.from(slotsByPoolId.entries()).map(([poolId, firstRegistrationSlot]) => ({
      pool_id: poolId,
      first_registration_slot: firstRegistrationSlot.toString(),
    }));

    await this.entityManager.query(
      `
        INSERT INTO gateway_pool_registration_cache(network_key, pool_id, first_registration_slot, source)
        SELECT $3, row.pool_id, row.first_registration_slot::bigint, $2
        FROM jsonb_to_recordset($1::jsonb) AS row(pool_id text, first_registration_slot text)
        ON CONFLICT (network_key, pool_id) DO NOTHING
      `,
      [JSON.stringify(rows), source, this.epochNonceCacheKey(0)],
    );
  }

  private async lookupExternalPoolRegistrationSlots(
    poolIds: string[],
    referenceBlock: Pick<HistoryBlock, 'slotNo' | 'timestampUnixNs'>,
  ): Promise<Map<string, bigint>> {
    const endpoint = this.configService.get<string>('cardanoPoolRegistrationHistoryEndpoint')?.replace(/\/+$/, '');
    if (!endpoint) {
      return new Map();
    }

    const resolvedSlots = new Map<string, bigint>();
    for (let index = 0; index < poolIds.length; index += POOL_REGISTRATION_LOOKUP_BATCH_SIZE) {
      const batch = poolIds.slice(index, index + POOL_REGISTRATION_LOOKUP_BATCH_SIZE);
      const updates = await this.fetchHistoricalProducerRegistrationUpdates(endpoint, batch);

      for (const update of updates) {
        if (update.update_type && update.update_type !== 'registration') {
          continue;
        }

        const poolId = normalizePoolId(update.pool_id_bech32 ?? update.pool_id_hex);
        if (!poolId || !batch.includes(poolId)) {
          continue;
        }

        const firstRegistrationSlot =
          update.registration_slot !== undefined
            ? parseNonNegativeBigInt(update.registration_slot)
            : update.block_time === null || update.block_time === undefined
              ? null
              : this.trySlotFromUnixSeconds(update.block_time, referenceBlock);
        if (firstRegistrationSlot === null) {
          continue;
        }
        if (firstRegistrationSlot <= 0n) {
          continue;
        }
        const existingSlot = resolvedSlots.get(poolId);
        if (existingSlot === undefined || firstRegistrationSlot < existingSlot) {
          resolvedSlots.set(poolId, firstRegistrationSlot);
        }
      }
    }

    return resolvedSlots;
  }

  private async fetchBlockfrostPoolRegistrationUpdates(
    endpoint: string,
    poolId: string,
  ): Promise<BlockfrostPoolUpdateRow[]> {
    const updates: BlockfrostPoolUpdateRow[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const url = new URL(`${endpoint}/pools/${poolId}/updates`);
      url.searchParams.set('order', 'asc');
      url.searchParams.set('count', '100');
      url.searchParams.set('page', page.toString());
      const listed = (await this.fetchBlockfrostArray(url, `pool updates for ${poolId}`)) as {
        tx_hash?: string;
        cert_index?: number;
        action?: string;
      }[];
      for (const item of listed) {
        if (item.action !== 'registered' || !/^[0-9a-f]{64}$/.test(item.tx_hash ?? '')) {
          continue;
        }
        const tx = (await this.fetchBlockfrostJson(
          new URL(`${endpoint}/txs/${item.tx_hash}`),
          `pool registration transaction ${item.tx_hash}`,
        )) as { block_time?: number; slot?: number };
        const certificates = await this.fetchBlockfrostArray(
          new URL(`${endpoint}/txs/${item.tx_hash}/pool_updates`),
          `pool certificates for ${item.tx_hash}`,
        );
        const matching = (
          certificates as { cert_index?: number; pool_id?: string; vrf_key?: string; active_epoch?: number }[]
        ).filter((cert) => cert.cert_index === item.cert_index && normalizePoolId(cert.pool_id) === poolId);
        if (
          matching.length !== 1 ||
          !Number.isSafeInteger(matching[0].active_epoch) ||
          !Number.isSafeInteger(tx.slot)
        ) {
          throw new Error(`Blockfrost returned incomplete pool registration ${item.tx_hash}`);
        }
        updates.push({
          tx_hash: item.tx_hash,
          pool_id_bech32: poolId,
          block_time: tx.block_time,
          registration_slot: tx.slot,
          active_epoch_no: matching[0].active_epoch,
          vrf_key_hash: matching[0].vrf_key,
          update_type: 'registration',
        });
      }
      if (listed.length < 100) return updates;
    }
    throw new Error(`Blockfrost pool updates for ${poolId} exceeded 100 pages`);
  }

  private trySlotFromUnixSeconds(
    unixSeconds: string | number,
    referenceBlock: Pick<HistoryBlock, 'slotNo' | 'timestampUnixNs'>,
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

    const slotLengthNs = BigInt(this.localSlotConfig()?.slotLength ?? 1000) * 1_000_000n;
    const systemStartUnixNs = referenceBlock.timestampUnixNs - referenceBlock.slotNo * slotLengthNs;
    const unixNs = parsedSeconds * NANOSECONDS_PER_SECOND;
    if (unixNs <= systemStartUnixNs) {
      return 0n;
    }

    return (unixNs - systemStartUnixNs) / slotLengthNs;
  }

  async findTxByHash(hash: string): Promise<TxDto | null> {
    const tx = await this.restHistory().transaction(hash);
    return tx?.valid
      ? {
          hash: tx.hash,
          tx_id: 0,
          gas_fee: Number(tx.body.fee()),
          tx_size: tx.cborHex.length / 2,
          height: tx.block.number,
        }
      : null;
  }

  async findIntentSpendingTransaction(hash: string, address: string): Promise<HistoryTxEvidence | null> {
    const source = this.restHistory();
    return source.snapshot('latest', async (tip) => {
      const creation = await source.transaction(hash);
      if (!creation) return null;
      const intentOutputIndexes = new Set(
        creation.outputs.filter((output) => output.address === address).map((output) => output.output_index),
      );
      if (intentOutputIndexes.size === 0) return null;
      const transactions = await source.transactionsFor(
        `addresses/${encodeURIComponent(address)}/transactions`,
        tip.number,
      );
      const matches = transactions.filter((tx) =>
        tx.inputs.some((input) => input.txHash === creation.hash && intentOutputIndexes.has(input.outputIndex)),
      );
      if (matches.length !== 1) return null;
      return this.transactionEvidence(matches[0]);
    });
  }

  async findTransactionEvidenceByHash(hash: string): Promise<HistoryTxEvidence | null> {
    const tx = await this.restHistory().transaction(hash);
    return tx?.valid ? this.transactionEvidence(tx) : null;
  }

  private async transactionEvidence(tx: RestTransaction): Promise<HistoryTxEvidence> {
    const redeemers: HistoryTxRedeemer[] = [];
    const set = tx.transaction.witness_set().redeemers();
    const kind = (tag: number) =>
      tag === CML.RedeemerTag.Mint ? 'mint' : tag === CML.RedeemerTag.Spend ? 'spend' : `tag_${tag}`;
    const map = set?.as_map_redeemer_key_to_redeemer_val();
    const keys = map?.keys();
    if (map && keys)
      for (let i = 0; i < keys.len(); i++) {
        const key = keys.get(i);
        const value = map.get(key)!;
        redeemers.push({ type: kind(key.tag()), index: Number(key.index()), data: value.data().to_cbor_hex() });
      }
    const legacy = set?.as_arr_legacy_redeemer();
    if (legacy)
      for (let i = 0; i < legacy.len(); i++) {
        const item = legacy.get(i);
        redeemers.push({ type: kind(item.tag()), index: Number(item.index()), data: item.data().to_cbor_hex() });
      }
    const token = this.configService.getOrThrow('deployment').hostStateNFT;
    const host = tx.outputs.find((output) =>
      output.amounts.some((amount) => amount.unit === token.policyId + token.name && amount.quantity === '1'),
    );
    const datum = host?.inline_datum ? await this.lucidService.decodeDatum<any>(host.inline_datum, 'host_state') : null;
    return {
      txHash: tx.hash,
      blockNo: tx.block.number,
      blockHash: tx.block.hash,
      slotNo: BigInt(tx.block.slot),
      txIndex: tx.index,
      txCborHex: tx.cborHex,
      txBodyCborHex: tx.bodyCborHex,
      redeemers,
      hostStateOutputIndex: host?.output_index ?? null,
      hostStateDatum: host?.inline_datum ?? null,
      hostStateDatumHash: host?.data_hash ?? null,
      hostStateRoot: datum?.state.ibc_state_root ?? null,
      gasFee: Number(tx.body.fee()),
      txSize: tx.cborHex.length / 2,
    };
  }

  private localSlotConfig(): { zeroTime: number; zeroSlot: number; slotLength: number } | undefined {
    if (this.configService.get<string>('cardanoNetwork') !== 'Custom') return undefined;
    const timing = this.lucidService?.LucidImporter?.SLOT_CONFIG_NETWORK?.Custom;
    if (
      !timing ||
      !Number.isSafeInteger(timing.zeroTime) ||
      !Number.isSafeInteger(timing.slotLength) ||
      timing.slotLength <= 0 ||
      timing.zeroSlot !== 0
    ) {
      throw new Error('Missing local Cardano slot timing from Ogmios');
    }
    return timing;
  }

  private mapHistoryBlockRow(row: HistoryBlockRow): HistoryBlock {
    const blockTimeMs = row.block_time instanceof Date ? row.block_time.valueOf() : Number(row.block_time) * 1_000;
    const timing = this.localSlotConfig();
    // Yaci's block_time stores whole seconds. Derive the exact local timestamp
    // from genesis and the absolute slot so proof timestamps retain milliseconds.
    const timestampUnixNs = timing
      ? (BigInt(timing.zeroTime) + BigInt(row.slot) * BigInt(timing.slotLength)) * 1_000_000n
      : BigInt(blockTimeMs) * 1_000_000n;
    return {
      height: Number(row.number),
      hash: row.hash,
      prevHash: row.prev_hash,
      slotNo: BigInt(row.slot),
      epochNo: Number(row.epoch),
      timestampUnixNs,
      slotLeader: normalizePoolId(row.slot_leader ?? ''),
    };
  }

  private async findEpochSlotBounds(
    epoch: number,
  ): Promise<Pick<HistoryEpochVerificationContext, 'currentEpochStartSlot' | 'currentEpochEndSlotExclusive'> | null> {
    const source = this.restHistory();
    const first = await source.firstBlockInEpoch(epoch);
    if (!first) return null;
    const startSlot = BigInt(first.slot);
    const next = await source.firstBlockInEpoch(epoch + 1);
    const nextEpochStartSlot = next ? BigInt(next.slot) : null;
    const configuredEpochLength = BigInt(this.configService.get<number>('cardanoEpochLength') || 0);
    const currentEpochEndSlotExclusive =
      nextEpochStartSlot ?? (configuredEpochLength > 0n ? startSlot + configuredEpochLength : null);
    if (currentEpochEndSlotExclusive === null) {
      return null;
    }

    return {
      currentEpochStartSlot: startSlot,
      currentEpochEndSlotExclusive,
    };
  }

  private async findLatestBlockInEpoch(epoch: number): Promise<HistoryBlock | null> {
    const last = await this.restHistory().latestBlockInEpoch(epoch);
    return last ? this.findBlockByHeight(BigInt(last.number)) : null;
  }
}

function normalizeHex(value?: string | null): string {
  const trimmed = value?.trim().toLowerCase() || '';
  return trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const retryAfter = headers?.get?.('retry-after')?.trim();
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
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    return null;
  }
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function parsePositiveBigInt(value: string | number | null | undefined, field: string): bigint {
  const parsed = parseNonNegativeBigInt(value);
  if (parsed === null || parsed <= 0n) {
    throw new Error(`Blockfrost returned an invalid ${field}`);
  }
  return parsed;
}

function normalizePoolId(value?: string | null): string {
  const trimmed = value?.trim().toLowerCase() || '';
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('pool1')) {
    return trimmed;
  }
  if (/^[0-9a-f]{56}$/.test(trimmed)) {
    return bech32.encode('pool', bech32.toWords(Buffer.from(trimmed, 'hex')));
  }
  return trimmed;
}
