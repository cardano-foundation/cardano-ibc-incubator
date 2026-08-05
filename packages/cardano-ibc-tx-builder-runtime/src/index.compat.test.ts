import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server, type Socket } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import {
  mapOgmiosProtocolParameters,
  ogmiosRequest,
  queryProtocolParametersCompat,
  retryWithBackoff,
  withKupoStringQuantityHeader,
} from './index';
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

    assert.equal(mapped.coinsPerUtxoByte, 4310n);
    assert.deepEqual(mapped.costModels, {
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

    assert.equal(mapped.coinsPerUtxoByte, 4310n);
    assert.deepEqual(mapped.costModels, {
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

    assert.deepEqual(mapped.costModels.PlutusV3, []);
    await assert.doesNotReject(
      Lucid(undefined, 'Preprod', { presetProtocolParameters: mapped }),
    );
  });

  it('rejects malformed protocol parameters', () => {
    assert.throws(
      () => mapOgmiosProtocolParameters(protocolParameters()),
      /missing utxoCostPerByte\/minUtxoDepositCoefficient/,
    );
    assert.throws(
      () =>
        mapOgmiosProtocolParameters(
          protocolParameters({
            utxoCostPerByte: 4310,
          }),
        ),
      /missing a non-empty plutus:v1 cost model/,
    );
    assert.throws(
      () =>
        mapOgmiosProtocolParameters(
          protocolParameters({
            utxoCostPerByte: 4310,
            plutusCostModels: {
              'plutus:v1': [1, 2],
              'plutus:v2': [],
            },
          }),
        ),
      /missing a non-empty plutus:v2 cost model/,
    );
    assert.throws(
      () =>
        mapOgmiosProtocolParameters(
          protocolParameters({
            utxoCostPerByte: 4310,
            plutusCostModels: { 'plutus:v3': 'not-a-cost-model' },
          }),
        ),
      /invalid plutus:v3 cost model/,
    );
  });

  it('aborts and rejects stalled requests at the configured deadline', async () => {
    let observedSignal: AbortSignal | undefined;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }) as typeof fetch;

    await assert.rejects(
      queryProtocolParametersCompat('https://ogmios.test', undefined, fetchImpl, 10),
      /timed out after 10ms/,
    );
    assert.equal(observedSignal?.aborted, true);
  });

  it('also bounds a response body that never finishes', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      text: async () => new Promise<string>(() => undefined),
    })) as unknown as typeof fetch;

    await assert.rejects(
      queryProtocolParametersCompat('https://ogmios.test', undefined, fetchImpl, 10),
      /timed out after 10ms/,
    );
  });

  it('retries 429 and temporary 5xx responses', async () => {
    const statuses = [429, 520];
    let attempts = 0;
    const result = await retryWithBackoff(
      async () => {
        const status = statuses[attempts];
        attempts += 1;
        if (status !== undefined) {
          throw Object.assign(new Error(`HTTP ${status}`), { status });
        }
        return 'ready';
      },
      async () => undefined,
    );

    assert.equal(result, 'ready');
    assert.equal(attempts, 3);
  });

  it('does not retry an ordinary client error', async () => {
    let attempts = 0;

    await assert.rejects(
      retryWithBackoff(
        async () => {
          attempts += 1;
          throw Object.assign(new Error('bad request'), { status: 400 });
        },
        async () => undefined,
      ),
      /bad request/,
    );
    assert.equal(attempts, 1);
  });

  it('honors Retry-After from a 429 response before retrying', async () => {
    const result = protocolParameters({
      utxoCostPerByte: 4310,
      plutusCostModels: {
        'plutus:v1': [1, 2],
        'plutus:v2': [3, 4],
      },
    });
    const responses = [
      new Response('rate limited', {
        status: 429,
        headers: { 'retry-after': '30' },
      }),
      new Response(JSON.stringify({ result }), { status: 200 }),
    ];
    const fetchImpl = (async () => responses.shift()!) as typeof fetch;
    const waits: number[] = [];

    const mapped = await retryWithBackoff(
      () =>
        queryProtocolParametersCompat(
          'https://ogmios.test',
          undefined,
          fetchImpl,
          50,
        ),
      async (durationMs) => {
        waits.push(durationMs);
      },
    );

    assert.equal(mapped.coinsPerUtxoByte, 4310n);
    assert.deepEqual(waits, [30_000]);
    assert.equal(responses.length, 0);
  });
});

async function closeNetServer(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) {
    socket.destroy();
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  for (const client of server.clients) {
    client.terminate();
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function webSocketServerUrl(server: WebSocketServer): string {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected the test WebSocket server to have a TCP address');
  }
  return `ws://127.0.0.1:${address.port}`;
}

describe('Ogmios WebSocket request lifecycle', () => {
  it('returns the Ogmios result and closes the one-shot socket', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const serverSocketClosed = new Promise<void>((resolve) => {
      server.once('connection', (socket) => {
        socket.once('message', () => {
          socket.send(JSON.stringify({ result: { slot: 42, id: 'abc' } }));
        });
        socket.once('close', resolve);
      });
    });

    try {
      const result = await ogmiosRequest<{ slot: number; id: string }>(
        webSocketServerUrl(server),
        'queryNetwork/tip',
        {},
        undefined,
        1000,
      );
      assert.deepEqual(result, { slot: 42, id: 'abc' });
      await serverSocketClosed;
    } finally {
      await closeWebSocketServer(server);
    }
  });

  it('times out a WebSocket handshake that never completes', async () => {
    const sockets = new Set<Socket>();
    let acceptedConnection = false;
    const server = createServer((socket) => {
      acceptedConnection = true;
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    try {
      await assert.rejects(
        ogmiosRequest(`ws://127.0.0.1:${address.port}`, 'queryNetwork/tip', {}, undefined, 100),
        /timed out after 100ms while opening the WebSocket/,
      );
      assert.equal(acceptedConnection, true, 'the test server should accept the handshake connection');
    } finally {
      await closeNetServer(server, sockets);
    }
  });

  it('times out after opening while waiting for an Ogmios response', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    let serverSocket: WebSocket | undefined;
    const serverSocketClosed = new Promise<void>((resolve) => {
      server.once('connection', (socket) => {
        serverSocket = socket;
        socket.once('close', resolve);
      });
    });

    try {
      await assert.rejects(
        ogmiosRequest(webSocketServerUrl(server), 'queryNetwork/tip', {}, undefined, 100),
        /timed out after 100ms while waiting for a response/,
      );
      await serverSocketClosed;
      assert.equal(serverSocket?.readyState, WebSocket.CLOSED);
    } finally {
      await closeWebSocketServer(server);
    }
  });

  it('rejects immediately when Ogmios closes before returning a response', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    server.once('connection', (socket) => socket.close(1000, 'test close'));

    try {
      await assert.rejects(
        ogmiosRequest(webSocketServerUrl(server), 'queryNetwork/tip', {}, undefined, 1000),
        /WebSocket closed before a response was received \(code 1000: test close\)/,
      );
    } finally {
      await closeWebSocketServer(server);
    }
  });
});

describe('Kupo quantity negotiation', () => {
  it('forces string quantities without discarding authentication', () => {
    const original = {
      kupoHeader: {
        Accept: 'application/json',
        'dmtr-api-key': 'secret',
      },
      ogmiosHeader: { 'dmtr-api-key': 'ogmios-secret' },
    };

    assert.deepEqual(withKupoStringQuantityHeader(original), {
      kupoHeader: {
        accept: 'application/json;asset-quantity=string',
        'dmtr-api-key': 'secret',
      },
      ogmiosHeader: { 'dmtr-api-key': 'ogmios-secret' },
    });
    assert.equal(original.kupoHeader.Accept, 'application/json');
  });
});
