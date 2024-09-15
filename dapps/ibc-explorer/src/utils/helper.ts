import { TX_STATUS } from '@src/constants';

// eslint-disable-next-line no-undef
let timeout: NodeJS.Timeout;

// eslint-disable-next-line no-unused-vars
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

export const txStatusFromCode = (code: string) => {
  if (typeof code === 'undefined') return TX_STATUS.PROCESSING;
  if (code === '0') return TX_STATUS.SUCCESS;
  return TX_STATUS.FAILED;
};
