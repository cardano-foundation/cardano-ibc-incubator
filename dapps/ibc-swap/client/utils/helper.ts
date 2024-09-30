import { Coin } from 'interchain/types/codegen/cosmos/base/v1beta1/coin';

// eslint-disable-next-line no-undef
let timeout: NodeJS.Timeout;

export const debounce = <T extends (...args: any[]) => void>(
  func: T,
  wait = 1000,
) => {
  return (...args: Parameters<T>) => {
    const executeFunction = () => {
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(executeFunction, wait);
  };
};

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
