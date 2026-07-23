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
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ channels: [], pagination: {} });
    const planner = createPlannerClient({
      cardanoChainId: 'cardano-local',
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
  });

  it('returns a native direct route only when Osmosis exposes an open Cardano channel', async () => {
    const fetchImpl: typeof fetch = async (url) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('/client_state')) {
        return jsonResponse({
          identified_client_state: {
            client_state: { chain_id: 'cardano-local' },
          },
        });
      }
      return jsonResponse({
        channels: [
          {
            channel_id: 'channel-2',
            port_id: 'transfer',
            state: 'STATE_OPEN',
            counterparty: {
              channel_id: 'channel-8',
              port_id: 'transfer',
            },
          },
        ],
        pagination: {},
      });
    };
    const planner = createPlannerClient({
      cardanoChainId: 'cardano-local',
      localOsmosisRestEndpoint: 'http://osmosis.test',
      fetchImpl,
    });

    const result = await planner.planTransferRoute({
      fromChainId: 'cardano-local',
      toChainId: 'localosmosis',
      tokenDenom: 'lovelace',
    });

    assert.equal(result.foundRoute, true);
    assert.equal(result.mode, 'native-forward');
    assert.deepEqual(result.chains, ['cardano-local', 'localosmosis']);
    assert.deepEqual(result.routes, ['transfer/channel-8']);
    assert.deepEqual(result.tokenTrace, {
      kind: 'native',
      path: '',
      baseDenom: 'lovelace',
      fullDenom: 'lovelace',
    });
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
        cardanoChainId: 'cardano-local',
        localOsmosisRestEndpoint: 'http://osmosis.test',
        routeDiscoveryTimeoutMs: 25,
        fetchImpl,
      });

      await assert.rejects(
        planner.planTransferRoute({
          fromChainId: 'cardano-local',
          toChainId: 'localosmosis',
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
    'passes the same timeout signal to nested client-state discovery',
    { timeout: 1_000 },
    async () => {
      const capturedSignals: AbortSignal[] = [];
      const fetchImpl: typeof fetch = async (url, init) => {
        assert.ok(init?.signal);
        capturedSignals.push(init.signal);
        if (String(url).endsWith('/client_state')) {
          return await new Promise<Response>(() => undefined);
        }
        return jsonResponse({
          channels: [
            {
              channel_id: 'channel-2',
              port_id: 'transfer',
              state: 'STATE_OPEN',
              counterparty: {
                channel_id: 'channel-8',
                port_id: 'transfer',
              },
            },
          ],
          pagination: {},
        });
      };
      const planner = createPlannerClient({
        cardanoChainId: 'cardano-local',
        localOsmosisRestEndpoint: 'http://osmosis.test',
        routeDiscoveryTimeoutMs: 25,
        fetchImpl,
      });

      await assert.rejects(
        planner.planTransferRoute({
          fromChainId: 'cardano-local',
          toChainId: 'localosmosis',
          tokenDenom: 'lovelace',
        }),
        RouteDiscoveryTimeoutError,
      );

      assert.equal(capturedSignals.length, 2);
      assert.equal(capturedSignals[0], capturedSignals[1]);
      assert.equal(capturedSignals[1].aborted, true);
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
        cardanoChainId: 'cardano-local',
        localOsmosisRestEndpoint: 'http://osmosis.test',
        routeDiscoveryTimeoutMs: 25,
        fetchImpl,
      });

      const result = await planner.planTransferRoute({
        fromChainId: 'cardano-local',
        toChainId: 'localosmosis',
        tokenDenom: 'lovelace',
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.equal(result.foundRoute, false);
      assert.ok(captured.signal);
      assert.equal(captured.signal.aborted, false);
    },
  );
});
