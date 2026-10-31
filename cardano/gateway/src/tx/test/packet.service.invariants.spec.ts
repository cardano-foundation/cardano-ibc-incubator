import { insertSortMapWithNumberKey, prependToMap } from '@shared/helpers/helper';


describe('Generic channel packet maps', () => {
  it('keeps packet acknowledgement map sorted by sequence', () => {
    const existing = new Map<bigint, string>([
      [1n, 'ack-1'],
      [3n, 'ack-3'],
    ]);

    const updated = insertSortMapWithNumberKey(new Map(existing), 2n, 'ack-2');

    expect([...updated.keys()]).toEqual([1n, 2n, 3n]);
  });

  it('does not mutate source map while sorting acknowledgement insertions', () => {
    const source = new Map<bigint, string>([
      [1n, 'ack-1'],
      [3n, 'ack-3'],
    ]);

    const updated = insertSortMapWithNumberKey(new Map(source), 2n, 'ack-2');

    expect([...source.keys()]).toEqual([1n, 3n]);
    expect([...updated.keys()]).toEqual([1n, 2n, 3n]);
  });

  it('prepends packet receipt sequence for unordered recv semantics', () => {
    const existing = new Map<bigint, string>([[1n, '']]);
    const updated = prependToMap(existing, 2n, '');

    expect([...updated.keys()]).toEqual([2n, 1n]);
  });
});
