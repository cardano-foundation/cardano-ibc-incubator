import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPlannerClient, RouteDiscoveryTimeoutError } from './index';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('route planning', () => {
  it('checks route availability without requiring a token denom', async () => {
    const requestedUrls: string[] = [];
    let traceResolutionCount = 0;
    const fetchImpl: typeof fetch = async (url) => {
      const requestUrl = String(url);
      requestedUrls.push(requestUrl);
      return requestUrl.startsWith('http://cardano.test')
        ? jsonResponse({
            channels: [
              {
                channel_id: 'channel-8',
                port_id: 'transfer',
                state: 'STATE_OPEN',
                counterparty: {
                  channel_id: 'channel-2',
                  port_id: 'transfer',
                },
              },
            ],
          })
        : jsonResponse({
            channel: {
              state: 'STATE_OPEN',
              counterparty: {
                channel_id: 'channel-8',
                port_id: 'transfer',
              },
            },
          });
    };
    const planner = createPlannerClient({
      cardanoChainId: 'cardano-preprod',
      cardanoRestEndpoint: 'http://cardano.test',
      counterpartyChainId: 'injective-888',
      localOsmosisRestEndpoint: 'http://injective.test',
      resolveCardanoAssetDenomTrace: async () => {
        traceResolutionCount += 1;
        return null;
      },
      fetchImpl,
    });

    const forward = await planner.checkTransferRouteAvailability({
      fromChainId: 'cardano-preprod',
      toChainId: 'injective-888',
    });
    const reverse = await planner.checkTransferRouteAvailability({
      fromChainId: 'injective-888',
      toChainId: 'cardano-preprod',
    });

    assert.deepEqual(forward, {
      status: 'available',
      chains: ['cardano-preprod', 'injective-888'],
      routes: ['transfer/channel-8'],
    });
    assert.deepEqual(reverse, {
      status: 'available',
      chains: ['injective-888', 'cardano-preprod'],
      routes: ['transfer/channel-2'],
    });
    assert.equal(traceResolutionCount, 0);
    assert.equal(requestedUrls.length, 4);
    assert.equal(
      requestedUrls
        .filter((url) => url.startsWith('http://cardano.test'))
        .every((url) => url.includes('/api/cardano/channel-ends?')),
      true,
    );
    assert.equal(
      requestedUrls.some((url) => url.includes('/api/channels?')),
      false,
    );
  });

  it('falls back to the proof-bearing channel endpoint for an older Gateway', async () => {
    const requestedUrls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      const requestUrl = String(url);
      requestedUrls.push(requestUrl);
      if (requestUrl.includes('/api/cardano/channel-ends?')) {
        return new Response(null, { status: 404, statusText: 'Not Found' });
      }
      if (requestUrl.includes('/api/channels?')) {
        return jsonResponse({
          channels: [
            {
              channel_id: 'channel-8',
              port_id: 'transfer',
              state: 'STATE_OPEN',
              counterparty: {
                channel_id: 'channel-2',
                port_id: 'transfer',
              },
            },
          ],
        });
      }
      return jsonResponse({
        channel: {
          state: 'STATE_OPEN',
          counterparty: {
            channel_id: 'channel-8',
            port_id: 'transfer',
          },
        },
      });
    };
    const planner = createPlannerClient({
      cardanoChainId: 'cardano-preprod',
      cardanoRestEndpoint: 'http://cardano.test',
      counterpartyChainId: 'injective-888',
      localOsmosisRestEndpoint: 'http://injective.test',
      fetchImpl,
    });

    const result = await planner.checkTransferRouteAvailability({
      fromChainId: 'cardano-preprod',
      toChainId: 'injective-888',
    });

    assert.equal(result.status, 'available');
    assert.deepEqual(requestedUrls, [
      'http://cardano.test/api/cardano/channel-ends?key=&offset=0&limit=10000&countTotal=true&reverse=false',
      'http://cardano.test/api/channels?key=&offset=0&limit=10000&countTotal=true&reverse=false',
      'http://injective.test/ibc/core/channel/v1/channels/channel-2/ports/transfer',
    ]);
  });

  it('reports unavailable only after confirming there is no mutually open pair', async () => {
    const fetchImpl: typeof fetch = async (url) =>
      String(url).startsWith('http://cardano.test')
        ? jsonResponse({
            channels: [
              {
                channel_id: 'channel-8',
                port_id: 'transfer',
                state: 'STATE_OPEN',
                counterparty: {
                  channel_id: 'channel-2',
                  port_id: 'transfer',
                },
              },
            ],
          })
        : jsonResponse({
            channel: {
              state: 'STATE_CLOSED',
              counterparty: {
                channel_id: 'channel-8',
                port_id: 'transfer',
              },
            },
          });
    const planner = createPlannerClient({
      cardanoChainId: 'cardano-preprod',
      cardanoRestEndpoint: 'http://cardano.test',
      counterpartyChainId: 'injective-888',
      localOsmosisRestEndpoint: 'http://injective.test',
      fetchImpl,
    });

    const result = await planner.checkTransferRouteAvailability({
      fromChainId: 'cardano-preprod',
      toChainId: 'injective-888',
    });

    assert.equal(result.status, 'unavailable');
    assert.equal(result.failureCode, 'no-open-channel');
    assert.deepEqual(result.routes, []);
  });

  it('reports discovery failures as unknown instead of no channel', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ message: 'rate limited' }), {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'content-type': 'application/json' },
      });
    const planner = createPlannerClient({
      cardanoChainId: 'cardano-preprod',
      cardanoRestEndpoint: 'http://cardano.test',
      counterpartyChainId: 'injective-888',
      localOsmosisRestEndpoint: 'http://injective.test',
      fetchImpl,
    });

    const result = await planner.checkTransferRouteAvailability({
      fromChainId: 'cardano-preprod',
      toChainId: 'injective-888',
    });

    assert.equal(result.status, 'unknown');
    assert.equal(result.failureCode, 'discovery-failed');
    assert.match(result.failureMessage || '', /429 Too Many Requests/);
  });

  it('reports malformed successful responses as unknown', async () => {
    const planner = createPlannerClient({
      cardanoChainId: 'cardano-preprod',
      cardanoRestEndpoint: 'http://cardano.test',
      counterpartyChainId: 'injective-888',
      localOsmosisRestEndpoint: 'http://injective.test',
      fetchImpl: async () => jsonResponse({}),
    });

    const result = await planner.checkTransferRouteAvailability({
      fromChainId: 'cardano-preprod',
      toChainId: 'injective-888',
    });

    assert.equal(result.status, 'unknown');
    assert.equal(result.failureCode, 'discovery-failed');
    assert.match(result.failureMessage || '', /channels must be an array/);
  });

  it('reports malformed channel entries as unknown', async () => {
    const planner = createPlannerClient({
      cardanoChainId: 'cardano-preprod',
      cardanoRestEndpoint: 'http://cardano.test',
      counterpartyChainId: 'injective-888',
      localOsmosisRestEndpoint: 'http://injective.test',
      fetchImpl: async () => jsonResponse({ channels: [{}] }),
    });

    const result = await planner.checkTransferRouteAvailability({
      fromChainId: 'cardano-preprod',
      toChainId: 'injective-888',
    });

    assert.equal(result.status, 'unknown');
    assert.equal(result.failureCode, 'discovery-failed');
    assert.match(result.failureMessage || '', /channels\[0\]/);
  });

  it('reports malformed counterparty channel entries as unknown', async () => {
    const fetchImpl: typeof fetch = async (url) =>
      String(url).startsWith('http://cardano.test')
        ? jsonResponse({
            channels: [
              {
                channel_id: 'channel-8',
                port_id: 'transfer',
                state: 'STATE_OPEN',
                counterparty: {
                  channel_id: 'channel-2',
                  port_id: 'transfer',
                },
              },
            ],
          })
        : jsonResponse({
            channel: {
              state: 'STATE_OPEN',
              counterparty: {},
            },
          });
    const planner = createPlannerClient({
      cardanoChainId: 'cardano-preprod',
      cardanoRestEndpoint: 'http://cardano.test',
      counterpartyChainId: 'injective-888',
      localOsmosisRestEndpoint: 'http://injective.test',
      fetchImpl,
    });

    const result = await planner.checkTransferRouteAvailability({
      fromChainId: 'cardano-preprod',
      toChainId: 'injective-888',
    });

    assert.equal(result.status, 'unknown');
    assert.equal(result.failureCode, 'discovery-failed');
    assert.match(result.failureMessage || '', /counterparty channel\/port ids/);
  });

  it('does not claim a mutually open pair without a Cardano channel endpoint', async () => {
    let fetchCount = 0;
    const planner = createPlannerClient({
      cardanoChainId: 'cardano-preprod',
      counterpartyChainId: 'injective-888',
      localOsmosisRestEndpoint: 'http://injective.test',
      fetchImpl: async () => {
        fetchCount += 1;
        return jsonResponse({ channels: [] });
      },
    });

    const result = await planner.checkTransferRouteAvailability({
      fromChainId: 'cardano-preprod',
      toChainId: 'injective-888',
    });

    assert.equal(result.status, 'unknown');
    assert.equal(result.failureCode, 'discovery-failed');
    assert.match(result.failureMessage || '', /Cardano channel endpoint/);
    assert.equal(fetchCount, 0);
  });

  it('treats a missing counterparty channel as a confirmed non-match', async () => {
    const fetchImpl: typeof fetch = async (url) =>
      String(url).startsWith('http://cardano.test')
        ? jsonResponse({
            channels: [
              {
                channel_id: 'channel-8',
                port_id: 'transfer',
                state: 'STATE_OPEN',
                counterparty: {
                  channel_id: 'channel-2',
                  port_id: 'transfer',
                },
              },
            ],
          })
        : new Response(JSON.stringify({ message: 'channel not found' }), {
            status: 404,
            statusText: 'Not Found',
            headers: { 'content-type': 'application/json' },
          });
    const planner = createPlannerClient({
      cardanoChainId: 'cardano-preprod',
      cardanoRestEndpoint: 'http://cardano.test',
      counterpartyChainId: 'injective-888',
      localOsmosisRestEndpoint: 'http://injective.test',
      fetchImpl,
    });

    const result = await planner.checkTransferRouteAvailability({
      fromChainId: 'cardano-preprod',
      toChainId: 'injective-888',
    });

    assert.equal(result.status, 'unavailable');
    assert.equal(result.failureCode, 'no-open-channel');
  });

  it('cancels an obsolete preflight through its external signal', async () => {
    const controller = new AbortController();
    const captured: { signal?: AbortSignal } = {};
    const planner = createPlannerClient({
      cardanoChainId: 'cardano-preprod',
      cardanoRestEndpoint: 'http://cardano.test',
      counterpartyChainId: 'injective-888',
      localOsmosisRestEndpoint: 'http://injective.test',
      routeDiscoveryTimeoutMs: 1_000,
      fetchImpl: async (_input, init) => {
        captured.signal = init?.signal ?? undefined;
        return await new Promise<Response>(() => undefined);
      },
    });

    const pending = planner.checkTransferRouteAvailability({
      fromChainId: 'cardano-preprod',
      toChainId: 'injective-888',
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    const result = await pending;

    assert.equal(result.status, 'unknown');
    assert.equal(result.failureCode, 'discovery-aborted');
    assert.equal(captured.signal?.aborted, true);
  });

  it(
    'reports a preflight timeout as unknown and aborts the request',
    { timeout: 1_000 },
    async () => {
      const captured: { signal?: AbortSignal } = {};
      const fetchImpl: typeof fetch = async (_input, init) => {
        captured.signal = init?.signal ?? undefined;
        return await new Promise<Response>(() => undefined);
      };
      const planner = createPlannerClient({
        cardanoChainId: 'cardano-preprod',
        cardanoRestEndpoint: 'http://cardano.test',
        counterpartyChainId: 'injective-888',
        localOsmosisRestEndpoint: 'http://injective.test',
        routeDiscoveryTimeoutMs: 25,
        fetchImpl,
      });

      const result = await planner.checkTransferRouteAvailability({
        fromChainId: 'cardano-preprod',
        toChainId: 'injective-888',
      });

      assert.equal(result.status, 'unknown');
      assert.equal(result.failureCode, 'discovery-timeout');
      assert.equal(
        result.failureMessage,
        'IBC route discovery timed out after 25 milliseconds.',
      );
      assert.equal(captured.signal?.aborted, true);
    },
  );

  it('reports unsupported direct routes with diagnostics instead of inventing a path', async () => {
    let fetchCount = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      return jsonResponse({ channels: [], pagination: {} });
    };
    const planner = createPlannerClient({
      cardanoChainId: 'cardano-local',
      cardanoRestEndpoint: 'http://cardano.test',
      localOsmosisRestEndpoint: 'http://osmosis.test',
      fetchImpl,
    });

    const result = await planner.planTransferRoute({
      fromChainId: 'cardano-local',
      toChainId: 'noble-local',
      tokenDenom: 'lovelace',
      expectedChainPath: ['cardano-local', 'localosmosis', 'noble-local'],
    });

    assert.equal(result.foundRoute, false);
    assert.equal(result.mode, null);
    assert.deepEqual(result.routes, []);
    assert.equal(result.failureCode, 'no-route-found');
    assert.equal(
      result.failureMessage,
      'No direct transfer route exists from cardano-local to noble-local.',
    );
    assert.deepEqual(result.routeDiagnostics, {
      expectedChainPath: ['cardano-local', 'localosmosis', 'noble-local'],
      missingHops: [
        {
          fromChainId: 'cardano-local',
          toChainId: 'noble-local',
          reason: 'no-channel-to-destination',
          availableDestChainIds: [],
        },
      ],
    });
    assert.equal(fetchCount, 0);
  });

  it('propagates route planning outages while swap estimates return an unavailable estimate', async () => {
    const planner = createPlannerClient({
      cardanoChainId: 'cardano-local',
      cardanoRestEndpoint: 'http://cardano.test',
      localOsmosisRestEndpoint: 'http://osmosis.test',
      fetchImpl: async () =>
        new Response(null, {
          status: 503,
          statusText: 'Service Unavailable',
        }),
    });

    await assert.rejects(
      planner.planTransferRoute({
        fromChainId: 'cardano-local',
        toChainId: 'localosmosis',
        tokenDenom: 'lovelace',
      }),
      /503 Service Unavailable/,
    );

    const estimate = await planner.estimateLocalOsmosisSwap({
      fromChainId: 'cardano-local',
      tokenInDenom: 'lovelace',
      tokenInAmount: '1',
      toChainId: 'localosmosis',
      tokenOutDenom: 'uosmo',
    });
    assert.match(estimate.message, /Unable to verify.*503 Service Unavailable/);
    assert.deepEqual(estimate.transferRoutes, []);
  });

  it('discovers configured Injective routes in both directions from Cardano channels', async () => {
    const requestedUrls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      const requestUrl = String(url);
      requestedUrls.push(requestUrl);
      return requestUrl.startsWith('http://cardano.test')
        ? jsonResponse({
            channels: [
              {
                channel_id: 'channel-8',
                port_id: 'transfer',
                state: 'STATE_OPEN',
                counterparty: {
                  channel_id: 'channel-2',
                  port_id: 'transfer',
                },
              },
            ],
            pagination: {},
          })
        : jsonResponse({
            channel: {
              state: 'STATE_OPEN',
              counterparty: {
                channel_id: 'channel-8',
                port_id: 'transfer',
              },
            },
          });
    };
    const planner = createPlannerClient({
      cardanoChainId: 'cardano-preprod',
      cardanoRestEndpoint: 'http://cardano.test/',
      counterpartyChainId: 'injective-888',
      localOsmosisRestEndpoint: 'http://injective.test',
      fetchImpl,
    });

    const cardanoToInjective = await planner.planTransferRoute({
      fromChainId: 'cardano-preprod',
      toChainId: 'injective-888',
      tokenDenom: 'lovelace',
    });
    const injectiveToCardano = await planner.planTransferRoute({
      fromChainId: 'injective-888',
      toChainId: 'cardano-preprod',
      tokenDenom: 'ibc/ABC123',
    });

    assert.equal(cardanoToInjective.foundRoute, true);
    assert.equal(cardanoToInjective.mode, 'native-forward');
    assert.deepEqual(cardanoToInjective.chains, [
      'cardano-preprod',
      'injective-888',
    ]);
    assert.deepEqual(cardanoToInjective.routes, ['transfer/channel-8']);
    assert.deepEqual(cardanoToInjective.tokenTrace, {
      kind: 'native',
      path: '',
      baseDenom: 'lovelace',
      fullDenom: 'lovelace',
    });
    assert.equal(injectiveToCardano.foundRoute, true);
    assert.equal(injectiveToCardano.mode, 'native-forward');
    assert.deepEqual(injectiveToCardano.chains, [
      'injective-888',
      'cardano-preprod',
    ]);
    assert.deepEqual(injectiveToCardano.routes, ['transfer/channel-2']);
    assert.deepEqual(injectiveToCardano.tokenTrace, {
      kind: 'ibc_voucher',
      path: '',
      baseDenom: 'ibc/ABC123',
      fullDenom: 'ibc/ABC123',
    });
    assert.deepEqual(requestedUrls, [
      'http://cardano.test/api/cardano/channel-ends?key=&offset=0&limit=10000&countTotal=true&reverse=false',
      'http://injective.test/ibc/core/channel/v1/channels/channel-2/ports/transfer',
      'http://cardano.test/api/cardano/channel-ends?key=&offset=0&limit=10000&countTotal=true&reverse=false',
      'http://injective.test/ibc/core/channel/v1/channels/channel-2/ports/transfer',
    ]);
  });

  it('filters channels with one bounded Gateway listing and targeted counterparty checks', async () => {
    const requestedUrls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      const requestUrl = String(url);
      requestedUrls.push(requestUrl);
      if (!requestUrl.startsWith('http://cardano.test')) {
        if (requestUrl.includes('/channel-3/')) {
          return new Response(null, {
            status: 503,
            statusText: 'Service Unavailable',
          });
        }
        const matchesCardanoChannel = requestUrl.includes('/channel-2/');
        return jsonResponse({
          channel: {
            state: 'STATE_OPEN',
            counterparty: {
              channel_id: matchesCardanoChannel ? 'channel-8' : 'channel-404',
              port_id: 'transfer',
            },
          },
        });
      }
      return jsonResponse({
        channels: [
          {
            channel_id: 'channel-100',
            port_id: 'icahost',
            state: 'STATE_OPEN',
            counterparty: {
              channel_id: 'channel-100',
              port_id: 'transfer',
            },
          },
          {
            channel_id: 'channel-99',
            port_id: 'transfer',
            state: 'STATE_OPEN',
            counterparty: {
              channel_id: 'channel-99',
              port_id: 'wasm.contract',
            },
          },
          {
            channel_id: 'channel-98',
            port_id: 'transfer',
            state: 'STATE_CLOSED',
            counterparty: {
              channel_id: 'channel-98',
              port_id: 'transfer',
            },
          },
          {
            channel_id: 'channel-9',
            port_id: 'transfer',
            state: 'STATE_OPEN',
            counterparty: {
              channel_id: 'channel-3',
              port_id: 'transfer',
            },
          },
          {
            channel_id: 'channel-8',
            port_id: 'transfer',
            state: 'STATE_OPEN',
            counterparty: {
              channel_id: 'channel-2',
              port_id: 'transfer',
            },
          },
          {
            channel_id: 'channel-7',
            port_id: 'transfer',
            state: 3,
            counterparty: {
              channel_id: 'channel-1',
              port_id: 'transfer',
            },
          },
        ],
        pagination: {
          next_key: null,
          total: '6',
        },
      });
    };
    const planner = createPlannerClient({
      cardanoChainId: 'cardano-preprod',
      cardanoRestEndpoint: 'http://cardano.test',
      counterpartyChainId: 'injective-888',
      localOsmosisRestEndpoint: 'http://injective.test',
      fetchImpl,
    });

    const result = await planner.planTransferRoute({
      fromChainId: 'injective-888',
      toChainId: 'cardano-preprod',
      tokenDenom: 'inj',
    });

    assert.equal(result.foundRoute, true);
    assert.deepEqual(result.routes, ['transfer/channel-2']);
    assert.deepEqual(requestedUrls, [
      'http://cardano.test/api/cardano/channel-ends?key=&offset=0&limit=10000&countTotal=true&reverse=false',
      'http://injective.test/ibc/core/channel/v1/channels/channel-3/ports/transfer',
      'http://injective.test/ibc/core/channel/v1/channels/channel-2/ports/transfer',
    ]);
  });

  it(
    'aborts and rejects route discovery after the overall timeout',
    { timeout: 1_000 },
    async () => {
      const captured: { signal?: AbortSignal } = {};
      let abortEvents = 0;
      const fetchImpl: typeof fetch = async (_input, init) => {
        captured.signal = init?.signal ?? undefined;
        captured.signal?.addEventListener(
          'abort',
          () => {
            abortEvents += 1;
          },
          { once: true },
        );
        return await new Promise<Response>(() => undefined);
      };
      const planner = createPlannerClient({
        cardanoChainId: 'cardano-preprod',
        cardanoRestEndpoint: 'http://cardano.test',
        counterpartyChainId: 'injective-888',
        localOsmosisRestEndpoint: 'http://injective.test',
        routeDiscoveryTimeoutMs: 25,
        fetchImpl,
      });

      await assert.rejects(
        planner.planTransferRoute({
          fromChainId: 'cardano-preprod',
          toChainId: 'injective-888',
          tokenDenom: 'lovelace',
        }),
        (error: unknown) => {
          assert.ok(error instanceof RouteDiscoveryTimeoutError);
          assert.equal(error.timeoutMs, 25);
          assert.equal(
            error.message,
            'IBC route discovery timed out after 25 milliseconds.',
          );
          return true;
        },
      );

      assert.ok(captured.signal);
      assert.equal(captured.signal.aborted, true);
      assert.equal(abortEvents, 1);
    },
  );

  it(
    'clears the deadline after route discovery finishes',
    { timeout: 1_000 },
    async () => {
      const captured: { signal?: AbortSignal } = {};
      const fetchImpl: typeof fetch = async (_input, init) => {
        captured.signal = init?.signal ?? undefined;
        return jsonResponse({ channels: [], pagination: {} });
      };
      const planner = createPlannerClient({
        cardanoChainId: 'cardano-preprod',
        cardanoRestEndpoint: 'http://cardano.test',
        counterpartyChainId: 'injective-888',
        localOsmosisRestEndpoint: 'http://injective.test',
        routeDiscoveryTimeoutMs: 25,
        fetchImpl,
      });

      const result = await planner.planTransferRoute({
        fromChainId: 'cardano-preprod',
        toChainId: 'injective-888',
        tokenDenom: 'lovelace',
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.equal(result.foundRoute, false);
      assert.ok(captured.signal);
      assert.equal(captured.signal.aborted, false);
    },
  );
});
