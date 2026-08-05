import loadConfig from './index';

describe('Cardano network defaults', () => {
  const originalNetworkMagic = process.env.CARDANO_NETWORK_MAGIC;
  const originalEpochLength = process.env.CARDANO_EPOCH_LENGTH;

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
});
