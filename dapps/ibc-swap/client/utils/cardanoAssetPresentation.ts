import {
  buildVoucherUserTokenNameFromFullDenom,
  parseVoucherAssetName,
  splitFullDenomTrace,
  type CardanoAssetDenomTrace,
} from '@cardano-ibc/trace-registry';
import type { TokenPresentation } from '../types/token';

type WalletAsset = { unit: string; quantity: string };
export type PresentedCardanoAsset = WalletAsset & TokenPresentation;
// eslint-disable-next-line no-unused-vars
type TraceLookup = (assetId: string) => Promise<CardanoAssetDenomTrace | null>;

// Token names are arbitrary bytes. Only verified presentation text is rendered.
const unsafeText = /[\p{Cc}\p{Cf}\ufffd]/u;
export const safeAssetText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() && !unsafeText.test(value)
    ? value.trim()
    : undefined;

export const shortAssetId = (assetId: string): string => {
  const safeId = assetId.replace(/[\p{Cc}\p{Cf}\ufffd]/gu, '?');
  return safeId.length > 24
    ? `${safeId.slice(0, 12)}...${safeId.slice(-8)}`
    : safeId || 'Unknown asset';
};

const UNRESOLVED_VOUCHER =
  'Voucher trace could not be verified. Reload to retry.';

function parseVoucherId(assetId?: string) {
  return assetId && /^[0-9a-f]{120}$/i.test(assetId)
    ? parseVoucherAssetName(assetId.slice(56))
    : null;
}

export function verifiedVoucherTrace(
  token?: TokenPresentation,
): string | undefined {
  const trace = token?.tokenTrace;
  if (
    token?.cardanoAssetStatus !== 'verified-voucher' ||
    parseVoucherId(token.tokenId)?.kind !== 'ft' ||
    !trace ||
    safeAssetText(trace) !== trace
  )
    return undefined;
  return buildVoucherUserTokenNameFromFullDenom(trace) ===
    token.tokenId!.slice(56).toLowerCase()
    ? trace
    : undefined;
}

export function tokenTransferDisabledReason(
  token?: TokenPresentation,
): string | undefined {
  if (!token?.tokenId) return 'Select an asset.';
  if (token.tokenDisabledReason) return token.tokenDisabledReason;
  if (token.cardanoAssetStatus === 'invalid') return 'Invalid asset ID.';
  const parsed = parseVoucherId(token.tokenId);
  if (parsed?.kind === 'reference_nft')
    return 'Reference tokens cannot be transferred as vouchers.';
  if (
    token.cardanoAssetStatus === 'unresolved-voucher' ||
    token.cardanoAssetStatus === 'verified-voucher' ||
    (parsed?.kind === 'ft' && token.cardanoAssetStatus !== 'native')
  )
    return verifiedVoucherTrace(token) ? undefined : UNRESOLVED_VOUCHER;
  return undefined;
}

export function tokenPrimaryLabel(token?: TokenPresentation): string {
  if (!token?.tokenId) return '';
  if (
    token.cardanoAssetStatus === 'verified-voucher' &&
    !token.tokenDisabledReason
  ) {
    const trace = verifiedVoucherTrace(token);
    if (trace) return trace;
  }
  if (
    token.cardanoAssetStatus === 'verified-voucher' ||
    token.cardanoAssetStatus === 'unresolved-voucher' ||
    (parseVoucherId(token.tokenId)?.kind === 'ft' &&
      token.cardanoAssetStatus !== 'native')
  )
    return `Unresolved voucher · ${token.tokenId}`;
  if (token.tokenId === 'lovelace') return 'ADA';
  if (token.cardanoAssetStatus)
    return safeAssetText(token.tokenId) || shortAssetId(token.tokenId);
  return (
    safeAssetText(token.tokenName) ||
    safeAssetText(token.tokenSymbol) ||
    shortAssetId(token.tokenId)
  );
}

export function tokenSecondaryLabel(token: TokenPresentation): string {
  if (tokenTransferDisabledReason(token)) return '';
  return [
    safeAssetText(token.tokenDisplayName),
    safeAssetText(token.tokenSymbol),
  ]
    .filter(
      (text, index, texts) =>
        text &&
        text !== tokenPrimaryLabel(token) &&
        texts.indexOf(text) === index,
    )
    .join(' · ');
}

export function tokenUsesBaseUnits(token?: TokenPresentation): boolean {
  return (
    Boolean(token?.cardanoAssetStatus) && token?.tokenExponent === undefined
  );
}

function safeLogo(value: unknown): string | undefined {
  const uri = safeAssetText(value);
  if (!uri) return undefined;
  if (/^ipfs:\/\/[a-zA-Z0-9]+(?:\/[^\s]*)?$/.test(uri)) {
    return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  }
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function fallbackCardanoAsset(asset: WalletAsset): PresentedCardanoAsset {
  const ada = asset.unit === 'lovelace';
  const label = ada
    ? 'ADA'
    : safeAssetText(asset.unit) || shortAssetId(asset.unit);
  const valid = ada || /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/i.test(asset.unit);
  return {
    ...asset,
    tokenId: asset.unit,
    tokenName: label,
    tokenSymbol: label,
    tokenDescription: ada ? 'Cardano native currency' : undefined,
    cardanoAssetStatus: valid ? 'native' : 'invalid',
    tokenExponent: ada ? 6 : undefined,
    balance: asset.quantity,
  };
}

export async function resolveCardanoWalletAssets(
  assets: WalletAsset[],
  lookup: TraceLookup,
): Promise<PresentedCardanoAsset[]> {
  const presented = await Promise.all(
    assets.map(async (asset): Promise<PresentedCardanoAsset | null> => {
      const fallback = fallbackCardanoAsset(asset);
      if (!/^[0-9a-f]{56,120}$/i.test(asset.unit)) return fallback;
      const parsed = parseVoucherAssetName(asset.unit.slice(56));
      // Reference NFTs are metadata records, never voucher transfer choices.
      if (parsed?.kind === 'reference_nft') return null;
      if (parsed?.kind !== 'ft') return fallback;

      const unresolved: PresentedCardanoAsset = {
        ...fallback,
        tokenName: 'Unresolved voucher',
        tokenSymbol: undefined,
        cardanoAssetStatus: 'unresolved-voucher',
      };

      try {
        // The API checks the deployed policy and paired CIP-68 reference asset.
        // A matching CIP-67 label alone is not proof that this is our voucher.
        const trace = await lookup(asset.unit);
        if (
          trace?.kind === 'native' &&
          trace.assetId?.toLowerCase() === asset.unit.toLowerCase() &&
          trace.fullDenom?.toLowerCase() === asset.unit.toLowerCase()
        )
          return fallback;
        if (
          trace?.kind !== 'ibc_voucher' ||
          trace.assetId?.toLowerCase() !== asset.unit.toLowerCase() ||
          trace.voucherPolicyId?.toLowerCase() !==
            asset.unit.slice(0, 56).toLowerCase() ||
          trace.voucherTokenName?.toLowerCase() !==
            asset.unit.slice(56).toLowerCase() ||
          !trace.fullDenom ||
          safeAssetText(trace.fullDenom) !== trace.fullDenom ||
          buildVoucherUserTokenNameFromFullDenom(trace.fullDenom) !==
            asset.unit.slice(56).toLowerCase()
        )
          return unresolved;

        const parts = splitFullDenomTrace(trace.fullDenom);
        if (parts.path !== trace.path || parts.baseDenom !== trace.baseDenom)
          return unresolved;
        return {
          ...fallback,
          cardanoAssetStatus: 'verified-voucher',
          tokenTrace: trace.fullDenom,
          tokenName: trace.fullDenom,
          tokenDisplayName: safeAssetText(trace.displayName),
          tokenSymbol: safeAssetText(trace.displaySymbol),
          tokenDescription:
            safeAssetText(trace.displayDescription) ||
            `IBC voucher for ${trace.fullDenom}`,
          tokenExponent:
            typeof trace.decimals === 'number' &&
            Number.isInteger(trace.decimals) &&
            trace.decimals >= 0 &&
            trace.decimals <= 255
              ? trace.decimals
              : undefined,
          tokenLogo: safeLogo(trace.logo),
        };
      } catch {
        return unresolved;
      }
    }),
  );
  return presented.filter(
    (asset): asset is PresentedCardanoAsset => asset !== null,
  );
}

export function cardanoTokenOption(
  asset: PresentedCardanoAsset,
  defaultLogo: string,
) {
  return {
    tokenId: asset.unit,
    tokenName: asset.tokenName,
    tokenTrace: asset.tokenTrace,
    tokenDisplayName: asset.tokenDisplayName,
    cardanoAssetStatus: asset.cardanoAssetStatus,
    tokenDisabledReason: asset.tokenDisabledReason,
    tokenSymbol: asset.tokenSymbol,
    tokenDescription: asset.tokenDescription,
    tokenLogo: asset.tokenLogo || defaultLogo,
    tokenExponent: asset.tokenExponent,
    balance: asset.quantity,
  };
}
