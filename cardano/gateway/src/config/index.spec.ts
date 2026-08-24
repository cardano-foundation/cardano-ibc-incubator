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
