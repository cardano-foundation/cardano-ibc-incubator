import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPlannerClient } from './index';

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
});
