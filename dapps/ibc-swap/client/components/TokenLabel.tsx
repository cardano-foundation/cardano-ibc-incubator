import type { TokenPresentation } from '../types/token';
import { safeAssetText, shortAssetId } from '../utils/cardanoAssetPresentation';

export const TokenLabel = ({
  token,
  showName = false,
}: {
  token?: TokenPresentation;
  showName?: boolean;
}) => {
  // Resumed transfers may still contain names saved by the old wallet decoder.
  const name = safeAssetText(token?.tokenName);
  const symbol = safeAssetText(token?.tokenSymbol);
  const fallback = token?.tokenId ? shortAssetId(token.tokenId) : '';
  return (
    <span
      title={[
        name,
        safeAssetText(token?.tokenDescription),
        safeAssetText(token?.tokenId),
      ]
        .filter(Boolean)
        .join('\n')}
    >
      {(showName ? name : symbol || name) || fallback}
    </span>
  );
};
