import {
  fetchKupoHistoryAtAddressByPolicy,
  mapKupoValueToAssets,
  mapOgmiosProtocolParameters,
  queryProtocolParametersCompat,
  retryWithBackoff,
  withKupoStringQuantityHeader,
} from '../lucid.provider';
import { Lucid } from '@lucid-evolution/lucid';

function protocolParameters(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    minFeeCoefficient: 44,
    minFeeConstant: { ada: { lovelace: 155381 } },
    maxTransactionSize: { bytes: 16384 },
    maxValueSize: { bytes: 5000 },
    stakeCredentialDeposit: { ada: { lovelace: 2_000_000 } },
    stakePoolDeposit: { ada: { lovelace: 500_000_000 } },
    delegateRepresentativeDeposit: { ada: { lovelace: 500_000_000 } },
    governanceActionDeposit: { ada: { lovelace: 100_000_000_000 } },
    scriptExecutionPrices: {
      memory: '577/10000',
      cpu: [721, 10_000_000],
    },
    maxExecutionUnitsPerTransaction: {
      memory: 14_000_000,
      cpu: 10_000_000_000,
    },
    collateralPercentage: 150,
    maxCollateralInputs: 3,
    minFeeReferenceScripts: { base: 15 },
    ...overrides,
  };
}

describe('Ogmios protocol parameter compatibility', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('maps the legacy UTxO-cost alias without inventing Plutus V3 parameters', () => {
    const mapped = mapOgmiosProtocolParameters(
      protocolParameters({
        utxoCostPerByte: 4310,
        plutusCostModels: {
          'plutus:v1': [1, 2],
          'plutus:v2': { 1: '4', 0: '3' },
        },
      }),
    );

    expect(mapped.coinsPerUtxoByte).toBe(4310n);
    expect(mapped.costModels).toEqual({
      PlutusV1: [1, 2],
      PlutusV2: [3, 4],
      PlutusV3: [],
    });
  });

  it('maps minUtxoDepositCoefficient and preserves a supplied Plutus V3 model', () => {
    const mapped = mapOgmiosProtocolParameters(
      protocolParameters({
        minUtxoDepositCoefficient: '4310',
        plutusCostModels: {
          'plutus:v1': [1, 2],
          'plutus:v2': [5, 6],
          'plutus:v3': { 1: '8', 0: '7' },
        },
      }),
    );

    expect(mapped.coinsPerUtxoByte).toBe(4310n);
    expect(mapped.costModels).toEqual({
      PlutusV1: [1, 2],
      PlutusV2: [5, 6],
      PlutusV3: [7, 8],
    });
  });

  it('produces a cost-model shape accepted by the locked Lucid runtime', async () => {
    const mapped = mapOgmiosProtocolParameters(
      protocolParameters({
        utxoCostPerByte: 4310,
        plutusCostModels: {
          'plutus:v1': [1, 2],
          'plutus:v2': [3, 4],
        },
      }),
    );

    expect(mapped.costModels.PlutusV3).toEqual([]);
    await expect(Lucid(undefined, 'Preprod', { presetProtocolParameters: mapped })).resolves.toBeDefined();
  });

  it('rejects malformed responses instead of silently manufacturing parameters', () => {
    expect(() => mapOgmiosProtocolParameters(undefined)).toThrow('missing result');
    expect(() => mapOgmiosProtocolParameters(protocolParameters())).toThrow(
      'missing utxoCostPerByte/minUtxoDepositCoefficient',
    );
    expect(() =>
      mapOgmiosProtocolParameters(
        protocolParameters({
          utxoCostPerByte: 4310,
        }),
      ),
    ).toThrow('missing a non-empty plutus:v1 cost model');
    expect(() =>
      mapOgmiosProtocolParameters(
        protocolParameters({
          utxoCostPerByte: 4310,
          plutusCostModels: {
            'plutus:v1': [1, 2],
            'plutus:v2': [],
          },
        }),
      ),
    ).toThrow('missing a non-empty plutus:v2 cost model');
    expect(() =>
      mapOgmiosProtocolParameters(
        protocolParameters({
          utxoCostPerByte: 4310,
          plutusCostModels: { 'plutus:v3': 'not-a-cost-model' },
        }),
      ),
    ).toThrow('invalid plutus:v3 cost model');
  });

  it('aborts and rejects a stalled protocol-parameter request at its deadline', async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    ) as unknown as typeof fetch;

    const request = queryProtocolParametersCompat('https://ogmios.test', undefined, fetchImpl, 50);
    const rejection = expect(request).rejects.toThrow('Ogmios protocol parameters query timed out after 50ms');
    await jest.advanceTimersByTimeAsync(50);

    await rejection;
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://ogmios.test',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('also bounds a response body that never finishes', async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => new Promise<string>(() => undefined),
    }) as unknown as typeof fetch;

    const request = queryProtocolParametersCompat('https://ogmios.test', undefined, fetchImpl, 50);
    const rejection = expect(request).rejects.toThrow('Ogmios protocol parameters query timed out after 50ms');
    await jest.advanceTimersByTimeAsync(50);

    await rejection;
  });

  it('retries rate limits and temporary server failures before succeeding', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const operation = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error('upstream proxy failed'), { status: 520 }))
      .mockResolvedValue('ready');

    const result = retryWithBackoff(operation, 'test protocol parameters');
    await jest.advanceTimersByTimeAsync(1_000);
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(result).resolves.toBe('ready');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('does not retry an ordinary client error', async () => {
    const operation = jest.fn().mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }));

    await expect(retryWithBackoff(operation, 'test protocol parameters')).rejects.toThrow('bad request');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After from a 429 response before retrying', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = protocolParameters({
      utxoCostPerByte: 4310,
      plutusCostModels: {
        'plutus:v1': [1, 2],
        'plutus:v2': [3, 4],
      },
    });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '30' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ result }), { status: 200 })) as unknown as typeof fetch;
    const waits: number[] = [];

    await expect(
      retryWithBackoff(
        () => queryProtocolParametersCompat('https://ogmios.test', undefined, fetchImpl, 50),
        'test protocol parameters',
        async (durationMs) => {
          waits.push(durationMs);
        },
      ),
    ).resolves.toMatchObject({ coinsPerUtxoByte: 4310n });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([30_000]);
  });
});

describe('Kupo quantity handling', () => {
  it('forces string quantities while retaining authentication headers', () => {
    const original = {
      kupoHeader: {
        Accept: 'application/json',
        'dmtr-api-key': 'secret',
      },
      ogmiosHeader: { 'dmtr-api-key': 'ogmios-secret' },
    };

    expect(withKupoStringQuantityHeader(original)).toEqual({
      kupoHeader: {
        accept: 'application/json;asset-quantity=string',
        'dmtr-api-key': 'secret',
      },
      ogmiosHeader: { 'dmtr-api-key': 'ogmios-secret' },
    });
    expect(original.kupoHeader.Accept).toBe('application/json');
  });

  it('preserves asset quantities beyond JavaScript safe integers', () => {
    expect(
      mapKupoValueToAssets({
        coins: '9007199254740993',
        assets: {
          'aa.bb': '18446744073709551615',
        },
      }),
    ).toEqual({
      lovelace: 9007199254740993n,
      aabb: 18446744073709551615n,
    });
  });
});

describe('Kupo historical match compatibility', () => {
  const policyId = 'a'.repeat(56);
  const address = 'addr_test1history';
  const tokenName = 'ab';
  const datumHash1 = 'c'.repeat(64);
  const datumHash2 = 'd'.repeat(64);
  const headerHash1 = 'e'.repeat(64);
  const headerHash2 = 'f'.repeat(64);
  const txHash1 = '1'.repeat(64);
  const txHash2 = '2'.repeat(64);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches spent and unspent matches, resolves inline datums, and retains auth headers', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input, _init) => {
      const url = String(input);
      if (url.includes('/patterns/')) {
        return new Response(JSON.stringify(url.includes(encodeURIComponent(address)) ? ['*'] : []), { status: 200 });
      }
      if (url.includes('/matches/')) {
        const searchParams = new URL(url).searchParams;
        expect(searchParams.get('policy_id')).toBe(policyId);
        expect(searchParams.has('order')).toBe(false);
        expect(searchParams.has('unspent')).toBe(false);
        expect(searchParams.has('spent')).toBe(false);
        return new Response(
          JSON.stringify([
            {
              transaction_index: 1,
              transaction_id: txHash2,
              output_index: 0,
              address,
              value: { coins: '3000000', assets: { [`${policyId}.${tokenName}`]: '1' } },
              datum_hash: datumHash2,
              datum_type: 'inline',
              script_hash: null,
              created_at: { slot_no: 12, header_hash: headerHash2 },
              spent_at: null,
            },
            {
              transaction_index: 2,
              transaction_id: txHash1,
              output_index: 0,
              address,
              value: { coins: '2000000', assets: { [`${policyId}.${tokenName}`]: '1' } },
              datum_hash: datumHash1,
              datum_type: 'inline',
              script_hash: null,
              created_at: { slot_no: 10, header_hash: headerHash1 },
              spent_at: { slot_no: 12, header_hash: headerHash2 },
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes(`/datums/${datumHash1}`)) {
        return new Response(JSON.stringify({ datum: 'd87980' }), { status: 200 });
      }
      if (url.includes(`/datums/${datumHash2}`)) {
        return new Response(JSON.stringify({ datum: 'd8799f01ff' }), { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const result = await fetchKupoHistoryAtAddressByPolicy('https://kupo.test', address, policyId, {
      Accept: 'application/json',
      'dmtr-api-key': 'secret',
    });

    expect(result.map((output) => output.txHash)).toEqual([txHash1, txHash2]);
    expect(result[0]).toEqual(
      expect.objectContaining({
        datum: 'd87980',
        inlineDatumHash: datumHash1,
        transactionIndex: 2,
        createdAt: { slotNo: 10, headerHash: headerHash1 },
        spentAt: { slotNo: 12, headerHash: headerHash2 },
        authToken: { policyId, name: tokenName, unit: `${policyId}${tokenName}` },
      }),
    );
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toEqual(
        expect.objectContaining({
          accept: 'application/json;asset-quantity=string',
          'dmtr-api-key': 'secret',
        }),
      );
    }
  });

  it('scopes a point-history request to an exact asset name', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/patterns/')) {
        return new Response(JSON.stringify(['*']), { status: 200 });
      }
      if (url.includes('/matches/')) {
        const searchParams = new URL(url).searchParams;
        expect(searchParams.get('policy_id')).toBe(policyId);
        expect(searchParams.get('asset_name')).toBe(tokenName);
        return new Response(
          JSON.stringify([
            {
              transaction_index: 0,
              transaction_id: txHash1,
              output_index: 0,
              address,
              value: {
                coins: '2000000',
                assets: { [`${policyId}.${tokenName}`]: '1' },
              },
              datum_hash: datumHash1,
              datum_type: 'inline',
              script_hash: null,
              created_at: { slot_no: 10, header_hash: headerHash1 },
              spent_at: null,
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes(`/datums/${datumHash1}`)) {
        return new Response(JSON.stringify({ datum: 'd87980' }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    await expect(
      fetchKupoHistoryAtAddressByPolicy(
        'https://kupo.test',
        address,
        policyId,
        undefined,
        tokenName,
      ),
    ).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalled();
  });

  it.each(['', 'a', 'AB', 'zz', 'aa'.repeat(33)])(
    'rejects malformed point-history asset name %p before querying Kupo',
    async (assetName) => {
      const fetchMock = jest.spyOn(global, 'fetch');
      await expect(
        fetchKupoHistoryAtAddressByPolicy(
          'https://kupo.test',
          address,
          policyId,
          undefined,
          assetName,
        ),
      ).rejects.toThrow('Invalid Kupo history asset name');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('fails closed when Kupo returns a different token than the requested asset name', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/patterns/')) {
        return new Response(JSON.stringify(['*']), { status: 200 });
      }
      if (url.includes('/matches/')) {
        return new Response(
          JSON.stringify([
            {
              transaction_index: 0,
              transaction_id: txHash1,
              output_index: 0,
              address,
              value: {
                coins: '2000000',
                assets: { [`${policyId}.${tokenName}`]: '1' },
              },
              datum_hash: datumHash1,
              datum_type: 'inline',
              script_hash: null,
              created_at: { slot_no: 10, header_hash: headerHash1 },
              spent_at: null,
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes(`/datums/${datumHash1}`)) {
        return new Response(JSON.stringify({ datum: 'd87980' }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    await expect(
      fetchKupoHistoryAtAddressByPolicy(
        'https://kupo.test',
        address,
        policyId,
        undefined,
        'cd',
      ),
    ).rejects.toThrow('auth-token name does not match');
  });

  it('fails closed when neither the address nor policy is covered by a configured Kupo pattern', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify([]), { status: 200 }));

    await expect(fetchKupoHistoryAtAddressByPolicy('https://kupo.test', address, policyId)).rejects.toThrow(
      'not configured to retain matches',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails closed when an inline datum preimage cannot be resolved', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/patterns/')) {
        return new Response(JSON.stringify(['*']), { status: 200 });
      }
      if (url.includes('/matches/')) {
        return new Response(
          JSON.stringify([
            {
              transaction_index: 0,
              transaction_id: txHash1,
              output_index: 0,
              address,
              value: { coins: '2000000', assets: { [`${policyId}.${tokenName}`]: '1' } },
              datum_hash: datumHash1,
              datum_type: 'inline',
              script_hash: null,
              created_at: { slot_no: 10, header_hash: headerHash1 },
              spent_at: null,
            },
          ]),
          { status: 200 },
        );
      }
      return new Response('null', { status: 200 });
    });

    await expect(fetchKupoHistoryAtAddressByPolicy('https://kupo.test', address, policyId)).rejects.toThrow(
      'could not be resolved',
    );
  });

  it('fails closed when a match contains multiple auth tokens under the requested policy', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/patterns/')) {
        return new Response(JSON.stringify(['*']), { status: 200 });
      }
      if (url.includes('/matches/')) {
        return new Response(
          JSON.stringify([
            {
              transaction_index: 0,
              transaction_id: txHash1,
              output_index: 0,
              address,
              value: {
                coins: '2000000',
                assets: {
                  [`${policyId}.${tokenName}`]: '1',
                  [`${policyId}.cd`]: '1',
                },
              },
              datum_hash: datumHash1,
              datum_type: 'inline',
              script_hash: null,
              created_at: { slot_no: 10, header_hash: headerHash1 },
              spent_at: null,
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes(`/datums/${datumHash1}`)) {
        return new Response(JSON.stringify({ datum: 'd87980' }), { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    await expect(fetchKupoHistoryAtAddressByPolicy('https://kupo.test', address, policyId)).rejects.toThrow(
      'must contain exactly one token',
    );
  });
});
