import assert from 'node:assert/strict';
import { once } from 'node:events';
import { it } from 'node:test';
import { WebSocketServer } from 'ws';
import { credentialToAddress, SLOT_CONFIG_NETWORK, type Network } from '@lucid-evolution/lucid';
import { computeTxValidityWindow, createLucidRuntime } from './index';

const currentSlot = 200_000_000;
const logger = { log() {}, warn() {}, error() {} };
const fetchParameters = (async () => Response.json({ result: {
  minFeeCoefficient: 44,
  minFeeConstant: { ada: { lovelace: 155381 } },
  maxTransactionSize: { bytes: 16384 },
  maxValueSize: { bytes: 5000 },
  stakeCredentialDeposit: { ada: { lovelace: 2_000_000 } },
  stakePoolDeposit: { ada: { lovelace: 500_000_000 } },
  delegateRepresentativeDeposit: { ada: { lovelace: 500_000_000 } },
  governanceActionDeposit: { ada: { lovelace: 100_000_000_000 } },
  scriptExecutionPrices: { memory: '577/10000', cpu: '721/10000000' },
  maxExecutionUnitsPerTransaction: { memory: 14_000_000, cpu: 10_000_000_000 },
  collateralPercentage: 150,
  maxCollateralInputs: 3,
  minFeeReferenceScripts: { base: 15 },
  utxoCostPerByte: 4310,
  plutusCostModels: { 'plutus:v1': [1, 2], 'plutus:v2': [3, 4] },
} })) as typeof fetch;

it('keeps runtime timestamps and completed transaction slots aligned across network initializations', async () => {
  const presetsBefore = structuredClone(SLOT_CONFIG_NETWORK);
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const endpoint = `ws://127.0.0.1:${address.port}`;
  let systemStart = '';
  let startQueries = 0;
  server.on('connection', (socket) => socket.on('message', (message) => {
    const request = JSON.parse(message.toString());
    if (request.method === 'queryNetwork/startTime') startQueries += 1;
    socket.send(JSON.stringify({
      id: request.id,
      result: request.method === 'queryNetwork/startTime'
        ? systemStart
        : { slot: currentSlot, id: 'tip' },
    }));
  }));

  try {
    const cases: [Network, string][] = [
      ['Preview', '2022-10-25T00:00:00Z'],
      ['Preprod', '2022-06-01T00:00:00Z'],
      ['Mainnet', '2017-09-23T21:44:51Z'],
      ['Custom', '2025-01-01T00:00:00Z'],
      ['Custom', '2026-01-01T00:00:00Z'],
      ['Preprod', '2022-06-01T00:00:00Z'],
    ];
    const contexts = [];
    for (const [cardanoNetwork, start] of cases) {
      systemStart = start;
      const { lucid } = await createLucidRuntime('http://kupo.test', endpoint, cardanoNetwork, logger, undefined, fetchParameters);
      const expectedConfig = cardanoNetwork === 'Custom'
        ? { zeroTime: Date.parse(start), zeroSlot: 0, slotLength: 1000 }
        : presetsBefore[cardanoNetwork];
      assert.deepEqual(lucid.config().slotConfig, expectedConfig);
      assert.ok(Object.isFrozen(lucid.config().slotConfig));
      contexts.push({ lucid, cardanoNetwork, ogmiosEndpoint: endpoint });
    }
    assert.equal(startQueries, 2, 'only Custom needs the chain system start');
    assert.deepEqual(SLOT_CONFIG_NETWORK, presetsBefore);

    // Check earlier instances after other networks and another Custom chain initialize.
    for (const context of contexts) {
      const window = await computeTxValidityWindow(context);
      const walletAddress = credentialToAddress(context.cardanoNetwork, { type: 'Key', hash: '11'.repeat(28) });
      context.lucid.selectWallet.fromAddress(walletAddress, [{
        txHash: '22'.repeat(32), outputIndex: 0, address: walletAddress,
        assets: { lovelace: 100_000_000n },
      }]);
      const tx = await context.lucid.newTx()
        .pay.ToAddress(walletAddress, { lovelace: 2_000_000n })
        .validFrom(window.validFromTime).validTo(window.validToTime).complete();
      const body = tx.toTransaction().body();
      assert.equal(body.validity_interval_start(), BigInt(currentSlot), context.cardanoNetwork);
      assert.equal(body.ttl(), 200_000_600n, context.cardanoNetwork);
    }
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
