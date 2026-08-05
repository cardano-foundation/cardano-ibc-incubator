const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertBridgeManifestMatchesIdentity,
  resolveRuntimeIdentity,
} = require('./runtimeIdentity');
const {
  requireBrowserRuntimeEnvironment,
  selectPublicRuntimeEnvironment,
  validateRemoteKupmiosAuth,
} = require('./publicRuntimeConfig');

test('preview mode resolves Preview instead of silently falling back to Preprod', () => {
  assert.deepEqual(
    resolveRuntimeIdentity({ NEXT_PUBLIC_IBC_SWAP_MODE: 'preview' }),
    {
      mode: 'testnet',
      network: 'preview',
      chainId: '2',
      ibcChainId: 'cardano-preview',
    },
  );
});

test('rejects a mode and Cardano network from different environments', () => {
  assert.throws(
    () =>
      resolveRuntimeIdentity({
        NEXT_PUBLIC_IBC_SWAP_MODE: 'mainnet',
        NEXT_PUBLIC_CARDANO_NETWORK: 'preview',
      }),
    /inconsistent|cannot use/,
  );
});

test('rejects nonnumeric and mismatched Cardano network magic values', () => {
  assert.throws(
    () =>
      resolveRuntimeIdentity({
        NEXT_PUBLIC_IBC_SWAP_MODE: 'testnet',
        NEXT_PUBLIC_CARDANO_CHAIN_ID: 'cardano-preview',
      }),
    /numeric network magic/,
  );
  assert.throws(
    () =>
      resolveRuntimeIdentity({
        NEXT_PUBLIC_IBC_SWAP_MODE: 'preview',
        NEXT_PUBLIC_CARDANO_CHAIN_ID: '1',
      }),
    /inconsistent/,
  );
});

test('rejects a mismatched Cardano IBC chain ID', () => {
  assert.throws(
    () =>
      resolveRuntimeIdentity({
        NEXT_PUBLIC_CARDANO_NETWORK: 'preview',
        NEXT_PUBLIC_CARDANO_IBC_CHAIN_ID: 'cardano-preprod',
      }),
    /inconsistent/,
  );
});

test('accepts a manifest matching all configured Cardano identity fields', () => {
  const identity = resolveRuntimeIdentity({
    NEXT_PUBLIC_IBC_SWAP_MODE: 'preview',
  });
  assert.doesNotThrow(() =>
    assertBridgeManifestMatchesIdentity(
      {
        cardano: {
          network: 'preview',
          chain_id: 'cardano-preview',
          network_magic: 2,
        },
      },
      identity,
    ),
  );
});

test('normalizes local manifest labels while retaining strict IDs and magic', () => {
  const identity = resolveRuntimeIdentity({
    NEXT_PUBLIC_IBC_SWAP_MODE: 'local',
  });
  for (const network of ['Custom', 'cardano-devnet']) {
    assert.doesNotThrow(() =>
      assertBridgeManifestMatchesIdentity(
        {
          cardano: {
            network,
            chain_id: 'cardano-devnet',
            network_magic: 42,
          },
        },
        identity,
      ),
    );
  }
  assert.throws(
    () =>
      assertBridgeManifestMatchesIdentity(
        {
          cardano: {
            network: 'Custom',
            chain_id: 'cardano-preview',
            network_magic: 2,
          },
        },
        identity,
      ),
    /configured for devnet\/cardano-devnet\/42/,
  );
});

test('rejects a bridge manifest for a different Cardano network', () => {
  const identity = resolveRuntimeIdentity({
    NEXT_PUBLIC_IBC_SWAP_MODE: 'preview',
  });
  assert.throws(
    () =>
      assertBridgeManifestMatchesIdentity(
        {
          cardano: {
            network: 'preprod',
            chain_id: 'cardano-preprod',
            network_magic: 1,
          },
        },
        identity,
      ),
    /configured for preview\/cardano-preview\/2/,
  );
});

test('browser runtime config never exposes Kupmios endpoints or credentials', () => {
  assert.deepEqual(
    selectPublicRuntimeEnvironment({
      NEXT_PUBLIC_CARDANO_NETWORK: 'preview',
      NEXT_PUBLIC_KUPMIOS_URL:
        'https://secret-in-hostname.preview-v2.kupo-m1.dmtr.host,https://ogmios.example',
      IBC_SWAP_KUPMIOS_URL:
        'https://server-only-kupo,https://server-only-ogmios',
      IBC_SWAP_KUPO_API_KEY: 'kupo-secret',
      IBC_SWAP_OGMIOS_API_KEY: 'ogmios-secret',
      KUPO_API_KEY: 'legacy-kupo-secret',
      OGMIOS_API_KEY: 'legacy-ogmios-secret',
    }),
    { NEXT_PUBLIC_CARDANO_NETWORK: 'preview' },
  );
});

test('browser startup fails closed when its runtime script did not load', () => {
  assert.throws(
    () => requireBrowserRuntimeEnvironment(undefined),
    /refusing to use build-time network defaults/,
  );
});

test('runtime readiness rejects unauthenticated Demeter endpoints without keys', () => {
  const environment = {
    NEXT_PUBLIC_IBC_SWAP_MODE: ' Preview ',
    IBC_SWAP_KUPMIOS_URL:
      'https://cardano-preview-v2.kupo-m1.dmtr.host,https://cardano-preview-v6.ogmios-m1.dmtr.host',
  };
  assert.throws(
    () => validateRemoteKupmiosAuth(environment),
    /IBC_SWAP_KUPO_API_KEY, IBC_SWAP_OGMIOS_API_KEY/,
  );
  assert.doesNotThrow(() =>
    validateRemoteKupmiosAuth({
      ...environment,
      IBC_SWAP_KUPO_API_KEY: 'kupo-key',
      IBC_SWAP_OGMIOS_API_KEY: 'ogmios-key',
    }),
  );
  assert.doesNotThrow(() =>
    validateRemoteKupmiosAuth({
      ...environment,
      IBC_SWAP_KUPMIOS_URL:
        'https://kupo1authenticated.cardano-preview-v2.kupo-m1.dmtr.host,https://ogmios1authenticated.cardano-preview-v6.ogmios-m1.dmtr.host',
    }),
  );
});

test('public runtime readiness requires a valid Kupo and Ogmios endpoint pair', () => {
  assert.throws(
    () =>
      validateRemoteKupmiosAuth({
        NEXT_PUBLIC_IBC_SWAP_MODE: 'preview',
      }),
    /requires IBC_SWAP_KUPMIOS/,
  );
  assert.throws(
    () =>
      validateRemoteKupmiosAuth({
        NEXT_PUBLIC_IBC_SWAP_MODE: 'preview',
        IBC_SWAP_KUPMIOS_URL: 'not-a-url',
      }),
    /exactly one Kupo URL and one Ogmios URL/,
  );
  assert.throws(
    () =>
      validateRemoteKupmiosAuth({
        NEXT_PUBLIC_IBC_SWAP_MODE: 'preview',
        IBC_SWAP_KUPMIOS_URL: 'not-a-url,https://ogmios.example.invalid',
      }),
    /invalid Kupo URL/,
  );
  assert.throws(
    () =>
      validateRemoteKupmiosAuth({
        NEXT_PUBLIC_IBC_SWAP_MODE: 'preview',
        IBC_SWAP_KUPMIOS_URL:
          'wss://kupo.example.invalid,https://ogmios.example.invalid',
      }),
    /invalid Kupo URL/,
  );
  assert.throws(
    () =>
      validateRemoteKupmiosAuth({
        NEXT_PUBLIC_IBC_SWAP_MODE: 'preview',
        IBC_SWAP_KUPMIOS_URL:
          'https://kupo.example.invalid,wss://ogmios.example.invalid',
      }),
    /invalid Ogmios URL/,
  );
});
