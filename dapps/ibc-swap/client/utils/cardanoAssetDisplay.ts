const CARDANO_POLICY_ID_HEX_LENGTH = 56;
const CIP67_LABEL_HEX_LENGTH = 8;
const CIP67_FT_LABEL_HEX = '0014df10';
const CIP67_REFERENCE_NFT_LABEL_HEX = '000643b0';
const LABELED_ASSET_NAME_HEX_LENGTH = 64;
const HEX_PATTERN = /^[0-9a-f]+$/i;

export type Cip67AssetKind = 'ft' | 'reference_nft';

export type CardanoAssetDisplayTrace = {
  kind: 'native' | 'ibc_voucher';
  displayName: string;
  displaySymbol: string;
  decimals?: number | null;
  logo?: string | null;
};

export type CardanoAssetPresentation = {
  assetName: string;
  assetSymbol: string;
  tokenExponent: number;
  tokenLogo?: string;
};

type CardanoAssetTraceLookup = (
  // eslint-disable-next-line no-unused-vars
  assetId: string,
) => Promise<CardanoAssetDisplayTrace | null>;

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });

const getAssetNameHex = (assetId: string): string | null => {
  if (assetId === 'lovelace') {
    return '';
  }

  if (
    assetId.length <= CARDANO_POLICY_ID_HEX_LENGTH ||
    !HEX_PATTERN.test(assetId)
  ) {
    return null;
  }

  const assetNameHex = assetId.slice(CARDANO_POLICY_ID_HEX_LENGTH);
  return assetNameHex.length % 2 === 0 ? assetNameHex : null;
};

export const getCip67AssetKind = (assetId: string): Cip67AssetKind | null => {
  const assetNameHex = getAssetNameHex(assetId);
  if (assetNameHex?.length !== LABELED_ASSET_NAME_HEX_LENGTH) {
    return null;
  }

  const label = assetNameHex.slice(0, CIP67_LABEL_HEX_LENGTH).toLowerCase();
  if (label === CIP67_FT_LABEL_HEX) {
    return 'ft';
  }
  if (label === CIP67_REFERENCE_NFT_LABEL_HEX) {
    return 'reference_nft';
  }
  return null;
};

const decodePrintableAssetName = (assetNameHex: string): string | null => {
  try {
    const bytes = new Uint8Array(
      assetNameHex.match(/.{2}/g)?.map((byte) => parseInt(byte, 16)) ?? [],
    );
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!decoded.trim() || hasControlCharacter(decoded)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
};

export const getFallbackCardanoAssetName = (assetId: string): string => {
  if (assetId === 'lovelace') {
    return 'lovelace';
  }

  const assetNameHex = getAssetNameHex(assetId);
  if (assetNameHex === null || assetNameHex === '') {
    return assetId;
  }

  const cip67Kind = getCip67AssetKind(assetId);
  if (cip67Kind) {
    const suffix = assetNameHex.slice(CIP67_LABEL_HEX_LENGTH);
    return cip67Kind === 'ft'
      ? `CIP-68 FT ${suffix}`
      : `CIP-68 reference ${suffix}`;
  }

  return decodePrintableAssetName(assetNameHex) ?? assetNameHex;
};

const normalizeDisplayText = (value?: string | null): string | null => {
  const normalized = value?.trim();
  return normalized || null;
};

export const resolveCardanoAssetPresentation = async (
  assetId: string,
  lookupTrace: CardanoAssetTraceLookup,
): Promise<CardanoAssetPresentation | null> => {
  const fallbackName = getFallbackCardanoAssetName(assetId);
  const fallback: CardanoAssetPresentation = {
    assetName: fallbackName,
    assetSymbol: assetId,
    tokenExponent: 0,
  };
  const cip67Kind = getCip67AssetKind(assetId);

  if (!cip67Kind) {
    return fallback;
  }

  const trace = await lookupTrace(assetId);
  if (!trace) {
    return null;
  }

  if (trace.kind !== 'ibc_voucher') {
    return fallback;
  }

  // Label 100 is only a non-selectable reference NFT under the bridge's
  // voucher policy. A native asset using the same CIP-67 label remains valid.
  if (cip67Kind === 'reference_nft') {
    return null;
  }

  const assetName = normalizeDisplayText(trace.displayName);
  const assetSymbol = normalizeDisplayText(trace.displaySymbol);
  if (!assetName || !assetSymbol) {
    return null;
  }

  const tokenLogo = normalizeDisplayText(trace.logo);
  return {
    assetName,
    assetSymbol,
    // Cardano wallet balances and the current transaction paths both use
    // integer base units. Keep that contract until decimal conversion is
    // supported end to end in both Transfer and Swap.
    tokenExponent: 0,
    ...(tokenLogo ? { tokenLogo } : {}),
  };
};
