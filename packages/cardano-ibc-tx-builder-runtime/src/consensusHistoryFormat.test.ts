import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTxBuilderRuntime } from './index';

test('standalone runtime rejects old history ABIs before touching providers or submitting a transaction', async () => {
  for (const format of [undefined, null, '', 'archive-nft-v1', 'proof-backed-v2']) {
    const urls: string[] = [];
    const runtime = createTxBuilderRuntime({
      bridgeManifestUrl: 'https://manifest.example/bridge.json',
      kupmiosUrl: 'invalid-provider-that-must-not-be-used',
      logger: { log() {}, warn() {}, error() {} },
      fetchImpl: (async (input: string | URL | Request) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ schema_version: 4, consensus_history_format: format }));
      }) as typeof fetch,
    });
    await assert.rejects(runtime.submitSignedTransaction({ signed_tx_cbor: '00' }), /fresh proof-backed deployment is required/);
    assert.deepEqual(urls, ['https://manifest.example/bridge.json']);
  }
});

test('standalone runtime recognizes the history capability without bypassing manifest schema validation', async () => {
  const runtime = createTxBuilderRuntime({
    bridgeManifestUrl: 'https://manifest.example/bridge.json',
    kupmiosUrl: 'invalid-provider-that-must-not-be-used',
    logger: { log() {}, warn() {}, error() {} },
    fetchImpl: (async () => new Response(JSON.stringify({
      schema_version: 3, consensus_history_format: 'proof-backed-v1',
    }))) as typeof fetch,
  });
  await assert.rejects(runtime.submitSignedTransaction({ signed_tx_cbor: '00' }), /schema_version: expected 4/);
});
