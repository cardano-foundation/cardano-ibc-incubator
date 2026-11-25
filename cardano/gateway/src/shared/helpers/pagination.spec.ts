import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { paginate } from './pagination';

describe('paginate', () => {
  const ids = ['channel-3', 'channel-0', 'channel-10', 'channel-2', 'channel-1'];
  const sorted = ['channel-0', 'channel-1', 'channel-10', 'channel-2', 'channel-3'];
  const identity = (id: string) => id;

  const walk = (reverse: boolean) => {
    const seen: string[] = [];
    let key: Uint8Array = new Uint8Array();
    do {
      const page = paginate(ids, identity, { key, limit: 2n, reverse });
      seen.push(...page.items);
      key = page.pagination.next_key;
    } while (key.length > 0);
    return seen;
  };

  it('always applies the offset, even when the collection fits in one page', () => {
    expect(paginate(ids, identity, { offset: 1n, limit: 100n }).items).toEqual(sorted.slice(1));
    expect(paginate(ids, identity, { offset: 999n, limit: 100n })).toEqual({
      items: [],
      pagination: { next_key: new Uint8Array(), total: 0n },
    });
  });

  it('follows next_key across every record exactly once in both directions', () => {
    expect(walk(false)).toEqual(sorted);
    expect(walk(true)).toEqual([...sorted].reverse());
  });

  it('reverses the stable order before applying offset and limit', () => {
    const page = paginate(ids, identity, { offset: 1n, limit: 2n, reverse: true });

    expect(page.items).toEqual(['channel-2', 'channel-10']);
    expect(page.pagination.next_key.length).toBeGreaterThan(0);
  });

  it('resumes after a continuation record disappears between requests', () => {
    const first = paginate(ids, identity, { limit: 2n });
    const remaining = ids.filter((id) => id !== 'channel-10');

    expect(paginate(remaining, identity, { key: first.pagination.next_key, limit: 2n }).items).toEqual([
      'channel-2',
      'channel-3',
    ]);
  });

  it('reports the full total only when count_total is requested', () => {
    expect(paginate(ids, identity, { limit: 2n, count_total: true }).pagination.total).toBe(5n);
    expect(paginate(ids, identity, { limit: 2n }).pagination.total).toBe(0n);
  });

  it('defaults a missing limit to 100 and clamps to the caller maximum', () => {
    const many = Array.from({ length: 150 }, (_, index) => String(index).padStart(3, '0'));

    expect(paginate(many, identity, { limit: 0n }).items).toHaveLength(100);
    expect(paginate(many, identity).items).toHaveLength(100);
    expect(paginate(many, identity, { limit: 120n }).items).toHaveLength(120);
    expect(paginate(many, identity, { limit: 120n }, { maxLimit: 100n }).items).toHaveLength(100);
  });

  it('still accepts legacy offset keys', () => {
    const key = Buffer.from(JSON.stringify({ offset: 3 }));
    const page = paginate(ids, identity, { key, limit: 1n });

    expect(page.items).toEqual(['channel-2']);
    expect(paginate(ids, identity, { key: page.pagination.next_key, limit: 1n }).items).toEqual(['channel-3']);
  });

  it('rejects a request that sets both key and offset', () => {
    const key = paginate(ids, identity, { limit: 1n }).pagination.next_key;

    expect(() => paginate(ids, identity, { key, offset: 1n })).toThrow(GrpcInvalidArgumentException);
  });

  it.each([
    ['non-JSON', Buffer.from('not-a-key')],
    ['unknown JSON', Buffer.from(JSON.stringify({ page: 2 }))],
    ['negative offset', Buffer.from(JSON.stringify({ offset: -1 }))],
  ])('rejects a malformed %s key', (_description, key) => {
    expect(() => paginate(ids, identity, { key })).toThrow(GrpcInvalidArgumentException);
  });
});
