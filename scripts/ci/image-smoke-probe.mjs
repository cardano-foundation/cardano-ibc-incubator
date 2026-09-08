import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const component = process.argv[2];
const origin = component === 'gateway' ? 'http://127.0.0.1:8000' : 'http://127.0.0.1:3000';
const endpoint = component === 'gateway' ? '/health' : '/api/runtime-config';
let response;
for (let attempt = 0; attempt < 120; attempt++) {
  try {
    response = await fetch(origin + endpoint, { signal: AbortSignal.timeout(2000) });
    if (response.ok) break;
  } catch { /* Listener is not ready yet. */ }
  await delay(500);
}
assert.ok(response?.ok, component + ' did not become ready');
if (component === 'gateway') {
  const health = await response.json();
  assert.equal(health.status, 'ok');
  assert.equal(health.details.gateway_db.status, 'up');
  assert.equal(health.details.history_backend.status, 'up');
  const swagger = await fetch(origin + '/swagger-json', { signal: AbortSignal.timeout(5000) });
  assert.equal(swagger.status, 200);
  assert.ok((await swagger.json()).paths['/health']);
  const fixture = await fetch('http://fixture:8080/__smoke/status', { signal: AbortSignal.timeout(5000) });
  const observed = await fixture.json();
  assert.deepEqual(observed.unexpected, []);
  for (const kind of ['protocol', 'references', 'host', 'datum', 'entities']) {
    assert.ok(observed[kind] > 0, 'Startup did not exercise ' + kind);
  }
} else if (component === 'swap-client') {
  const runtime = await response.text();
  assert.match(runtime, /"NEXT_PUBLIC_CARDANO_NETWORK":"preview"/);
  assert.match(runtime, /"NEXT_PUBLIC_CARDANO_CHAIN_ID":"2"/);
  const page = await fetch(origin + '/transfer', { signal: AbortSignal.timeout(5000) });
  const html = await page.text();
  assert.equal(page.status, 200, 'Transfer page failed: ' + html.slice(0, 1000));
  assert.match(html, /data-cardano-network="preview"/);
  assert.match(html, /data-cardano-chain-id="2"/);
  const asset = html.match(/src="(\/_next\/static\/[^"]+)"/)?.[1];
  assert.ok(asset, 'Missing standalone static JavaScript asset');
  const staticResponse = await fetch(origin + asset, { signal: AbortSignal.timeout(5000) });
  assert.equal(staticResponse.status, 200);
  assert.match(staticResponse.headers.get('content-type'), /javascript/);
} else {
  throw new Error('Unknown smoke component');
}
console.log(component + ' runtime smoke passed');
