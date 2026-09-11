import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findUtxosAtAllowEmpty, UtxosAtAddressNotFoundError } from './lucidIbcAdapter';

describe('runtime empty-address reads', () => {
  it('returns no records when a fresh address has no UTxOs', async () => {
    const lucidService = {
      findUtxoAt: async () => {
        throw new UtxosAtAddressNotFoundError('addr_test1history');
      },
    };

    assert.deepEqual(await findUtxosAtAllowEmpty(lucidService, 'addr_test1history'), []);
  });

  it('does not hide provider failures', async () => {
    const providerFailure = new Error('provider unavailable');
    const lucidService = { findUtxoAt: async () => Promise.reject(providerFailure) };

    await assert.rejects(
      findUtxosAtAllowEmpty(lucidService, 'addr_test1history'),
      (error) => error === providerFailure,
    );
  });
});
