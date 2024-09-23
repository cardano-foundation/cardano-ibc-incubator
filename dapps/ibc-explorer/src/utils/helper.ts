import { TX_STATUS } from '@src/constants';
import {
  Ed25519KeyHash,
  EnterpriseAddress,
  StakeCredential,
} from '@emurgo/cardano-serialization-lib-asmjs';

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
  if (code === '0' || code === null) return TX_STATUS.SUCCESS;
  return TX_STATUS.FAILED;
};

const hexToByte = (hex: string) => {
  const key = '0123456789abcdef';
  const newBytes = [];
  let currentChar = 0;
  let currentByte = 0;
  // eslint-disable-next-line no-plusplus
  for (let i = 0; i < hex.length; i++) {
    // Go over two 4-bit hex chars to convert into one 8-bit byte
    currentChar = key.indexOf(hex[i]);
    if (i % 2 === 0) {
      // First hex char
      currentByte = currentChar << 4; // Get 4-bits from first hex char
    }
    if (i % 2 === 1) {
      // Second hex char
      currentByte += currentChar; // Concat 4-bits from second hex char
      newBytes.push(currentByte); // Add byte
    }
  }
  return new Uint8Array(newBytes);
};

export const paymentCredToAddress = (
  paymentCredStr: string,
  isMainnet: boolean,
): string => {
  try {
    const paymentCred = StakeCredential.from_keyhash(
      Ed25519KeyHash.from_bytes(hexToByte(paymentCredStr)),
    );
    const address = EnterpriseAddress.new(isMainnet ? 1 : 0, paymentCred);
    return address.to_address().to_bech32();
  } catch (_) {
    return paymentCredStr;
  }
};

export const getNumPkgNeeded = (packetDataStr: string) => {
  let numPkgNeeded = 1;
  numPkgNeeded += ((packetDataStr || '').match(/forward/g) || []).length;
  numPkgNeeded += ((packetDataStr || '').match(/osmosis_swap/g) || []).length;
  return numPkgNeeded;
};

export const handleCopyToClipboard = (str: string) => {
  navigator.clipboard.writeText(str);
};
