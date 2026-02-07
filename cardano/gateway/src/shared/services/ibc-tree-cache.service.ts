import { Injectable, Logger } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import zlib from 'zlib';
import { ICS23MerkleTree } from '../helpers/ics23-merkle-tree';

type CachedTreeRow = {
  id: string;
  root: string;
  leaves_gzip: Buffer;
  updated_at: string;
};

@Injectable()
export class IbcTreeCacheService {
  private readonly logger = new Logger(IbcTreeCacheService.name);

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

  async load(id: string = 'current'): Promise<{ tree: ICS23MerkleTree; root: string } | null> {
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

  async save(tree: ICS23MerkleTree, id: string = 'current'): Promise<{ root: string }> {
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
}

