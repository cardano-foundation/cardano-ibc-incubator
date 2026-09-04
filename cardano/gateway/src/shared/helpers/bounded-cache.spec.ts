import { BoundedCache, CacheEvictionReason } from './bounded-cache';

describe('BoundedCache', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('evicts the least recently used entry at the capacity bound', () => {
    const evictions: Array<[string, number, CacheEvictionReason]> = [];
    const cache = new BoundedCache<string, number>({
      maxEntries: 2,
      onEvict: (key, value, reason) => evictions.push([key, value, reason]),
    });

    cache.set('first', 1);
    cache.set('second', 2);
    expect(cache.get('first')).toBe(1);
    cache.set('third', 3);

    expect(cache.get('second')).toBeUndefined();
    expect(cache.get('first')).toBe(1);
    expect(cache.get('third')).toBe(3);
    expect(cache.size).toBe(2);
    expect(evictions).toContainEqual(['second', 2, 'capacity']);
  });

  it('expires idle entries at their TTL and reports size changes', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    const sizes: number[] = [];
    const cache = new BoundedCache<string, string>({
      maxEntries: 2,
      ttlMs: 100,
      onSizeChange: (size) => sizes.push(size),
    });

    cache.set('tx', 'pending');
    await jest.advanceTimersByTimeAsync(99);
    expect(cache.get('tx')).toBe('pending');
    await jest.advanceTimersByTimeAsync(1);

    expect(cache.get('tx')).toBeUndefined();
    expect(cache.size).toBe(0);
    expect(sizes).toEqual([0, 1, 0]);
  });

  it('deletes a value only when the cached identity still matches', () => {
    const cache = new BoundedCache<string, object>({ maxEntries: 1 });
    const original = {};
    const replacement = {};

    cache.set('key', original);
    cache.set('key', replacement);

    expect(cache.deleteIfValue('key', original)).toBe(false);
    expect(cache.get('key')).toBe(replacement);
    expect(cache.deleteIfValue('key', replacement)).toBe(true);
  });
});
