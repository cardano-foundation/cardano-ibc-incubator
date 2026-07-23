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
      'http://cardano.test/api/channels?key=&offset=0&limit=10000&countTotal=true&reverse=false',
      'http://injective.test/ibc/core/channel/v1/channels/channel-2/ports/transfer',
      'http://cardano.test/api/channels?key=&offset=0&limit=10000&countTotal=true&reverse=false',
      'http://injective.test/ibc/core/channel/v1/channels/channel-2/ports/transfer',
    ]);
  });

  it('filters channels with one bounded Gateway listing and targeted counterparty checks', async () => {
    const requestedUrls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      const requestUrl = String(url);
      requestedUrls.push(requestUrl);
      if (!requestUrl.startsWith('http://cardano.test')) {
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
      'http://cardano.test/api/channels?key=&offset=0&limit=10000&countTotal=true&reverse=false',
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
