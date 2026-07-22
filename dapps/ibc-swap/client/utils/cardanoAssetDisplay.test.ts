import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getCip67AssetKind,
  getFallbackCardanoAssetName,
  resolveCardanoAssetPresentation,
  type CardanoAssetDisplayTrace,
} from './cardanoAssetDisplay';

const POLICY_ID = 'ab'.repeat(28);
const VOUCHER_HASH = 'cd'.repeat(28);
const FT_ASSET_ID = `${POLICY_ID}0014df10${VOUCHER_HASH}`;
const REFERENCE_ASSET_ID = `${POLICY_ID}000643b0${VOUCHER_HASH}`;

describe('Cardano asset display', () => {
  it('recognizes the CIP-67 labels used by CIP-68 fungible tokens', () => {
    assert.equal(getCip67AssetKind(FT_ASSET_ID), 'ft');
    assert.equal(getCip67AssetKind(REFERENCE_ASSET_ID), 'reference_nft');
    assert.equal(getCip67AssetKind(FT_ASSET_ID.toUpperCase()), 'ft');
    assert.equal(getCip67AssetKind(`${POLICY_ID}746f6b656e`), null);
    assert.equal(getCip67AssetKind(`${POLICY_ID}0014df10abcd`), null);
    assert.equal(
      getCip67AssetKind(`${POLICY_ID}0014df10${'zz'.repeat(28)}`),
      null,
    );
  });

  it('uses readable local fallbacks without decoding binary labels as text', () => {
    assert.equal(getFallbackCardanoAssetName('lovelace'), 'lovelace');
    assert.equal(
      getFallbackCardanoAssetName(`${POLICY_ID}546f6b656e`),
      'Token',
    );
    assert.equal(
      getFallbackCardanoAssetName(FT_ASSET_ID),
      `CIP-68 FT ${VOUCHER_HASH}`,
    );
    assert.equal(getFallbackCardanoAssetName(`${POLICY_ID}fffe`), 'fffe');
  });

  it('does not query trace metadata for unlabeled native assets', async () => {
    let lookupCount = 0;
    const presentation = await resolveCardanoAssetPresentation(
      `${POLICY_ID}546f6b656e`,
      async () => {
        lookupCount += 1;
        return null;
      },
    );

    assert.equal(lookupCount, 0);
    assert.deepEqual(presentation, {
      assetName: 'Token',
      assetSymbol: `${POLICY_ID}546f6b656e`,
      tokenExponent: 0,
    });
  });

  it('renders a labeled IBC voucher from resolved CIP-68 metadata', async () => {
    const trace: CardanoAssetDisplayTrace = {
      kind: 'ibc_voucher',
      displayName: 'Cosmos Hub Atom',
      displaySymbol: 'ATOM',
      decimals: null,
      logo: 'https://example.com/atom.svg',
    };

    const presentation = await resolveCardanoAssetPresentation(
      FT_ASSET_ID,
      async () => trace,
    );

    assert.deepEqual(presentation, {
      assetName: 'Cosmos Hub Atom',
      assetSymbol: 'ATOM',
      tokenExponent: 0,
      tokenLogo: 'https://example.com/atom.svg',
    });
  });

  it('keeps base-unit semantics when optional decimal metadata is present', async () => {
    const presentation = await resolveCardanoAssetPresentation(
      FT_ASSET_ID,
      async () => ({
        kind: 'ibc_voucher',
        displayName: 'Cosmos Hub Atom',
        displaySymbol: 'ATOM',
        decimals: 6,
      }),
    );

    assert.equal(presentation?.tokenExponent, 0);
  });

  it('filters the paired IBC reference NFT after confirming its policy', async () => {
    let lookupCount = 0;
    const presentation = await resolveCardanoAssetPresentation(
      REFERENCE_ASSET_ID,
      async () => {
        lookupCount += 1;
        return {
          kind: 'ibc_voucher',
          displayName: 'Cosmos Hub Atom reference',
          displaySymbol: 'ATOM-REF',
        };
      },
    );

    assert.equal(lookupCount, 1);
    assert.equal(presentation, null);
  });

  it('keeps a label-100 asset from another policy selectable', async () => {
    const presentation = await resolveCardanoAssetPresentation(
      REFERENCE_ASSET_ID,
      async () => ({
        kind: 'native',
        displayName: REFERENCE_ASSET_ID,
        displaySymbol: REFERENCE_ASSET_ID,
      }),
    );

    assert.deepEqual(presentation, {
      assetName: `CIP-68 reference ${VOUCHER_HASH}`,
      assetSymbol: REFERENCE_ASSET_ID,
      tokenExponent: 0,
    });
  });

  it('fails closed when a labeled asset cannot be classified', async () => {
    const presentation = await resolveCardanoAssetPresentation(
      FT_ASSET_ID,
      async () => null,
    );

    assert.equal(presentation, null);
  });

  it('fails closed when resolved voucher display fields are blank', async () => {
    const presentation = await resolveCardanoAssetPresentation(
      FT_ASSET_ID,
      async () => ({
        kind: 'ibc_voucher',
        displayName: ' ',
        displaySymbol: 'ATOM',
      }),
    );

    assert.equal(presentation, null);
  });

  it('omits a whitespace-only voucher logo', async () => {
    const presentation = await resolveCardanoAssetPresentation(
      FT_ASSET_ID,
      async () => ({
        kind: 'ibc_voucher',
        displayName: 'Cosmos Hub Atom',
        displaySymbol: 'ATOM',
        logo: '  ',
      }),
    );

    assert.deepEqual(presentation, {
      assetName: 'Cosmos Hub Atom',
      assetSymbol: 'ATOM',
      tokenExponent: 0,
    });
  });

  it('keeps a labeled asset from another policy on the native fallback path', async () => {
    const presentation = await resolveCardanoAssetPresentation(
      FT_ASSET_ID,
      async () => ({
        kind: 'native',
        displayName: FT_ASSET_ID,
        displaySymbol: FT_ASSET_ID,
      }),
    );

    assert.deepEqual(presentation, {
      assetName: `CIP-68 FT ${VOUCHER_HASH}`,
      assetSymbol: FT_ASSET_ID,
      tokenExponent: 0,
    });
  });
});
