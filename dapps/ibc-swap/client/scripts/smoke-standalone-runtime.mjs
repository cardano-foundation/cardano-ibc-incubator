import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const port = '39154';
const origin = `http://127.0.0.1:${port}`;
const requiredServerFiles = JSON.parse(
  await readFile('.next/required-server-files.json', 'utf8'),
);
const basePath = requiredServerFiles.config?.basePath || '';

async function assertRuntimeReadinessRejectsMissingDemeterKeys() {
  const invalidPort = '39153';
  const invalidOrigin = `http://127.0.0.1:${invalidPort}`;
  const invalidServer = spawn(
    process.execPath,
    ['.next/standalone/dapps/ibc-swap/client/server.js'],
    {
      env: {
        ...process.env,
        HOSTNAME: '127.0.0.1',
        PORT: invalidPort,
        NEXT_PUBLIC_IBC_SWAP_MODE: 'testnet',
        NEXT_PUBLIC_CARDANO_NETWORK: 'preview',
        NEXT_PUBLIC_CARDANO_CHAIN_ID: '2',
        NEXT_PUBLIC_CARDANO_IBC_CHAIN_ID: 'cardano-preview',
        IBC_SWAP_KUPMIOS_INTERNAL_URL:
          'https://cardano-preview-v2.kupo-m1.dmtr.host,https://cardano-preview-v6.ogmios-m1.dmtr.host',
        IBC_SWAP_KUPMIOS_URL: '',
        IBC_SWAP_KUPO_API_KEY: '',
        IBC_SWAP_OGMIOS_API_KEY: '',
        KUPO_API_KEY: '',
        OGMIOS_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let invalidOutput = '';
  invalidServer.stdout.on('data', (chunk) => {
    invalidOutput += chunk.toString();
  });
  invalidServer.stderr.on('data', (chunk) => {
    invalidOutput += chunk.toString();
  });

  try {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (invalidServer.exitCode !== null) {
        throw new Error(
          `Invalid-config server exited early:\n${invalidOutput}`,
        );
      }
      let response;
      try {
        response = await fetch(
          `${invalidOrigin}${basePath}/api/runtime-config`,
        );
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      assert.equal(
        response.status,
        500,
        'runtime readiness accepted unauthenticated Demeter endpoints without keys',
      );
      return;
    }
    throw new Error(
      `Invalid-config server did not answer before the deadline:\n${invalidOutput}`,
    );
  } finally {
    invalidServer.kill('SIGTERM');
  }
}

await assertRuntimeReadinessRejectsMissingDemeterKeys();

const server = spawn(
  process.execPath,
  ['.next/standalone/dapps/ibc-swap/client/server.js'],
  {
    env: {
      ...process.env,
      HOSTNAME: '127.0.0.1',
      PORT: port,
      NEXT_PUBLIC_IBC_SWAP_MODE: 'testnet',
      NEXT_PUBLIC_CARDANO_NETWORK: 'preview',
      NEXT_PUBLIC_CARDANO_CHAIN_ID: '2',
      NEXT_PUBLIC_CARDANO_IBC_CHAIN_ID: 'cardano-preview',
      NEXT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL:
        'https://example.invalid/cardano-preview-bridge-manifest.json',
      IBC_SWAP_KUPMIOS_INTERNAL_URL:
        'https://kupo.example.invalid,https://ogmios.example.invalid',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let serverOutput = '';
server.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString();
});

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Standalone server exited early:\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${origin}${basePath}/api/runtime-config`);
      if (response.ok) return response.text();
    } catch {
      // Startup races are expected until the listener is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Standalone server did not become ready:\n${serverOutput}`);
}

try {
  const runtimeScript = await waitForServer();
  assert.match(runtimeScript, /"NEXT_PUBLIC_CARDANO_NETWORK":"preview"/);
  assert.match(runtimeScript, /"NEXT_PUBLIC_CARDANO_CHAIN_ID":"2"/);
  assert.doesNotMatch(runtimeScript, /cardano-preprod|cardano-devnet/);

  const htmlResponse = await fetch(`${origin}${basePath}/transfer`);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  assert.match(html, /data-cardano-network="preview"/);
  assert.match(html, /data-cardano-chain-id="2"/);
  assert.match(
    html,
    new RegExp(`src="${basePath.replace(/\//g, '\\/')}\/api\/runtime-config"`),
  );
  assert.doesNotMatch(html, /data-cardano-network="(?:devnet|preprod)"/);

  for (const source of ['/', '/swap', '/queries']) {
    const requestPath =
      source === '/' ? basePath || '/' : `${basePath}${source}`;
    const redirectResponse = await fetch(`${origin}${requestPath}`, {
      redirect: 'manual',
    });
    assert.ok(
      [307, 308].includes(redirectResponse.status),
      `${source} returned ${redirectResponse.status} instead of a redirect`,
    );
    assert.equal(
      new URL(redirectResponse.headers.get('location'), origin).pathname,
      `${basePath}/transfer`,
    );
  }
} finally {
  server.kill('SIGTERM');
}
