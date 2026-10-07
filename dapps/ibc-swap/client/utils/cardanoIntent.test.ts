/* global globalThis */
import assert from 'node:assert/strict';
import test from 'node:test';
import intentHandler from '../pages/api/cardano/intents';
import cancelHandler from '../pages/api/cardano/intents/cancel';
import { intentRequest, cancelIntent } from './cardanoIntent';
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

test('owner cancellation builds once then signs and submits the returned transaction', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /intents\/cancel$/);
    assert.equal(options?.method, 'POST');
    assert.deepEqual(JSON.parse(String(options?.body)), {
      channel_id: intent.channel,
      intent_tx_hash: intent.hash,
      signer: intent.signer,
    });
    return Response.json({
      unsigned_tx: { value: Buffer.from('deadbeef').toString('base64') },
    });
  };
  try {
    const txHash = await cancelIntent(
      intent,
      intent.signer,
      async (unsignedTx) => {
        assert.equal(unsignedTx, 'deadbeef');
        return 'cancellation-hash';
      },
    );
    assert.equal(txHash, 'cancellation-hash');
  } finally {
    globalThis.fetch = original;
  }
});

test('another wallet cannot start cancellation or prompt signing', async () => {
  await assert.rejects(
    cancelIntent(intent, 'other-wallet', async () => {
      assert.fail('must not sign');
    }),
    /wallet that funded/,
  );
});

test('a send racing with cancellation reports the builder error without prompting signing', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ message: 'Intent is no longer pending' }, { status: 409 });
  try {
    await assert.rejects(
      cancelIntent(intent, intent.signer, async () => {
        assert.fail('must not sign');
      }),
      /no longer pending/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('a declined wallet signature leaves canonical status and the saved request available for retry', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      unsigned_tx: { value: Buffer.from('deadbeef').toString('base64') },
    });
  try {
    await assert.rejects(
      cancelIntent(intent, intent.signer, async () => {
        throw new Error('Signature declined');
      }),
      /Signature declined/,
    );
    assert.equal(
      await cancelIntent(intent, intent.signer, async () => 'retry-hash'),
      'retry-hash',
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('the cancellation proxy forwards only a validated owner build request and returns upstream errors', async () => {
  const original = globalThis.fetch;
  let code = 0;
  let body: any;
  const response: any = {
    setHeader() {},
    status(value: number) {
      code = value;
      return this;
    },
    json(value: any) {
      body = value;
      return this;
    },
  };
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.ok(String(url).endsWith(`/channel-0/${intent.hash}/cancel`));
    assert.equal(options?.method, 'POST');
    assert.deepEqual(JSON.parse(String(options?.body)), {
      signer: intent.signer,
      output_index: 1,
    });
    return Response.json(
      { message: 'Only the intent owner can cancel' },
      { status: 400 },
    );
  };
  try {
    await cancelHandler({ method: 'GET' } as any, response);
    assert.equal(code, 405);
    await cancelHandler(
      { method: 'POST', body: { channel_id: 'invalid' } } as any,
      response,
    );
    assert.equal(code, 400);
    assert.equal(calls, 0);
    await cancelHandler(
      {
        method: 'POST',
        body: {
          channel_id: intent.channel,
          intent_tx_hash: intent.hash,
          signer: intent.signer,
          output_index: 1,
        },
      } as any,
      response,
    );
    assert.equal(code, 400);
    assert.equal(body.message, 'Only the intent owner can cancel');
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
