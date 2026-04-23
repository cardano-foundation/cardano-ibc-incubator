import { blake2b } from '@noble/hashes/blake2b';

export const CIP67_REFERENCE_NFT_LABEL_HEX = '000643b0';
export const CIP67_FT_LABEL_HEX = '0014df10';
export const VOUCHER_DENOM_HASH_HEX_LENGTH = 56;
export const LABELED_VOUCHER_TOKEN_NAME_HEX_LENGTH = 64;

type VoucherLabelKind = 'ft' | 'reference_nft';

export function buildVoucherDenomHashFromFullDenom(fullDenom: string): string {
  return Buffer.from(blake2b(Buffer.from(fullDenom, 'utf8'), { dkLen: 28 })).toString('hex');
}

export function buildVoucherUserTokenNameFromDenomHash(voucherDenomHash: string): string {
  return `${CIP67_FT_LABEL_HEX}${normalizeVoucherDenomHash(voucherDenomHash)}`;
}

export function buildVoucherReferenceTokenNameFromDenomHash(
  voucherDenomHash: string,
): string {
  return `${CIP67_REFERENCE_NFT_LABEL_HEX}${normalizeVoucherDenomHash(voucherDenomHash)}`;
}

export function buildVoucherUserTokenNameFromFullDenom(fullDenom: string): string {
  return buildVoucherUserTokenNameFromDenomHash(
    buildVoucherDenomHashFromFullDenom(fullDenom),
  );
}

export function buildVoucherReferenceTokenNameFromFullDenom(fullDenom: string): string {
  return buildVoucherReferenceTokenNameFromDenomHash(
    buildVoucherDenomHashFromFullDenom(fullDenom),
  );
}

export function buildVoucherAssetId(policyId: string, tokenName: string): string {
  return `${policyId.toLowerCase()}${tokenName.toLowerCase()}`;
}

export function deriveVoucherReferenceAssetId(
  policyId: string,
  voucherDenomHash: string,
): string {
  return buildVoucherAssetId(
    policyId,
    buildVoucherReferenceTokenNameFromDenomHash(voucherDenomHash),
  );
}

export function parseVoucherAssetName(
  assetNameHex: string,
): { kind: VoucherLabelKind; voucherDenomHash: string } | null {
  const normalized = assetNameHex.trim().toLowerCase();
  if (normalized.length !== LABELED_VOUCHER_TOKEN_NAME_HEX_LENGTH) {
    return null;
  }

  if (!/^[0-9a-f]+$/i.test(normalized)) {
    return null;
  }

  const label = normalized.slice(0, 8);
  const voucherDenomHash = normalized.slice(8);
  if (label === CIP67_FT_LABEL_HEX) {
    return { kind: 'ft', voucherDenomHash };
  }
  if (label === CIP67_REFERENCE_NFT_LABEL_HEX) {
    return { kind: 'reference_nft', voucherDenomHash };
  }
  return null;
}

export function expectVoucherAssetName(
  assetNameHex: string,
): { kind: VoucherLabelKind; voucherDenomHash: string } {
  const parsed = parseVoucherAssetName(assetNameHex);
  if (!parsed) {
    throw new Error(
      `Invalid CIP-67 voucher asset name: expected 32-byte (333) or (100) labeled asset name, received ${assetNameHex}`,
    );
  }
  return parsed;
}

export function isVoucherAssetName(assetNameHex: string): boolean {
  return parseVoucherAssetName(assetNameHex) !== null;
}

export function isVoucherUserTokenName(assetNameHex: string): boolean {
  return parseVoucherAssetName(assetNameHex)?.kind === 'ft';
}

export function isVoucherReferenceTokenName(assetNameHex: string): boolean {
  return parseVoucherAssetName(assetNameHex)?.kind === 'reference_nft';
}

function normalizeVoucherDenomHash(voucherDenomHash: string): string {
  const normalized = voucherDenomHash.trim().toLowerCase();
  if (!/^[0-9a-f]{56}$/i.test(normalized)) {
    throw new Error(
      `Invalid voucher denom hash: expected ${VOUCHER_DENOM_HASH_HEX_LENGTH} hex characters, received ${voucherDenomHash}`,
    );
  }
  return normalized;
}
