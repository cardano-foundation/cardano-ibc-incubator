import { restGateway } from '../../test-config/rest-provider';
import { restBlockFixture } from '../../test-config/rest-block';
import { YaciRestClient, YaciRestHistoryChangedError } from '../../shared/helpers/yaci-rest';

describe('Yaci bounded block ranges', () => {
  afterEach(() => jest.restoreAllMocks());

  function setup() {
    const first = restBlockFixture();
    const blocks = new Map([[100, first.metadata]]);
    for (let height = 101; height <= 112; height++)
      blocks.set(height, restBlockFixture(height, blocks.get(height - 1)!.hash).metadata);
    const read = jest
      .spyOn(YaciRestClient.prototype, 'block')
      .mockImplementation(async (height) => blocks.get(Number(height)) ?? null);
    return { service: restGateway(first).service, blocks, read };
  }

  it('bounds pending reads and returns height order despite out-of-order completions', async () => {
    const { service, blocks, read } = setup();
    const release = new Map<number, () => void>();
    const gates = new Map(
      Array.from({ length: 5 }, (_, i) => {
        const height = 101 + i;
        return [height, new Promise<void>((resolve) => release.set(height, resolve))] as const;
      }),
    );
    let active = 0;
    let peak = 0;
    read.mockImplementation(async (height) => {
      active++;
      peak = Math.max(peak, active);
      await gates.get(Number(height));
      active--;
      return blocks.get(Number(height)) ?? null;
    });
    const pending = service.findBridgeBlocks(100n, 112n);
    try {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(peak).toBe(5);
      expect(read.mock.calls.map(([height]) => Number(height))).toEqual([112, 100, 101, 102, 103, 104, 105]);
      for (const height of [105, 104, 103, 102]) release.get(height)!();
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(read).not.toHaveBeenCalledWith(106n);
    } finally {
      for (const resolve of release.values()) resolve();
    }
    const result = await pending;
    expect(result.map((block) => block.height)).toEqual(Array.from({ length: 11 }, (_, i) => 101 + i));
    expect(result.map((block) => block.hash)).toEqual(result.map((block) => blocks.get(block.height)!.hash));
    expect(peak).toBe(5);
    expect(read.mock.calls.at(-1)).toEqual([112]);
  });

  it.each([105, 106, 112])('rejects a missing block at height %i', async (height) => {
    const { service, blocks } = setup();
    blocks.delete(height);
    await expect(service.findBridgeBlocks(100n, 112n)).rejects.toThrow();
  });

  it.each([105, 106, 112])('rejects a broken link at height %i', async (height) => {
    const { service, blocks } = setup();
    blocks.get(height)!.previous_block = 'ff'.repeat(32);
    await expect(service.findBridgeBlocks(100n, 112n)).rejects.toThrow('block range is incomplete or changed');
  });

  it('propagates a failed batch without scheduling later batches', async () => {
    const { service, read } = setup();
    const original = read.getMockImplementation()!;
    read.mockImplementation(async (height) => {
      if (height === 106n) throw new Error('provider unavailable');
      return original(height);
    });
    await expect(service.findBridgeBlocks(100n, 112n)).rejects.toThrow('provider unavailable');
    expect(read).not.toHaveBeenCalledWith(111n);
  });

  it('rejects a rollback after reading the range', async () => {
    const { service, read, blocks } = setup();
    let anchorReads = 0;
    read.mockImplementation(async (height) => {
      const block = blocks.get(Number(height)) ?? null;
      if (Number(height) === 112 && ++anchorReads === 3) return { ...block!, hash: 'ff'.repeat(32) };
      return block;
    });
    await expect(service.findBridgeBlocks(100n, 112n)).rejects.toThrow(YaciRestHistoryChangedError);
  });

  it('validates adjacent endpoints without returning either endpoint', async () => {
    const { service } = setup();
    await expect(service.findBridgeBlocks(100n, 101n)).resolves.toEqual([]);
  });
});
