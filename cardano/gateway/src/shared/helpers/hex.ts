import { sha3_256 } from 'js-sha3';

const hexTable = new TextEncoder().encode('0123456789abcdef');

export function toHexString(byteArray: Int16Array): string {
  return byteArray.reduce((output, elem) => output + ('0' + elem.toString(16)).slice(-2), '');
}

export function convertHex2String(hexStr: string): string {
  if (!hexStr) return '';
  return Buffer.from(hexToBytes(hexStr)).toString();
}

export function hexToBytes(hex) {
  const bytes = [];
  for (let c = 0; c < hex.length; c += 2) bytes.push(parseInt(hex.substr(c, 2), 16));
  return bytes;
}

export function hashSha3_256(data: string): string {
  const hash = sha3_256(Buffer.from(data, 'hex')).toString();
  return hash;
}

export function toHex(bytes) {
  return encodeToString(bytes);
}

export function encodedLen(n) {
  return n * 2;
}

export function encode(src) {
  const dst = new Uint8Array(encodedLen(src.length));
  for (let i = 0; i < dst.length; i++) {
    const v = src[i];
    dst[i * 2] = hexTable[v >> 4];
    dst[i * 2 + 1] = hexTable[v & 0x0f];
  }
  return dst;
}

export function encodeToString(src) {
  return new TextDecoder().decode(encode(src));
}
