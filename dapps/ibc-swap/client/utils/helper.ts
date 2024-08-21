import { Coin } from 'interchain/types/codegen/cosmos/base/v1beta1/coin';

export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: number | undefined;
  return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    clearTimeout(timeout);
    timeout = window.setTimeout(() => func.apply(this, args), wait);
  };
}

export function customSortTotalSupllyHasBalance(
  totalSupply: Coin[],
  balances: Coin[],
): Coin[] {
  const arr2Set = new Set(balances.map((item) => item.denom));
  const result: Coin[] = [];
  totalSupply.forEach((item) => {
    if (arr2Set.has(item.denom)) {
      result.push(item);
    }
  });
  totalSupply.forEach((item) => {
    if (!arr2Set.has(item.denom)) {
      result.push(item);
    }
  });
  return result;
}
