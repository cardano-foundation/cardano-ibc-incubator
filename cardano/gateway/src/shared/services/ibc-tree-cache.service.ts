import { Injectable, Logger } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import zlib from 'zlib';
import { ICS23MerkleTree } from '../helpers/ics23-merkle-tree';

export const CURRENT_IBC_TREE_CACHE_ID = 'current';

export function ibcTreeCacheIdForRoot(root: string): string {
  return `root:${root.toLowerCase()}`;
}

export function ibcTreeCacheIdForHeight(height: bigint | number | string): string {
  return `height:${height.toString()}`;
}

export function ibcTreeCacheIdForPendingTx(unsignedTxHash: string): string {
  return `pending-tx:${unsignedTxHash.toLowerCase()}`;
}

type CachedTreeRow = {
  id: string;
  root: string;
  leaves_gzip: Buffer;
  updated_at: string;
};

export type PersistedGatewayEvent = {
  type: string;
  attributes: Array<{ key: string; value: string }>;
};

type PersistedTxEventsRow = {
  events_json: PersistedGatewayEvent[] | string;
};

@Injectable()
export class IbcTreeCacheService {
  private readonly logger = new Logger(IbcTreeCacheService.name);
  private txEventsSchemaPromise?: Promise<void>;

  constructor(@InjectEntityManager('gateway') private readonly entityManager: EntityManager) {}

  async ensureSchema(): Promise<void> {
    // Keep this idempotent so prod deployments don't rely on TypeORM synchronize.
    await this.entityManager.query(`
      CREATE TABLE IF NOT EXISTS ibc_state_tree_cache (
        id TEXT PRIMARY KEY,
        root TEXT NOT NULL,
        leaves_gzip BYTEA NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  async load(id: string = CURRENT_IBC_TREE_CACHE_ID): Promise<{ tree: ICS23MerkleTree; root: string } | null> {
    const rows: CachedTreeRow[] = await this.entityManager.query(
      `
        SELECT id, root, leaves_gzip, updated_at
        FROM ibc_state_tree_cache
        WHERE id = $1
        LIMIT 1;
      `,
      [id],
    );
    if (!rows.length) return null;

    const row = rows[0];
    try {
      const jsonBytes = zlib.gunzipSync(row.leaves_gzip);
      const parsed = JSON.parse(jsonBytes.toString('utf8')) as { leaves: Record<string, string>; root?: string };
      const tree = ICS23MerkleTree.fromJSON(parsed);
      const computedRoot = tree.getRoot();

      if (row.root !== computedRoot) {
        this.logger.warn(
          `Cached tree root mismatch for id=${id}, stored=${row.root.substring(0, 16)}..., computed=${computedRoot.substring(0, 16)}..., ignoring cache`,
        );
        return null;
      }

      return { tree, root: computedRoot };
    } catch (error) {
      this.logger.warn(`Failed to decode cached tree for id=${id}, ignoring cache, error=${error?.message ?? error}`);
      return null;
    }
  }

  async save(tree: ICS23MerkleTree, id: string = CURRENT_IBC_TREE_CACHE_ID): Promise<{ root: string }> {
    const root = tree.getRoot();
    const payload = JSON.stringify(tree.toJSON());
    const leavesGzip = zlib.gzipSync(Buffer.from(payload, 'utf8'));

    await this.entityManager.query(
      `
        INSERT INTO ibc_state_tree_cache (id, root, leaves_gzip, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (id)
        DO UPDATE SET root = EXCLUDED.root, leaves_gzip = EXCLUDED.leaves_gzip, updated_at = NOW();
      `,
      [id, root, leavesGzip],
    );

    return { root };
  }

  async saveAliases(tree: ICS23MerkleTree, ids: string[]): Promise<{ root: string }> {
    const uniqueIds = [...new Set(ids.filter((id) => id && id.trim().length > 0))];
    let root = tree.getRoot();
    for (const id of uniqueIds) {
      ({ root } = await this.save(tree, id));
    }
    return { root };
  }

  async savePendingProofState(
    expectedRoot: string,
    unsignedTxHash: string,
    events: PersistedGatewayEvent[],
    tree: ICS23MerkleTree,
    expiresAtMs: number,
  ): Promise<void> {
    const normalizedExpectedRoot = expectedRoot.toLowerCase();
    if (tree.getRoot().toLowerCase() !== normalizedExpectedRoot) {
      throw new Error('Pending IBC tree snapshot does not match its expected root');
    }
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= Date.now()) {
      throw new Error('Pending IBC proof state requires a future expiry');
    }
    await this.ensureSchema();
    await this.ensureTxEventsSchema();

    const normalizedUnsignedTxHash = unsignedTxHash.toLowerCase();
    const payload = JSON.stringify(tree.toJSON());
    const leavesGzip = zlib.gzipSync(Buffer.from(payload, 'utf8'));

    // Remove abandoned unsigned proof transactions. Confirmed event rows are
    // retained for query replay; only unconfirmed rows and their snapshots age out.
    await this.entityManager.query(`
      WITH expired AS (
        DELETE FROM ibc_gateway_tx_events
        WHERE confirmed_tx_hash IS NULL
          AND expires_at <= NOW()
        RETURNING unsigned_tx_hash
      )
      DELETE FROM ibc_state_tree_cache
      WHERE id IN (
        SELECT 'pending-tx:' || unsigned_tx_hash
        FROM expired
      );
    `);

    // Persist the snapshot and its exact event payload atomically.
    const savedRows: Array<{ id: string }> = await this.entityManager.query(
      `
        WITH saved_event AS (
          INSERT INTO ibc_gateway_tx_events (
            expected_root,
            unsigned_tx_hash,
            events_json,
            expires_at,
            created_at,
            updated_at
          )
          VALUES ($2, $4, $5::jsonb, $6::timestamptz, NOW(), NOW())
          ON CONFLICT (unsigned_tx_hash)
          DO UPDATE SET
            expected_root = EXCLUDED.expected_root,
            events_json = EXCLUDED.events_json,
            expires_at = EXCLUDED.expires_at,
            updated_at = NOW()
          WHERE ibc_gateway_tx_events.confirmed_tx_hash IS NULL
          RETURNING unsigned_tx_hash
        )
        INSERT INTO ibc_state_tree_cache (id, root, leaves_gzip, updated_at)
        SELECT $1, $2, $3, NOW()
        FROM saved_event
        ON CONFLICT (id)
        DO UPDATE SET
          root = EXCLUDED.root,
          leaves_gzip = EXCLUDED.leaves_gzip,
          updated_at = NOW()
        RETURNING id;
      `,
      [
        ibcTreeCacheIdForPendingTx(normalizedUnsignedTxHash),
        normalizedExpectedRoot,
        leavesGzip,
        normalizedUnsignedTxHash,
        JSON.stringify(events),
        new Date(expiresAtMs).toISOString(),
      ],
    );
    if (savedRows.length !== 1) {
      throw new Error('Pending IBC proof transaction is already confirmed');
    }
  }

  async loadPendingTreeSnapshot(unsignedTxHash: string): Promise<{ tree: ICS23MerkleTree; root: string } | null> {
    await this.ensureSchema();
    return this.load(ibcTreeCacheIdForPendingTx(unsignedTxHash));
  }

  async deletePendingTreeSnapshot(unsignedTxHash: string): Promise<void> {
    await this.ensureSchema();
    await this.entityManager.query(`DELETE FROM ibc_state_tree_cache WHERE id = $1;`, [
      ibcTreeCacheIdForPendingTx(unsignedTxHash),
    ]);
  }

  async bindTxEventsToConfirmedTransaction(
    unsignedTxHash: string,
    expectedRoot: string,
    confirmedTxHash: string,
  ): Promise<boolean> {
    await this.ensureTxEventsSchema();
    const normalizedUnsignedTxHash = unsignedTxHash.toLowerCase();
    const normalizedExpectedRoot = expectedRoot.toLowerCase();
    const normalizedConfirmedTxHash = confirmedTxHash.toLowerCase();
    let rows: Array<{ unsigned_tx_hash: string }> = await this.entityManager.query(
      `
        UPDATE ibc_gateway_tx_events
        SET confirmed_tx_hash = $3, confirmed_at = NOW(), updated_at = NOW()
        WHERE unsigned_tx_hash = $1
          AND expected_root = $2
          AND (confirmed_tx_hash IS NULL OR confirmed_tx_hash = $3)
        RETURNING unsigned_tx_hash;
      `,
      [normalizedUnsignedTxHash, normalizedExpectedRoot, normalizedConfirmedTxHash],
    );
    if (rows.length > 0) return true;

    rows = await this.entityManager.query(
      `
        WITH unique_candidate AS (
          SELECT MIN(unsigned_tx_hash) AS unsigned_tx_hash
          FROM ibc_gateway_tx_events
          WHERE expected_root = $1
            AND confirmed_tx_hash IS NULL
            AND expires_at > NOW()
          HAVING COUNT(*) = 1
        )
        UPDATE ibc_gateway_tx_events AS events
        SET confirmed_tx_hash = $2, confirmed_at = NOW(), updated_at = NOW()
        FROM unique_candidate
        WHERE events.unsigned_tx_hash = unique_candidate.unsigned_tx_hash
          AND events.expected_root = $1
          AND events.confirmed_tx_hash IS NULL
        RETURNING events.unsigned_tx_hash;
      `,
      [normalizedExpectedRoot, normalizedConfirmedTxHash],
    );
    return rows.length === 1;
  }

  async loadTxEventsByConfirmedHash(confirmedTxHash: string): Promise<PersistedGatewayEvent[] | null> {
    await this.ensureTxEventsSchema();
    // A Cardano transaction id hashes the body, so adding witnesses does not
    // change the unsigned id. The unsigned lookup survives a restart before bind.
    const rows: PersistedTxEventsRow[] = await this.entityManager.query(
      `
        SELECT events_json
        FROM ibc_gateway_tx_events
        WHERE confirmed_tx_hash = $1
           OR (confirmed_tx_hash IS NULL AND unsigned_tx_hash = $1)
        ORDER BY CASE WHEN confirmed_tx_hash = $1 THEN 0 ELSE 1 END
        LIMIT 1;
      `,
      [confirmedTxHash.toLowerCase()],
    );
    if (!rows.length) return null;
    return this.decodePersistedEvents(rows[0].events_json);
  }

  private async ensureTxEventsSchema(): Promise<void> {
    if (!this.txEventsSchemaPromise) {
      this.txEventsSchemaPromise = this.entityManager
        .query(
          `
          CREATE TABLE IF NOT EXISTS ibc_gateway_tx_events (
            expected_root TEXT NOT NULL,
            unsigned_tx_hash TEXT NOT NULL PRIMARY KEY,
            confirmed_tx_hash TEXT UNIQUE,
            events_json JSONB NOT NULL,
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            confirmed_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          ALTER TABLE ibc_gateway_tx_events
            DROP CONSTRAINT IF EXISTS ibc_gateway_tx_events_pkey;
          ALTER TABLE ibc_gateway_tx_events
            ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
          UPDATE ibc_gateway_tx_events
            SET expires_at = updated_at + INTERVAL '1 hour'
            WHERE confirmed_tx_hash IS NULL
              AND expires_at IS NULL;
          CREATE UNIQUE INDEX IF NOT EXISTS ibc_gateway_tx_events_unsigned_hash_uidx
            ON ibc_gateway_tx_events (unsigned_tx_hash);
          CREATE INDEX IF NOT EXISTS ibc_gateway_tx_events_expected_root_idx
            ON ibc_gateway_tx_events (expected_root);
          CREATE INDEX IF NOT EXISTS ibc_gateway_tx_events_pending_expiry_idx
            ON ibc_gateway_tx_events (expires_at)
            WHERE confirmed_tx_hash IS NULL;
        `,
        )
        .then(() => undefined)
        .catch((error) => {
          this.txEventsSchemaPromise = undefined;
          throw error;
        });
    }
    await this.txEventsSchemaPromise;
  }

  private decodePersistedEvents(value: PersistedGatewayEvent[] | string): PersistedGatewayEvent[] {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) {
      throw new Error('Persisted transaction events are not an array');
    }
    for (const event of parsed) {
      if (
        !event ||
        typeof event.type !== 'string' ||
        !Array.isArray(event.attributes) ||
        event.attributes.some(
          (attribute) => !attribute || typeof attribute.key !== 'string' || typeof attribute.value !== 'string',
        )
      ) {
        throw new Error('Persisted transaction events have an invalid shape');
      }
    }
    return parsed;
  }
}
