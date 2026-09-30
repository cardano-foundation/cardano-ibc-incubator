import type { TokenPresentation } from '../types/token';
import {
  safeAssetText,
  tokenPrimaryLabel,
  tokenUsesBaseUnits,
} from '../utils/cardanoAssetPresentation';

export const TokenLabel = ({ token }: { token?: TokenPresentation }) => {
  // Resumed transfers may still contain names saved by the old wallet decoder.
  const name = safeAssetText(token?.tokenName);
  return (
    <span
      style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}
      title={[
        name,
        safeAssetText(token?.tokenDescription),
        safeAssetText(token?.tokenId),
      ]
        .filter(Boolean)
        .join('\n')}
    >
      {tokenPrimaryLabel(token)}
    </span>
  );
};

export const TokenAmountUnit = ({ token }: { token?: TokenPresentation }) => (
  <>{tokenUsesBaseUnits(token) ? ' base units' : ''}</>
);
