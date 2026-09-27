import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVoucherUserTokenNameFromFullDenom } from '@cardano-ibc/trace-registry';
import type { SwapDataType } from '../types/SwapDataType';
import { swapRequestKey } from './token';

const trace = 'transfer/channel-0/uatom';
const swap: SwapDataType = {
  fromToken: {
    tokenId: 'ab'.repeat(28) + buildVoucherUserTokenNameFromFullDenom(trace),
    tokenTrace: trace,
    cardanoAssetStatus: 'verified-voucher',
    tokenName: trace,
    tokenSymbol: 'ATOM',
    tokenLogo: '',
    tokenExponent: 6,
    balance: '10000000',
    swapAmount: '1',
    network: { networkId: 'cardano', ibcChainId: 'cardano-42' },
  },
  toToken: {
    tokenId: 'uosmo',
    tokenName: 'Osmosis',
    tokenLogo: '',
    network: { networkId: 'osmosis-local' },
  },
  slippageTolerance: '1',
};

test('prepared swap identity changes with asset, amount, route, receiver and slippage', () => {
  const original = swapRequestKey(swap, 'sender', 'receiver');
  assert.ok(original);
  const otherTrace = 'transfer/channel-1/uatom';
  const variants: SwapDataType[] = [
    {
      ...swap,
      fromToken: {
        ...swap.fromToken,
        tokenTrace: otherTrace,
        tokenId:
          'ab'.repeat(28) + buildVoucherUserTokenNameFromFullDenom(otherTrace),
      },
    },
    { ...swap, fromToken: { ...swap.fromToken, swapAmount: '2' } },
    { ...swap, toToken: { ...swap.toToken, tokenId: 'uatom' } },
    { ...swap, toToken: { ...swap.toToken, network: { networkId: 'other' } } },
    { ...swap, slippageTolerance: '5' },
  ];
  variants.forEach((variant) =>
    assert.notEqual(swapRequestKey(variant, 'sender', 'receiver'), original),
  );
  assert.notEqual(swapRequestKey(swap, 'other sender', 'receiver'), original);
  assert.notEqual(swapRequestKey(swap, 'sender', 'other receiver'), original);
});

test('unresolved or unavailable assets invalidate prepared swaps in either direction', () => {
  assert.equal(
    swapRequestKey(
      {
        ...swap,
        fromToken: {
          ...swap.fromToken,
          cardanoAssetStatus: 'unresolved-voucher',
        },
      },
      'sender',
      'receiver',
    ),
    undefined,
  );
  assert.equal(
    swapRequestKey(
      {
        ...swap,
        fromToken: {
          ...swap.fromToken,
          tokenDisabledReason: 'Verification unavailable',
        },
      },
      'sender',
      'receiver',
    ),
    undefined,
  );
  assert.equal(
    swapRequestKey(
      { ...swap, toToken: { ...swap.fromToken, tokenTrace: undefined } },
      'sender',
      'receiver',
    ),
    undefined,
  );
  assert.equal(swapRequestKey(swap, 'sender', ''), undefined);
});

test('decorative metadata and output estimate updates do not change swap identity', () => {
  assert.equal(
    swapRequestKey(
      {
        ...swap,
        fromToken: {
          ...swap.fromToken,
          tokenSymbol: 'OTHER',
          tokenDisplayName: 'Untrusted display name',
        },
        toToken: { ...swap.toToken, swapAmount: '99' },
      },
      'sender',
      'receiver',
    ),
    swapRequestKey(swap, 'sender', 'receiver'),
  );
});
