import assert from 'node:assert/strict';
import test from 'node:test';
import type { TokenPresentation } from '../types/token';
import { tokenAmount } from './token';

const ada: TokenPresentation = {
  tokenId: 'lovelace',
  tokenExponent: 6,
  balance: '2000000',
  cardanoAssetStatus: 'native',
};

test('transfer amounts use base units and respect the wallet balance', () => {
  assert.deepEqual(tokenAmount(ada, '1.25'), {
    denom: 'lovelace',
    amount: '1250000',
  });
  assert.deepEqual(tokenAmount(ada, '2'), {
    denom: 'lovelace',
    amount: '2000000',
  });
  ['0', '-1', '2.000001', '1.0000001', 'invalid'].forEach((amount) => {
    assert.equal(tokenAmount(ada, amount), null);
  });
});

test('Injective amounts retain all eighteen decimal places', () => {
  assert.deepEqual(
    tokenAmount({ tokenId: 'inj', tokenExponent: 18 }, '1.000000000000000001'),
    { denom: 'inj', amount: '1000000000000000001' },
  );
});

test('unresolved or unavailable assets cannot produce a transfer amount', () => {
  assert.equal(
    tokenAmount({ ...ada, cardanoAssetStatus: 'unresolved-voucher' }, '1'),
    null,
  );
  assert.equal(
    tokenAmount(
      { ...ada, tokenDisabledReason: 'Verification unavailable' },
      '1',
    ),
    null,
  );
  assert.equal(tokenAmount({ ...ada, tokenId: undefined }, '1'), null);
});
