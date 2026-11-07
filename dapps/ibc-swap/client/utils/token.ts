import type { TokenPresentation } from '../types/token';
import { tokenTransferDisabledReason } from './cardanoAssetPresentation';
import {
  decimalDisplayToBaseAmount,
  isBaseAmountWithinBalance,
  isPositiveBaseAmount,
} from './string';

// Keep display text and decimal amounts out of chain-facing token identities.
export function tokenAmount(token: TokenPresentation, displayAmount: string) {
  if (tokenTransferDisabledReason(token)) return null;
  const amount = decimalDisplayToBaseAmount(
    displayAmount,
    token.tokenExponent ?? 0,
  );
  if (
    !token.tokenId ||
    !isPositiveBaseAmount(amount) ||
    (token.balance !== undefined &&
      !isBaseAmountWithinBalance(amount, token.balance))
  )
    return null;
  return { denom: token.tokenId, amount };
}
