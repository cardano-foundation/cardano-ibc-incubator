import { ogmiosRequest } from './ogmios';
import { parseLedgerStateUtxo, queryLedgerStateUtxosAtAddresses } from './ogmios-utxo';

jest.mock('./ogmios', () => ({
  ogmiosRequest: jest.fn(),
}));

const mockedOgmiosRequest = jest.mocked(ogmiosRequest);

describe('Ogmios ledger-state UTxO recovery', () => {
  beforeEach(() => {
    mockedOgmiosRequest.mockReset();
  });

  it('preserves exact output references, inline datum, and native assets', () => {
    const policyId = 'ab'.repeat(28);
    expect(
      parseLedgerStateUtxo({
        transaction: { id: 'CD'.repeat(32) },
        index: 2,
        address: 'addr_test1session',
        value: {
          ada: { lovelace: 3_000_000 },
          [policyId.toUpperCase()]: { '0102': '1' },
        },
        datum: 'D87980',
      }),
    ).toEqual({
      txHash: 'cd'.repeat(32),
      outputIndex: 2,
      address: 'addr_test1session',
      assets: {
        lovelace: 3_000_000n,
        [policyId + '0102']: 1n,
      },
      datum: 'd87980',
    });
  });

  it('queries all addresses in one ledger-state snapshot and removes duplicate selectors', async () => {
    mockedOgmiosRequest.mockResolvedValue([]);

    await expect(
      queryLedgerStateUtxosAtAddresses('ws://ogmios.test', [
        'addr_test1session',
        'addr_test1wallet',
        'addr_test1session',
      ]),
    ).resolves.toEqual([]);

    expect(mockedOgmiosRequest).toHaveBeenCalledWith('ws://ogmios.test', 'queryLedgerState/utxo', {
      addresses: ['addr_test1session', 'addr_test1wallet'],
    });
  });

  it('fails closed on malformed ledger responses instead of treating them as absence', async () => {
    mockedOgmiosRequest.mockResolvedValue([
      {
        transaction: { id: 'ef'.repeat(32) },
        index: 0,
        address: 'addr_test1session',
        value: { ada: { lovelace: Number.MAX_SAFE_INTEGER + 1 } },
      },
    ]);

    await expect(queryLedgerStateUtxosAtAddresses('ws://ogmios.test', ['addr_test1session'])).rejects.toThrow(
      'invalid lovelace quantity',
    );
  });

  it('rejects a non-v6.13 datum object instead of guessing a PlutusData representation', () => {
    expect(() =>
      parseLedgerStateUtxo({
        transaction: { id: 'ef'.repeat(32) },
        index: 0,
        address: 'addr_test1session',
        value: { ada: { lovelace: 3_000_000 } },
        datum: { cbor: 'd87980' },
      }),
    ).toThrow('invalid inline datum');
  });
});
