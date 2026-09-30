import type { SwapDataType } from '../types/SwapDataType';
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

// Prepared swaps are valid only for the exact asset IDs, amounts and receiver
// currently shown in the form. Metadata names never identify a transaction.
export function swapRequestKey(
  swap: SwapDataType,
  sender?: string,
  receiver?: string,
) {
  const input = tokenAmount(swap.fromToken, swap.fromToken.swapAmount || '');
  if (
    !input ||
    !sender ||
    !receiver ||
    tokenTransferDisabledReason(swap.toToken) ||
    !swap.fromToken.network?.networkId ||
    !swap.toToken.network?.networkId
  )
    return undefined;
  return JSON.stringify([
    swap.fromToken.network,
    input.denom,
    input.amount,
    swap.fromToken.tokenTrace,
    swap.fromToken.tokenExponent,
    swap.toToken.network,
    swap.toToken.tokenId,
    swap.toToken.tokenTrace,
    swap.toToken.tokenExponent,
    sender,
    receiver,
    swap.slippageTolerance,
  ]);
}
