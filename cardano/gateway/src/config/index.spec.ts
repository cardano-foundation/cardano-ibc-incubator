import loadConfig from './index';

describe('Cardano network defaults', () => {
  const originalNetworkMagic = process.env.CARDANO_NETWORK_MAGIC;
  const originalEpochLength = process.env.CARDANO_EPOCH_LENGTH;
  const originalMaxClockDrift = process.env.CARDANO_CLIENT_MAX_CLOCK_DRIFT_SECONDS;

  afterEach(() => {
    if (originalNetworkMagic === undefined) {
      delete process.env.CARDANO_NETWORK_MAGIC;
    } else {
      process.env.CARDANO_NETWORK_MAGIC = originalNetworkMagic;
    }
    if (originalEpochLength === undefined) {
      delete process.env.CARDANO_EPOCH_LENGTH;
    } else {
      process.env.CARDANO_EPOCH_LENGTH = originalEpochLength;
    }
    if (originalMaxClockDrift === undefined) {
      delete process.env.CARDANO_CLIENT_MAX_CLOCK_DRIFT_SECONDS;
    } else {
      process.env.CARDANO_CLIENT_MAX_CLOCK_DRIFT_SECONDS = originalMaxClockDrift;
    }
  });

  it('uses the Preview genesis epoch length for network magic 2', () => {
    process.env.CARDANO_NETWORK_MAGIC = '2';
    delete process.env.CARDANO_EPOCH_LENGTH;

    expect(loadConfig().cardanoEpochLength).toBe(86_400);
  });

  it('keeps an explicit epoch length override', () => {
    process.env.CARDANO_NETWORK_MAGIC = '2';
    process.env.CARDANO_EPOCH_LENGTH = '12345';

    expect(loadConfig().cardanoEpochLength).toBe(12_345);
  });

  it('uses a ten-second client clock drift by default', () => {
    delete process.env.CARDANO_CLIENT_MAX_CLOCK_DRIFT_SECONDS;

    expect(loadConfig().cardanoClientMaxClockDriftSeconds).toBe(10);
  });

  it('keeps an explicit client clock drift override', () => {
    process.env.CARDANO_CLIENT_MAX_CLOCK_DRIFT_SECONDS = '17';

    expect(loadConfig().cardanoClientMaxClockDriftSeconds).toBe(17);
  });

  it.each(['0', '-1', '1.5', 'not-a-number', '9007199254740992'])(
    'rejects invalid client clock drift %s',
    (value) => {
      process.env.CARDANO_CLIENT_MAX_CLOCK_DRIFT_SECONDS = value;

      expect(() => loadConfig()).toThrow(
        'CARDANO_CLIENT_MAX_CLOCK_DRIFT_SECONDS must be a positive safe integer',
      );
    },
  );

  it('rejects a client clock drift too large for the Go light client', () => {
    process.env.CARDANO_CLIENT_MAX_CLOCK_DRIFT_SECONDS = '9223372037';

    expect(() => loadConfig()).toThrow(
      'CARDANO_CLIENT_MAX_CLOCK_DRIFT_SECONDS must not exceed 9223372036 seconds',
    );
  });
});

describe('Public network stability configuration', () => {
  const originalEnv = process.env;
  const endpoint = 'https://koios.example/api/v1';

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const name of [
      'CARDANO_NETWORK_MAGIC',
      'CARDANO_LIGHT_CLIENT_MODE',
      'CARDANO_EPOCH_PARAMS_ENDPOINT',
      'CARDANO_STABILITY_ASSUME_STATIC_STAKE',
      'CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT',
      'CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE',
      'CARDANO_EPOCH_NONCE_GENESIS',
    ]) {
      delete process.env[name];
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it.each([undefined, '', '   ', '///'])('requires a usable Mainnet snapshot endpoint: %p', (value) => {
    process.env.CARDANO_NETWORK_MAGIC = '764824073';
    if (value !== undefined) process.env.CARDANO_EPOCH_PARAMS_ENDPOINT = value;

    expect(() => loadConfig()).toThrow(
      'CARDANO_EPOCH_PARAMS_ENDPOINT is required for stake-weighted-stability on Mainnet',
    );
  });

  describe.each([
    ['Mainnet', '764824073'],
    ['Preprod', '1'],
    ['Preview', '2'],
  ])('%s', (network, magic) => {
    beforeEach(() => {
      process.env.CARDANO_NETWORK_MAGIC = magic;
      process.env.CARDANO_EPOCH_PARAMS_ENDPOINT = endpoint;
    });

    it.each([
      ['CARDANO_STABILITY_ASSUME_STATIC_STAKE', '1'],
      ['CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT', '0'],
      ['CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT', ''],
      ['CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE', '11'.repeat(32)],
    ])('rejects the development override %s=%p', (name, value) => {
      process.env[name] = value;

      expect(() => loadConfig()).toThrow(`${name} must be unset on ${network}`);
    });

    it('accepts the snapshot endpoint with static stake disabled', () => {
      process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE = '0';
      // Public deployments can retain the genesis value without enabling a nonce fallback.
      process.env.CARDANO_EPOCH_NONCE_GENESIS = '22'.repeat(32);

      expect(loadConfig()).toMatchObject({
        cardanoNetwork: network,
        cardanoLightClientMode: 'stake-weighted-stability',
        cardanoEpochParamsEndpoint: endpoint,
      });
    });
  });

  it('does not require a stake snapshot endpoint in Mithril mode', () => {
    process.env.CARDANO_NETWORK_MAGIC = '764824073';
    process.env.CARDANO_LIGHT_CLIENT_MODE = 'mithril';

    expect(loadConfig().cardanoLightClientMode).toBe('mithril');
  });

  it('keeps the explicit local devnet assumptions available', () => {
    process.env.CARDANO_NETWORK_MAGIC = '42';
    process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE = '1';
    process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT = '1';
    process.env.CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE = '11'.repeat(32);

    expect(loadConfig()).toMatchObject({
      cardanoNetwork: 'Custom',
      cardanoLightClientMode: 'stake-weighted-stability',
      cardanoEpochParamsEndpoint: undefined,
    });
  });
});
