import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TokenLabel } from './TokenLabel';
import { TransferTokenItem } from './TransferTokenItem/TransferTokenItem';
import SelectToken from '../containers/Transfer/SelectToken';
import TransferContext from '../contexts/TransferContext';

const token = {
  tokenId: `${'ab'.repeat(28)}0014df10${'cd'.repeat(28)}`,
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
} as React.ContextType<typeof TransferContext>;

test('shared summary and result labels show the symbol with full identity and description', () => {
  const html = renderToStaticMarkup(<TokenLabel token={token} />);
  assert.match(html, />ATOM<\/span>/);
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

test('selected transfer summary uses the same symbol and decimal balance', () => {
  const html = renderToStaticMarkup(
    <TransferContext.Provider value={transferContextValue}>
      <SelectToken onOpenTokenModal={() => {}} />
    </TransferContext.Provider>,
  );
  ['ATOM', '1.234567', '0.5', token.tokenId].forEach((text) => {
    assert.ok(html.includes(text), text);
  });
});

test('equal display symbols remain distinguishable by full identity', () => {
  const other = {
    ...token,
    tokenId: 'ef'.repeat(28) + token.tokenId.slice(56),
  };
  const firstHtml = renderToStaticMarkup(<TokenLabel token={token} />);
  const secondHtml = renderToStaticMarkup(<TokenLabel token={other} />);
  assert.ok(firstHtml.includes(token.tokenId));
  assert.ok(secondHtml.includes(other.tokenId));
  assert.notEqual(firstHtml, secondHtml);
});

test('legacy resumed transfer labels cannot render decoded binary names', () => {
  const html = renderToStaticMarkup(
    <TokenLabel
      token={{
        ...token,
        tokenName: '\u0000\ufffd',
        tokenSymbol: '\u0014\ufffd',
      }}
    />,
  );
  ['\u0000', '\u0014', '\ufffd'].forEach((character) => {
    assert.ok(!html.includes(character));
  });
  assert.ok(
    html.includes(`${token.tokenId.slice(0, 12)}...${token.tokenId.slice(-8)}`),
  );
});
