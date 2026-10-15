import { YaciRestClient } from './yaci-rest';
import { restBlockFixture } from '../../test-config/rest-block';

describe('standard Yaci REST history', () => {
  const fixture = restBlockFixture();
  const rest = new YaciRestClient('https://yaci.example/');
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  it('reads and validates native block metadata', async () => {
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(fixture.metadata)));
    await expect(rest.block(100n)).resolves.toEqual(fixture.metadata);
    expect(request).toHaveBeenCalledWith('https://yaci.example/api/v1/blocks/100', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it.each([fixture.bytes, Buffer.concat([Buffer.from([0x82, 7]), fixture.bytes])])('returns exact raw block bytes with a matching header hash', async (bytes) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array(bytes)));
    await expect(rest.blockCbor(fixture.metadata.hash)).resolves.toEqual(fixture.bytes);
  });

  it.each([Buffer.alloc(0), fixture.bytes.subarray(0, -1), Buffer.concat([fixture.bytes, Buffer.from([0])])])('rejects incomplete or trailing CBOR', async (bytes) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array(bytes)));
    await expect(rest.blockCbor(fixture.metadata.hash)).rejects.toThrow();
  });

  it('rejects a different block instead of accepting a successful HTTP response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array(fixture.bytes)));
    await expect(rest.blockCbor('ff'.repeat(32))).rejects.toThrow('header hash');
  });

  it.each([{}, { ...fixture.metadata, slot: -1 }, { ...fixture.metadata, number: 101 }])('rejects invalid block metadata', async (metadata) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(metadata)));
    await expect(rest.block(100n)).rejects.toThrow();
  });

  it('distinguishes missing metadata from unavailable raw block retention', async () => {
    const request = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(null, { status: 404 }));
    await expect(rest.block(100n)).resolves.toBeNull();
    await expect(rest.blockCbor(fixture.metadata.hash)).rejects.toThrow('store.blocks.save-cbor=true');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('retries temporary HTTP failures with a bounded attempt count', async () => {
    jest.useFakeTimers();
    const request = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(null, { status: 503 }));
    const result = expect(rest.block(100n)).rejects.toThrow('HTTP 503');
    await jest.advanceTimersByTimeAsync(1000);
    await result;
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('requires a REST endpoint even when node or database endpoints are available', () => {
    expect(() => new YaciRestClient(undefined)).toThrow('YACI_STORE_ENDPOINT');
  });
});
