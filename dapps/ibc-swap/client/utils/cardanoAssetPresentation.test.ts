import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildVoucherUserTokenNameFromFullDenom,
  buildVoucherReferenceTokenNameFromFullDenom,
  type CardanoAssetDenomTrace,
} from '@cardano-ibc/trace-registry';
import {
  cardanoTokenOption,
  resolveCardanoWalletAssets,
  tokenPrimaryLabel,
  tokenSecondaryLabel,
  tokenTransferDisabledReason,
  tokenUsesBaseUnits,
} from './cardanoAssetPresentation';
import { tokenAmount } from './token';
import { baseAmountToDisplayAmount, formatPrice } from './string';

const policy = 'ab'.repeat(28);
const fullDenom = 'transfer/channel-0/uatom';
const voucherTokenName = buildVoucherUserTokenNameFromFullDenom(fullDenom);
const unit = policy + voucherTokenName;
const walletAsset = { unit, quantity: '123456789' };
const trace: CardanoAssetDenomTrace = {
  assetId: unit,
  kind: 'ibc_voucher',
  path: 'transfer/channel-0',
  baseDenom: 'uatom',
  fullDenom,
  voucherTokenName,
  voucherPolicyId: policy,
  ibcDenomHash: null,
  displayName: 'Cosmos Hub Atom',
  displaySymbol: 'ATOM',
  displayDescription: 'Atom bridged through channel-0',
  decimals: 6,
  logo: 'https://example.test/atom.png',
};

test('uses verified fields while preserving wallet identity and integer balances', async () => {
  const [asset] = await resolveCardanoWalletAssets(
    [walletAsset],
    async (id) => {
      assert.equal(id, unit);
      return trace;
    },
  );
  assert.deepEqual(cardanoTokenOption(asset, '/cardano.svg'), {
    tokenId: unit,
    tokenName: fullDenom,
    tokenTrace: fullDenom,
    tokenDisplayName: 'Cosmos Hub Atom',
    cardanoAssetStatus: 'verified-voucher',
    tokenDisabledReason: undefined,
    tokenSymbol: 'ATOM',
    tokenDescription: trace.displayDescription,
    tokenLogo: trace.logo,
    tokenExponent: 6,
    balance: '123456789',
  });
  assert.equal(
    baseAmountToDisplayAmount(asset.quantity, asset.tokenExponent!),
    '123.456789',
  );
  assert.deepEqual(tokenAmount(asset, '1.234567'), {
    denom: unit,
    amount: '1234567',
  });
});

test('missing or incomplete optional metadata uses denomination-trace presentation', async () => {
  const [asset] = await resolveCardanoWalletAssets([walletAsset], async () => ({
    ...trace,
    displayName: '',
    displaySymbol: '',
    displayDescription: '',
    decimals: null,
    logo: null,
  }));
  assert.equal(asset.tokenName, fullDenom);
  assert.equal(asset.tokenSymbol, undefined);
  assert.equal(asset.tokenDescription, `IBC voucher for ${fullDenom}`);
  assert.equal(asset.tokenExponent, undefined);
  assert.equal(
    cardanoTokenOption(asset, '/cardano.svg').tokenLogo,
    '/cardano.svg',
  );
});

test('malformed optional metadata cannot introduce control characters or invalid decimals', async () => {
  await Promise.all(
    [-1, 1.5, 256, Number.NaN, '6'].map(async (decimals) => {
      const [asset] = await resolveCardanoWalletAssets(
        [walletAsset],
        async () =>
          ({
            ...trace,
            displayName: '\u0000bad',
            displaySymbol: '\ufffd',
            displayDescription: '\u202eevil',
            decimals,
            // eslint-disable-next-line no-script-url -- intentionally malformed metadata
            logo: 'javascript:alert(1)',
          } as CardanoAssetDenomTrace),
      );
      assert.equal(asset.tokenName, fullDenom);
      assert.equal(asset.tokenSymbol, undefined);
      assert.equal(asset.tokenDescription, `IBC voucher for ${fullDenom}`);
      assert.equal(asset.tokenExponent, undefined);
      assert.equal(asset.tokenLogo, undefined);
    }),
  );
});

test('supports an IPFS logo returned by verified metadata', async () => {
  const [asset] = await resolveCardanoWalletAssets([walletAsset], async () => ({
    ...trace,
    logo: 'ipfs://bafyexample/atom.png',
  }));
  assert.equal(asset.tokenLogo, 'https://ipfs.io/ipfs/bafyexample/atom.png');
});

test('unresolved vouchers show the full asset ID and cannot enter a transaction', async () => {
  const responses = [
    null,
    { ...trace, kind: 'native' },
    { ...trace, assetId: 'cd'.repeat(28) + voucherTokenName },
    { ...trace, voucherPolicyId: 'cd'.repeat(28) },
    { ...trace, voucherTokenName: '00' },
    { ...trace, fullDenom: '\u0000' },
    { ...trace, fullDenom: 'transfer/channel-1/uatom' },
    { ...trace, path: 'transfer/channel-1' },
    { ...trace, baseDenom: 'ueth' },
    { ...trace, displayName: { malicious: 'object' } },
  ];
  await Promise.all(
    responses.slice(0, -1).map(async (response) => {
      const [asset] = await resolveCardanoWalletAssets(
        [walletAsset],
        async () => response as CardanoAssetDenomTrace | null,
      );
      assert.equal(tokenPrimaryLabel(asset), `Unresolved voucher · ${unit}`);
      assert.ok(tokenTransferDisabledReason(asset));
      assert.equal(tokenAmount(asset, '1'), null);
      assert.equal(asset.unit, unit);
    }),
  );
  const [failed] = await resolveCardanoWalletAssets([walletAsset], async () => {
    throw new Error('offline');
  });
  assert.equal(tokenPrimaryLabel(failed), `Unresolved voucher · ${unit}`);
  assert.equal(tokenAmount(failed, '1'), null);
  const [badName] = await resolveCardanoWalletAssets(
    [walletAsset],
    async () => responses.at(-1) as CardanoAssetDenomTrace,
  );
  assert.equal(badName.tokenName, fullDenom);
});

test('ordinary assets, malformed names and ADA never need a voucher lookup', async () => {
  const assets = [
    { unit: `${policy}544f4b454e`, quantity: '42' },
    { unit: `${policy}00ff`, quantity: '1' },
    { unit: `${policy}0014df10`, quantity: '1' },
    { unit: 'broken\u0000\ufffdasset', quantity: '1' },
    { unit: 'lovelace', quantity: '2500000' },
  ];
  const resolved = await resolveCardanoWalletAssets(assets, async () =>
    assert.fail('unexpected lookup'),
  );
  resolved.forEach((asset, index) => {
    assert.doesNotMatch(asset.tokenName!, /[\p{Cc}\p{Cf}\ufffd]/u);
    assert.equal(asset.unit, assets[index].unit);
  });
  const ada = resolved.at(-1)!;
  assert.equal(ada.tokenName, 'ADA');
  assert.equal(ada.tokenSymbol, 'ADA');
  assert.equal(ada.tokenExponent, 6);
  assert.equal(
    baseAmountToDisplayAmount(ada.quantity, ada.tokenExponent!),
    '2.5',
  );
  assert.deepEqual(tokenAmount(ada, '1.25'), {
    denom: 'lovelace',
    amount: '1250000',
  });
});

test('reference NFTs are excluded before metadata lookup', async () => {
  const assets = await resolveCardanoWalletAssets(
    [
      {
        unit: policy + buildVoucherReferenceTokenNameFromFullDenom(fullDenom),
        quantity: '1',
      },
      { unit: 'lovelace', quantity: '1' },
    ],
    async () => assert.fail('reference token queried as a voucher'),
  );
  assert.deepEqual(
    assets.map((asset) => asset.unit),
    ['lovelace'],
  );
});

test('duplicate symbols retain separate balances, selections and transaction denominations', async () => {
  const secondName = buildVoucherUserTokenNameFromFullDenom(
    'transfer/channel-1/uatom',
  );
  const secondUnit = policy + secondName;
  const assets = await resolveCardanoWalletAssets(
    [walletAsset, { unit: secondUnit, quantity: '9999999' }],
    async (id) => ({
      ...trace,
      assetId: id,
      voucherTokenName: id === unit ? voucherTokenName : secondName,
      fullDenom: id === unit ? fullDenom : 'transfer/channel-1/uatom',
      path: id === unit ? trace.path : 'transfer/channel-1',
    }),
  );
  const options = assets.map((asset) =>
    cardanoTokenOption(asset, '/cardano.svg'),
  );
  assert.deepEqual(
    options.map((asset) => asset.tokenSymbol),
    ['ATOM', 'ATOM'],
  );
  assert.deepEqual(
    options.map((asset) => asset.tokenId),
    [unit, secondUnit],
  );
  assert.deepEqual(
    options.map((asset) => asset.balance),
    ['123456789', '9999999'],
  );
  assert.deepEqual(options.map(tokenPrimaryLabel), [
    fullDenom,
    'transfer/channel-1/uatom',
  ]);
  assert.equal(tokenAmount(options[0], '1')?.denom, unit);
  assert.equal(tokenAmount(options[1], '1')?.denom, secondUnit);
});

test('amount conversion stays exact and rejects invalid or unaffordable input', () => {
  const token = {
    tokenId: unit,
    tokenTrace: fullDenom,
    cardanoAssetStatus: 'verified-voucher' as const,
    tokenExponent: 6,
    balance: '900719925474099312345678',
  };
  assert.deepEqual(tokenAmount(token, '900719925474099312.345678'), {
    denom: unit,
    amount: '900719925474099312345678',
  });
  ['0', '-1', '1.0000001', 'NaN', '1e6', '900719925474099312.345679'].forEach(
    (amount) => {
      assert.equal(tokenAmount(token, amount), null);
    },
  );
  assert.equal(formatPrice('1234567.123456'), '1,234,567.123456');
});

test('a foreign-policy token identified as native never inherits voucher names', async () => {
  const [asset] = await resolveCardanoWalletAssets([walletAsset], async () => ({
    ...trace,
    kind: 'native',
    fullDenom: unit,
  }));
  assert.equal(asset.cardanoAssetStatus, 'native');
  assert.equal(tokenPrimaryLabel(asset), unit);
  assert.deepEqual(tokenAmount(asset, '1'), { denom: unit, amount: '1' });
});

test('persisted names and forged traces cannot bypass unresolved voucher blocking', () => {
  const legacy = {
    tokenId: unit,
    tokenName: 'ATOM',
    tokenSymbol: 'ATOM',
    balance: '10',
  };
  const forged = {
    ...legacy,
    cardanoAssetStatus: 'verified-voucher' as const,
    tokenTrace: 'transfer/channel-999/uatom',
  };
  [legacy, forged].forEach((token) => {
    assert.equal(tokenPrimaryLabel(token), `Unresolved voucher · ${unit}`);
    assert.equal(tokenAmount(token, '1'), null);
    assert.equal(tokenSecondaryLabel(token), '');
  });
});

test('reference NFTs cannot bypass the transaction guard', () => {
  const tokenId =
    policy + buildVoucherReferenceTokenNameFromFullDenom(fullDenom);
  assert.equal(
    tokenAmount({ tokenId, cardanoAssetStatus: 'native' }, '1'),
    null,
  );
});

test('unknown decimals are explicitly base units while verified zero decimals are known', async () => {
  const [unknown] = await resolveCardanoWalletAssets(
    [walletAsset],
    async () => ({ ...trace, decimals: null }),
  );
  const [zero] = await resolveCardanoWalletAssets([walletAsset], async () => ({
    ...trace,
    decimals: 0,
  }));
  assert.equal(tokenUsesBaseUnits(unknown), true);
  assert.equal(tokenUsesBaseUnits(zero), false);
  assert.deepEqual(tokenAmount(unknown, '42'), { denom: unit, amount: '42' });
  assert.equal(tokenAmount(unknown, '0.5'), null);
  assert.equal(
    tokenAmount(
      { ...unknown, tokenDisabledReason: 'Wallet verification pending' },
      '1',
    ),
    null,
  );
});
