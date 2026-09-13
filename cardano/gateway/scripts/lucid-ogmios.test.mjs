import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import cbor from 'cbor';
import * as CML from '@anastasia-labs/cardano-multiplatform-lib-nodejs';
import { applyDoubleCborEncoding, toScriptRef } from '@lucid-evolution/utils';
import * as esm from '@lucid-evolution/provider';

const require = createRequire(import.meta.url);
const policyId = 'ab'.repeat(28);
const budgets = [{ validator: { purpose: 'spend', index: 0 }, budget: { memory: 123, cpu: 456 } }];

async function withOgmios(run, error) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
    response.writeHead(error ? 400 : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: null, ...(error ? { error } : { result: budgets }) }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

for (const [format, { Kupmios }] of [['ESM', esm], ['CommonJS', require('@lucid-evolution/provider')]]) {
  test(`${format}: evaluation preserves reference scripts as tagged ledger CBOR`, async () => {
    const utxos = ['PlutusV1', 'PlutusV2', 'PlutusV3', undefined].map((type, index) => ({
      txHash: '12'.repeat(32), outputIndex: index, address: 'addr_test1_evaluation_fixture',
      assets: { lovelace: 2_000_000n, [policyId + '01']: 9_007_199_254_740_991n },
      ...(index === 0 ? { datumHash: '34'.repeat(32) } : { datum: 'd87980' }),
      ...(type ? { scriptRef: { type, script: applyDoubleCborEncoding(
        // V3 uses countSetBits, which is enabled after the language's introduction.
        type === 'PlutusV3' ? '4b010100237a891101000001' : '49480100002221200101',
      ) } } : {}),
    }));
    const original = structuredClone(utxos);
    await withOgmios(async (endpoint, requests) => {
      const provider = new Kupmios(endpoint, endpoint, { ogmiosHeader: { authorization: 'Bearer fixture' } });
      assert.deepEqual(await provider.evaluateTx('a100', utxos), [{
        redeemer_tag: 'spend', redeemer_index: 0, ex_units: { mem: 123, steps: 456 },
      }]);
      assert.equal(requests.length, 1);
      const { headers, body } = requests[0];
      assert.equal(headers.authorization, 'Bearer fixture');
      assert.equal(body.method, 'evaluateTransaction');
      assert.deepEqual(body.params.transaction, { cbor: 'a100' });
      assert.equal(body.params.additionalUtxo.length, utxos.length);
      body.params.additionalUtxo.forEach((actual, index) => {
        const { script, ...output } = actual;
        const expected = utxos[index];
        assert.deepEqual(output, {
          transaction: { id: expected.txHash }, index: expected.outputIndex, address: expected.address,
          value: { ada: { lovelace: 2_000_000 }, [policyId]: { '01': 9_007_199_254_740_991 } },
          ...(expected.datumHash ? { datumHash: expected.datumHash } : { datum: expected.datum }),
        });
        if (!expected.scriptRef) return assert.equal(script, undefined);
        assert.equal(typeof script, 'string');
        const tagged = cbor.decodeFirstSync(script);
        assert.equal(tagged.tag, 24);
        const decoded = CML.Script.from_cbor_bytes(tagged.value);
        const reference = toScriptRef(expected.scriptRef);
        assert.equal(decoded.kind(), reference.kind());
        assert.equal(decoded.hash().to_hex(), reference.hash().to_hex());
        assert.deepEqual(decoded.to_cbor_bytes(), reference.to_cbor_bytes());
      });
    });
    assert.deepEqual(utxos, original);
  });

  test(`${format}: ledger evaluation failures still reject the transaction`, async () => {
    await withOgmios(async (endpoint, requests) => {
      const provider = new Kupmios(endpoint, endpoint);
      await assert.rejects(provider.evaluateTx('a100'), /3010.*fixture validator rejected/s);
      assert.equal(requests.length, 1);
    }, { code: 3010, message: 'fixture validator rejected' });
  });
}
