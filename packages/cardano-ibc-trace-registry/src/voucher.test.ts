import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertUniqueTraceRegistryEntries,
  buildIbcDenomHashFromFullDenom,
  buildVoucherAssetId,
  buildVoucherCip68Metadata,
  buildVoucherDenomHashFromFullDenom,
  buildVoucherReferenceTokenNameFromDenomHash,
  buildVoucherUserTokenNameFromDenomHash,
  CIP67_FT_LABEL_HEX,
  CIP67_REFERENCE_NFT_LABEL_HEX,
  decodeVerifiedVoucherCip68MetadataDatum,
  decodeVoucherCip68MetadataDatum,
  deriveVoucherCanonicalLabel,
  deriveVoucherPresentation,
  encodeVoucherCip68MetadataDatum,
  expectVoucherAssetName,
  LABELED_VOUCHER_TOKEN_NAME_HEX_LENGTH,
  findVoucherPolicy,
  getActiveVoucherPolicyId,
  listOperationalVoucherPolicies,
  normalizeVoucherPolicyRegistry,
  parseVoucherAssetName,
  splitFullDenomTrace,
  VOUCHER_DENOM_HASH_HEX_LENGTH,
  type LucidDataModule,
} from './index';

class TestConstr {
  constructor(
    public readonly index: number,
    public readonly fields: unknown[],
  ) {}
}

const TestLucidData: LucidDataModule = {
  Constr: TestConstr,
  Data: {
    to: (value) =>
      JSON.stringify(value, (_key, item) => {
        if (typeof item === 'bigint') {
          return { __bigint: item.toString() };
        }
        if (item instanceof Map) {
          return [...item.entries()];
        }
        return item;
      }),
    from: (encodedDatum) =>
      JSON.parse(encodedDatum, (_key, item) => {
        if (
          typeof item === 'object' &&
          item !== null &&
          typeof item.__bigint === 'string'
        ) {
          return BigInt(item.__bigint);
        }
        return item;
      }),
  },
};

describe('voucher asset naming', () => {
  it('derives CIP-67 user and reference asset names from a full denom trace', () => {
    const fullDenom = 'transfer/channel-0/transfer/channel-22/uosmo';
    const denomHash = buildVoucherDenomHashFromFullDenom(fullDenom);
    const userTokenName = buildVoucherUserTokenNameFromDenomHash(denomHash);
    const referenceTokenName =
      buildVoucherReferenceTokenNameFromDenomHash(denomHash);

    assert.match(denomHash, /^[0-9a-f]{56}$/);
    assert.equal(denomHash.length, VOUCHER_DENOM_HASH_HEX_LENGTH);
    assert.equal(userTokenName, `${CIP67_FT_LABEL_HEX}${denomHash}`);
    assert.equal(
      referenceTokenName,
      `${CIP67_REFERENCE_NFT_LABEL_HEX}${denomHash}`,
    );
    assert.equal(userTokenName.length, LABELED_VOUCHER_TOKEN_NAME_HEX_LENGTH);
    assert.deepEqual(parseVoucherAssetName(userTokenName), {
      kind: 'ft',
      voucherDenomHash: denomHash,
    });
    assert.deepEqual(expectVoucherAssetName(referenceTokenName), {
      kind: 'reference_nft',
      voucherDenomHash: denomHash,
    });
    assert.equal(
      buildVoucherAssetId('AA'.repeat(28), userTokenName.toUpperCase()),
      `${'aa'.repeat(28)}${userTokenName}`,
    );
  });
});

describe('voucher CIP-68 metadata', () => {
  it('encodes, decodes, and verifies canonical voucher metadata', () => {
    const fullDenom = 'transfer/channel-0/uosmo';
    const trace = splitFullDenomTrace(fullDenom);
    const params = {
      ...trace,
      fullDenom,
      voucherTokenName: buildVoucherUserTokenNameFromDenomHash(
        buildVoucherDenomHashFromFullDenom(fullDenom),
      ),
      voucherPolicyId: 'ab'.repeat(28),
      ibcDenomHash: buildIbcDenomHashFromFullDenom(fullDenom),
    };
    const metadata = {
      ...buildVoucherCip68Metadata(params),
      decimals: 6,
      url: 'https://example.test/uosmo',
      logo: 'ipfs://voucher-logo',
    };
    const encoded = encodeVoucherCip68MetadataDatum(metadata, TestLucidData);

    assert.deepEqual(
      decodeVoucherCip68MetadataDatum(encoded, TestLucidData),
      metadata,
    );
    assert.deepEqual(
      decodeVerifiedVoucherCip68MetadataDatum(
        encodeVoucherCip68MetadataDatum(
          buildVoucherCip68Metadata(params),
          TestLucidData,
        ),
        params,
        TestLucidData,
      ),
      buildVoucherCip68Metadata(params),
    );
    assert.throws(
      () =>
        decodeVerifiedVoucherCip68MetadataDatum(
          encoded,
          { ...params, baseDenom: 'uatom' },
          TestLucidData,
        ),
      /does not match the canonical voucher metadata/,
    );
  });
});

describe('denom trace presentation', () => {
  it('splits IBC paths without treating base-denom slashes as route hops', () => {
    assert.deepEqual(
      splitFullDenomTrace('transfer/channel-0/transfer/channel-22/uosmo'),
      {
        path: 'transfer/channel-0/transfer/channel-22',
        baseDenom: 'uosmo',
      },
    );
    assert.deepEqual(splitFullDenomTrace('factory/osmo1contract/ufoo'), {
      path: '',
      baseDenom: 'factory/osmo1contract/ufoo',
    });
    assert.equal(deriveVoucherCanonicalLabel('factory/osmo1contract/ufoo'), 'ufoo');
    assert.deepEqual(
      deriveVoucherPresentation(
        'transfer/channel-0/factory/osmo1contract/ufoo',
        'factory/osmo1contract/ufoo',
      ),
      {
        displayName: 'transfer/channel-0/factory/osmo1contract/ufoo',
        displaySymbol: 'ufoo',
        displayDescription:
          'IBC voucher for transfer/channel-0/factory/osmo1contract/ufoo',
      },
    );
  });
});

describe('trace registry duplicate detection', () => {
  it('rejects duplicate voucher hashes regardless of casing', () => {
    const voucherHash = 'a'.repeat(56);
    assert.throws(
      () =>
        assertUniqueTraceRegistryEntries([
          { voucher_hash: voucherHash, full_denom: 'transfer/channel-0/uosmo' },
          {
            voucher_hash: voucherHash.toUpperCase(),
            full_denom: 'transfer/channel-7/uosmo',
          },
        ]),
      /Duplicate trace-registry entries detected/,
    );
  });
});

describe('voucher policy registry', () => {
  it('treats the existing mint_voucher validator as the active policy for legacy manifests', () => {
    const activePolicy = 'aa'.repeat(28);

    assert.deepEqual(
      normalizeVoucherPolicyRegistry({
        validators: {
          mint_voucher: {
            script_hash: activePolicy.toUpperCase(),
          },
        },
      }),
      {
        active: { policyId: activePolicy, status: 'active' },
        legacy: [],
        retired: [],
      },
    );
    assert.equal(
      getActiveVoucherPolicyId({
        validators: { mint_voucher: { script_hash: activePolicy } },
      }),
      activePolicy,
    );
  });

  it('normalizes active, legacy, and retired voucher policy entries', () => {
    const activePolicy = 'aa'.repeat(28);
    const legacyPolicy = 'bb'.repeat(28);
    const retiredPolicy = 'cc'.repeat(28);

    const manifest = {
      validators: {
        mint_voucher: {
          script_hash: 'dd'.repeat(28),
        },
      },
      voucher_policy_registry: {
        active: { policy_id: activePolicy.toUpperCase() },
        legacy: [
          { script_hash: legacyPolicy },
          legacyPolicy.toUpperCase(),
          activePolicy,
        ],
        retired: [
          { policyId: retiredPolicy },
          legacyPolicy,
        ],
      },
    };

    assert.deepEqual(normalizeVoucherPolicyRegistry(manifest), {
      active: { policyId: activePolicy, status: 'active' },
      legacy: [{ policyId: legacyPolicy, status: 'legacy' }],
      retired: [{ policyId: retiredPolicy, status: 'retired' }],
    });
    assert.deepEqual(listOperationalVoucherPolicies(manifest), [
      { policyId: activePolicy, status: 'active' },
      { policyId: legacyPolicy, status: 'legacy' },
    ]);
    assert.deepEqual(findVoucherPolicy(manifest, legacyPolicy), {
      policyId: legacyPolicy,
      status: 'legacy',
    });
    assert.deepEqual(findVoucherPolicy(manifest, retiredPolicy), {
      policyId: retiredPolicy,
      status: 'retired',
    });
  });

  it('rejects malformed voucher policy ids', () => {
    assert.throws(
      () =>
        normalizeVoucherPolicyRegistry({
          voucher_policy_registry: {
            active: 'not-a-policy',
          },
        }),
      /voucher_policy_registry\.active must be a 56-character policy id/,
    );
  });
});
