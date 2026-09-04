export type CacheEvictionReason = 'capacity' | 'deleted' | 'expired' | 'replaced' | 'taken';

type BoundedCacheOptions<K, V> = {
  maxEntries: number;
  ttlMs?: number;
  now?: () => number;
  onEvict?: (key: K, value: V, reason: CacheEvictionReason) => void;
  onSizeChange?: (size: number) => void;
};

type CacheEntry<V> = {
  value: V;
  expiresAt?: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
};

/**
 * A small in-memory LRU cache with an optional absolute TTL.
 *
 * TTL entries use unref'd timers so abandoned entries are reclaimed even when
 * the cache is otherwise idle, without keeping the Node.js process alive.
 */
export class BoundedCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs?: number;
  private readonly now: () => number;
  private readonly onEvict?: BoundedCacheOptions<K, V>['onEvict'];
  private readonly onSizeChange?: BoundedCacheOptions<K, V>['onSizeChange'];

  constructor(options: BoundedCacheOptions<K, V>) {
    if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries <= 0) {
      throw new RangeError('BoundedCache maxEntries must be a positive safe integer');
    }
    if (options.ttlMs !== undefined && (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0)) {
      throw new RangeError('BoundedCache ttlMs must be a positive finite number');
    }

    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? (() => Date.now());
    this.onEvict = options.onEvict;
    this.onSizeChange = options.onSizeChange;
    this.onSizeChange?.(0);
  }

  get size(): number {
    this.pruneExpired();
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const entry = this.getLiveEntry(key);
    if (!entry) return undefined;

    // Map insertion order is the LRU order. Reads promote the entry.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.entries.has(key)) {
      this.removeEntry(key, 'replaced');
    }
    this.pruneExpired();

    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.removeEntry(oldest.value, 'capacity');
    }

    const entry: CacheEntry<V> = {
      value,
      expiresAt: this.ttlMs === undefined ? undefined : this.now() + this.ttlMs,
    };
    this.entries.set(key, entry);
    if (this.ttlMs !== undefined) {
      entry.expiryTimer = setTimeout(() => this.expireEntry(key, entry), this.ttlMs);
      entry.expiryTimer.unref?.();
    }
    this.onSizeChange?.(this.entries.size);
  }

  take(key: K): V | undefined {
    const entry = this.getLiveEntry(key);
    if (!entry) return undefined;
    this.removeEntry(key, 'taken');
    return entry.value;
  }

  findAndTake(predicate: (value: V, key: K) => boolean): V | undefined {
    this.pruneExpired();
    for (const [key, entry] of this.entries) {
      if (predicate(entry.value, key)) {
        this.removeEntry(key, 'taken');
        return entry.value;
      }
    }
    return undefined;
  }

  delete(key: K): boolean {
    if (!this.getLiveEntry(key)) return false;
    this.removeEntry(key, 'deleted');
    return true;
  }

  deleteIfValue(key: K, value: V): boolean {
    const entry = this.getLiveEntry(key);
    if (!entry || entry.value !== value) return false;
    this.removeEntry(key, 'deleted');
    return true;
  }

  private getLiveEntry(key: K): CacheEntry<V> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.removeEntry(key, 'expired');
      return undefined;
    }
    return entry;
  }

  private pruneExpired(): void {
    if (this.ttlMs === undefined) return;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
        this.removeEntry(key, 'expired');
      }
    }
  }

  private expireEntry(key: K, expectedEntry: CacheEntry<V>): void {
    if (this.entries.get(key) !== expectedEntry) return;
    if (expectedEntry.expiresAt !== undefined && expectedEntry.expiresAt > this.now()) {
      expectedEntry.expiryTimer = setTimeout(
        () => this.expireEntry(key, expectedEntry),
        expectedEntry.expiresAt - this.now(),
      );
      expectedEntry.expiryTimer.unref?.();
      return;
    }
    this.removeEntry(key, 'expired');
  }

  private removeEntry(key: K, reason: CacheEvictionReason): void {
    const entry = this.entries.get(key);
    if (!entry) return;

    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    this.entries.delete(key);
    this.onEvict?.(key, entry.value, reason);
    this.onSizeChange?.(this.entries.size);
  }
}
