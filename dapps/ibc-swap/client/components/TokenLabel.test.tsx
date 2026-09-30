/* eslint-disable react/jsx-no-constructed-context-values -- Each test renders a static tree once. */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildVoucherUserTokenNameFromFullDenom } from '@cardano-ibc/trace-registry';
import { TokenAmountUnit, TokenLabel } from './TokenLabel';
import { TransferTokenItem } from './TransferTokenItem/TransferTokenItem';
import SelectToken from '../containers/Transfer/SelectToken';
import TransferContext from '../contexts/TransferContext';

const fullDenom = 'transfer/channel-0/uatom';
const token = {
  tokenId: 'ab'.repeat(28) + buildVoucherUserTokenNameFromFullDenom(fullDenom),
  tokenTrace: fullDenom,
  cardanoAssetStatus: 'verified-voucher' as const,
  tokenDisplayName: 'Cosmos Hub Atom',
  tokenName: 'Cosmos Hub Atom',
  tokenSymbol: 'ATOM',
  tokenDescription: 'Bridged Atom',
  tokenExponent: 6,
  tokenLogo: 'https://example.test/atom.png',
  balance: '1234567',
};

const transferContextValue = {
  selectedToken: token,
  fromNetwork: { networkId: '42' },
  toNetwork: { networkId: 'cosmos' },
  sendAmount: '0.5',
  isProcessingTransfer: false,
  setSendAmount: () => {},
} as unknown as React.ContextType<typeof TransferContext>;

test('shared summary and result labels show the literal trace ahead of metadata', () => {
  const html = renderToStaticMarkup(<TokenLabel token={token} />);
  assert.match(html, />transfer\/channel-0\/uatom<\/span>/);
  assert.ok(html.includes(token.tokenId));
  assert.ok(html.includes(token.tokenName));
  assert.ok(html.includes(token.tokenDescription));
});

test('transfer list renders the verified name, logo, symbol and decimal balance', () => {
  const html = renderToStaticMarkup(<TransferTokenItem {...token} />);
  [
    'Cosmos Hub Atom',
    'ATOM',
    '1.234567',
    token.tokenLogo,
    token.tokenId,
  ].forEach((text) => {
    assert.ok(html.includes(text), text);
  });
});

test('selected transfer summary uses the literal trace and decimal balance', () => {
  const html = renderToStaticMarkup(
    <TransferContext.Provider value={transferContextValue}>
      <SelectToken onOpenTokenModal={() => {}} />
    </TransferContext.Provider>,
  );
  [fullDenom, '1.234567', '0.5', token.tokenId].forEach((text) => {
    assert.ok(html.includes(text), text);
  });
});

test('equal display symbols remain distinguishable by full identity', () => {
  const other = {
    ...token,
    tokenTrace: 'transfer/channel-1/uatom',
    tokenId:
      'ab'.repeat(28) +
      buildVoucherUserTokenNameFromFullDenom('transfer/channel-1/uatom'),
  };
  const firstHtml = renderToStaticMarkup(<TokenLabel token={token} />);
  const secondHtml = renderToStaticMarkup(<TokenLabel token={other} />);
  assert.ok(firstHtml.includes(token.tokenId));
  assert.ok(secondHtml.includes(other.tokenId));
  assert.match(firstHtml, />transfer\/channel-0\/uatom<\/span>/);
  assert.match(secondHtml, />transfer\/channel-1\/uatom<\/span>/);
  assert.notEqual(firstHtml, secondHtml);
});

test('legacy resumed transfer labels cannot render decoded binary names', () => {
  const html = renderToStaticMarkup(
    <TokenLabel
      token={{
        ...token,
        cardanoAssetStatus: undefined,
        tokenTrace: undefined,
        tokenName: '\u0000\ufffd',
        tokenSymbol: '\u0014\ufffd',
      }}
    />,
  );
  ['\u0000', '\u0014', '\ufffd'].forEach((character) => {
    assert.ok(!html.includes(character));
  });
  assert.ok(html.includes(`Unresolved voucher · ${token.tokenId}`));
});

test('unresolved vouchers remain visible but rows and amount inputs are disabled', () => {
  const unresolved = {
    ...token,
    cardanoAssetStatus: 'unresolved-voucher' as const,
    tokenTrace: undefined,
  };
  const row = renderToStaticMarkup(<TransferTokenItem {...unresolved} />);
  assert.ok(row.includes(`Unresolved voucher · ${token.tokenId}`));
  assert.match(row, /aria-disabled="true"/);
  const context = { ...transferContextValue, selectedToken: unresolved };
  const form = renderToStaticMarkup(
    <TransferContext.Provider value={context}>
      <SelectToken onOpenTokenModal={() => {}} />
    </TransferContext.Provider>,
  );
  assert.match(form, /<input[^>]*disabled=""/);
});

test('amounts without verified decimals visibly identify base units', () => {
  const unknownDecimals = { ...token, tokenExponent: undefined };
  assert.equal(
    renderToStaticMarkup(<TokenAmountUnit token={unknownDecimals} />),
    ' base units',
  );
  const row = renderToStaticMarkup(<TransferTokenItem {...unknownDecimals} />);
  assert.ok(row.includes('1,234,567'));
  assert.ok(row.includes('base units'));
  const context = { ...transferContextValue, selectedToken: unknownDecimals };
  const form = renderToStaticMarkup(
    <TransferContext.Provider value={context}>
      <SelectToken onOpenTokenModal={() => {}} />
    </TransferContext.Provider>,
  );
  assert.match(form, /aria-label="Amount in base units"/);
});
