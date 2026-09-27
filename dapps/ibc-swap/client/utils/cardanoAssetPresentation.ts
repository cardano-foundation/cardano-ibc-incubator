import {
  deriveVoucherPresentation,
  parseVoucherAssetName,
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
  const label = ada ? 'ADA' : shortAssetId(asset.unit);
  return {
    ...asset,
    tokenId: asset.unit,
    tokenName: label,
    tokenSymbol: label,
    tokenDescription: ada ? 'Cardano native currency' : undefined,
    tokenExponent: ada ? 6 : 0,
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

      try {
        // The API checks the deployed policy and paired CIP-68 reference asset.
        // A matching CIP-67 label alone is not proof that this is our voucher.
        const trace = await lookup(asset.unit);
        if (
          trace?.kind !== 'ibc_voucher' ||
          trace.assetId?.toLowerCase() !== asset.unit.toLowerCase() ||
          trace.voucherPolicyId?.toLowerCase() !==
            asset.unit.slice(0, 56).toLowerCase() ||
          trace.voucherTokenName?.toLowerCase() !==
            asset.unit.slice(56).toLowerCase() ||
          !safeAssetText(trace.fullDenom) ||
          !safeAssetText(trace.baseDenom)
        )
          return fallback;

        const deterministic = deriveVoucherPresentation(
          trace.fullDenom,
          trace.baseDenom,
        );
        return {
          ...fallback,
          tokenName:
            safeAssetText(trace.displayName) || deterministic.displayName,
          tokenSymbol:
            safeAssetText(trace.displaySymbol) || deterministic.displaySymbol,
          tokenDescription:
            safeAssetText(trace.displayDescription) ||
            deterministic.displayDescription,
          tokenExponent:
            typeof trace.decimals === 'number' &&
            Number.isInteger(trace.decimals) &&
            trace.decimals >= 0 &&
            trace.decimals <= 255
              ? trace.decimals
              : 0,
          tokenLogo: safeLogo(trace.logo),
        };
      } catch {
        return fallback;
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
    tokenSymbol: asset.tokenSymbol,
    tokenDescription: asset.tokenDescription,
    tokenLogo: asset.tokenLogo || defaultLogo,
    tokenExponent: asset.tokenExponent,
    balance: asset.quantity,
  };
}
