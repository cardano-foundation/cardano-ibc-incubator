import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { createConnection } from 'net';
import { HistoryService } from '../../../query/services/history.service';
import { MiniProtocalsService } from './mini-protocals.service';
import { restBlockFixture } from '../../../test-config/rest-block';

jest.mock('net', () => ({ ...jest.requireActual('net'), createConnection: jest.fn() }));

describe('REST-only Cardano block witness transport', () => {
  const fixture = restBlockFixture();
  const settings: Record<string, string | number> = {
    yaciStoreEndpoint: 'https://yaci.example', cardanoChainHost: '127.0.0.1', cardanoChainPort: 3001,
    cardanoChainNetworkMagic: 42,
  };
  const service = new MiniProtocalsService({} as HistoryService,
    { get: (key: string) => settings[key] } as ConfigService,
    { warn: jest.fn(), error: jest.fn() } as unknown as Logger);
  afterEach(() => jest.restoreAllMocks());

  it('fetches raw blocks through Yaci REST', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array(fixture.bytes)));
    await expect(service.fetchBlockCbor({ hash: fixture.metadata.hash, slotNo: 1000n })).resolves.toEqual(fixture.bytes);
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('fails on missing REST data even when Cardano relay settings are available', async () => {
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    await expect(service.fetchBlockCbor({ hash: fixture.metadata.hash, slotNo: 1000n })).rejects.toThrow('HTTP 404');
    expect(request).toHaveBeenCalledTimes(1);
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('returns an empty range without making a request', async () => {
    const request = jest.spyOn(global, 'fetch');
    await expect(service.fetchBlocksCbor([])).resolves.toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});
