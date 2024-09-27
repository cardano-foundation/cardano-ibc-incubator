import {sha3_256} from 'js-sha3';
import {blake2b} from 'blakejs';
import {hexToBytes} from './hex';

export type AuthToken = {
  policyId: string;
  name: string;
};

export function convertString2Hex(str: string) {
  if (!str) return '';
  return Buffer.from(str).toString('hex');
}

export const createHash32 = (buffer: Uint8Array) => {
  const hash = blake2b(buffer, undefined, 32);
  return Buffer.from(hash).toString('hex');
};
