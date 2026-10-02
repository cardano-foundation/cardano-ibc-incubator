/* global globalThis */
import assert from 'node:assert/strict';
import test from 'node:test';
import intentHandler from '../pages/api/cardano/intents';
import { intentRequest } from './cardanoIntent';
import { fundsReceived } from './transferReceipt';

const intent = {
  hash: 'ab'.repeat(32),
  channel: 'channel-0',
  signer: 'addr_test1wallet',
};

test('funded request tracking only reads canonical state and follows rollbacks', async () => {
  const original = globalThis.fetch;
  const replies = [
    { stage: 'funded' },
    { stage: 'sent', packetTxHash: 'batch', packetSequence: '2' },
    { stage: 'funded' },
  ];
  globalThis.fetch = async (url, options) => {
    assert.equal(options?.method ?? 'GET', 'GET');
    assert.ok(String(url).includes(intent.hash));
    assert.ok(!String(url).includes(intent.signer));
    return Response.json(replies.shift());
  };
  try {
    assert.equal((await intentRequest(intent)).stage, 'funded');
    assert.equal((await intentRequest(intent)).packetSequence, '2');
    assert.equal((await intentRequest(intent)).stage, 'funded');
  } finally {
    globalThis.fetch = original;
  }
});

test('funds received requires the final destination to acknowledge success', () => {
  const status: any = {
    routeChainIds: ['a', 'b', 'c'],
    packets: [
      {
        index: 0,
        recv: {},
        writeAcknowledgement: {
          acknowledgementHex: Buffer.from('{"result":"AQ=="}').toString('hex'),
        },
      },
    ],
  };
  assert.equal(fundsReceived(status), false);
  status.packets[0].index = 1;
  assert.equal(fundsReceived(status), true);
  status.packets[0].writeAcknowledgement.acknowledgementHex = Buffer.from(
    '{"error":"rejected"}',
  ).toString('hex');
  assert.equal(fundsReceived(status), false);
});

test('the browser intent endpoint rejects transaction-building requests', async () => {
  let code = 0;
  const response: any = {
    setHeader() {},
    status(value: number) {
      code = value;
      return this;
    },
    json() {
      return this;
    },
  };
  await intentHandler(
    { method: 'POST', body: { signer: 'user' } } as any,
    response,
  );
  assert.equal(code, 405);
});
