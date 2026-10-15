import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { YaciHistoryService } from '../services/yaci-history.service';

const genesisNonce = '11'.repeat(32);
const epochNonce = '22'.repeat(32);
const environmentKeys = [
  'CARDANO_CHAIN_ID',
  'CARDANO_NETWORK_MAGIC',
  'CARDANO_CHAIN_NETWORK_MAGIC',
  'CARDANO_EPOCH_NONCE_GENESIS',
  'CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE',
  'CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT',
];

describe('Yaci local epoch nonces', () => {
  const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  let service: YaciHistoryService;
  let query: jest.Mock;
  let configuration: Record<string, unknown>;

  beforeEach(() => {
    process.env.CARDANO_CHAIN_ID = 'cardano-devnet';
    process.env.CARDANO_NETWORK_MAGIC = '42';
    process.env.CARDANO_CHAIN_NETWORK_MAGIC = '42';
    process.env.CARDANO_EPOCH_NONCE_GENESIS = genesisNonce;
    process.env.CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE = 'ff'.repeat(32);
    process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT = '1';
    configuration = {
      cardanoChainId: 'cardano-devnet',
      cardanoChainNetworkMagic: 42,
      cardanoNetwork: 'Custom',
    };
    query = jest.fn().mockRejectedValue(new Error('Yaci PostgreSQL must not be queried'));
    service = new YaciHistoryService(
      { get: (key: string) => configuration[key] } as ConfigService,
      {} as never,
      { query } as unknown as EntityManager,
    );
  });

  afterEach(() => {
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.restoreAllMocks();
  });

  it.each([0, 1, 3])('requires an HTTP epoch provider for local epoch %s', async (epoch) => {
    await expect(service['fetchEpochNonce'](epoch)).rejects.toThrow('CARDANO_EPOCH_PARAMS_ENDPOINT');
    expect(query).not.toHaveBeenCalled();
  });

  it('reads local nonces from the configured HTTP provider', async () => {
    configuration.cardanoEpochParamsEndpoint = 'http://nonce:8080';
    const request = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ epoch: 1, nonce: epochNonce }),
    } as Response);
    await expect(service['fetchEpochNonce'](1)).resolves.toBe(epochNonce);
    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0][0])).toBe('http://nonce:8080/epochs/1/parameters');
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ['CARDANO_CHAIN_ID', 'cardano-devnet '],
    ['CARDANO_NETWORK_MAGIC', '1'],
    ['CARDANO_CHAIN_NETWORK_MAGIC', '2'],
    ['CARDANO_NETWORK_MAGIC', undefined],
  ])('does not select local replay on ambiguous identity %s=%s', async (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    await expect(service['fetchEpochNonce'](1)).resolves.toBe('ff'.repeat(32));
    expect(query).not.toHaveBeenCalled();
  });

  it('does not select local replay when resolved configuration disagrees', async () => {
    configuration.cardanoNetwork = 'Mainnet';
    await expect(service['fetchEpochNonce'](1)).resolves.toBe('ff'.repeat(32));
    expect(query).not.toHaveBeenCalled();
  });

  it('uses the configured public Blockfrost path', async () => {
    configuration.cardanoEpochParamsEndpoint = 'https://cardano-preprod.blockfrost.io/api/v0';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ epoch: 1, nonce: '77'.repeat(32) }),
    } as Response);
    await expect(service['fetchEpochNonce'](1)).resolves.toBe('77'.repeat(32));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });
});
