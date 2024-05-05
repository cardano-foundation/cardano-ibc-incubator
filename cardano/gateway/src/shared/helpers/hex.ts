import { sha3_256 } from 'js-sha3';
import crypto from 'crypto';

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
export function convertString2Hex(str: string) {
  if (!str) return '';
  return Buffer.from(str).toString('hex');
}

export function hashSha3_256(data: string): string {
  const hash = sha3_256(Buffer.from(data, 'hex')).toString();
  return hash;
}

export function toHex(bytes) {
  if (!bytes) return '';
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

export function fromHex(hex) {
  if (!hex) return new Uint8Array();
  return decodeString(hex);
}

export function decodeString(s) {
  return decode(new TextEncoder().encode(s));
}

/** Convert a Hex encoded string to a Utf-8 encoded string. */
export function toText(hex) {
  return new TextDecoder().decode(decode(new TextEncoder().encode(hex)));
}
/** Convert a Utf-8 encoded string to a Hex encoded string. */
export function fromText(text) {
  return toHex(new TextEncoder().encode(text));
}
/**
 * Decode decodes `src` into `decodedLen(src.length)` bytes
 * If the input is malformed an error will be thrown
 * the error.
 * @param src
 */
export function decode(src) {
  const dst = new Uint8Array(decodedLen(src.length));
  for (let i = 0; i < dst.length; i++) {
    const a = fromHexChar(src[i * 2]);
    const b = fromHexChar(src[i * 2 + 1]);
    dst[i] = (a << 4) | b;
  }
  if (src.length % 2 == 1) {
    // Check for invalid char before reporting bad length,
    // since the invalid char (if present) is an earlier problem.
    fromHexChar(src[dst.length * 2]);
    throw errLength();
  }
  return dst;
}

/**
 * DecodedLen returns the length of decoding `x` source bytes.
 * Specifically, it returns `x / 2`.
 * @param x
 */
export function decodedLen(x) {
  return x >>> 1;
}

function fromHexChar(byte) {
  // '0' <= byte && byte <= '9'
  if (48 <= byte && byte <= 57) return byte - 48;
  // 'a' <= byte && byte <= 'f'
  if (97 <= byte && byte <= 102) return byte - 97 + 10;
  // 'A' <= byte && byte <= 'F'
  if (65 <= byte && byte <= 70) return byte - 65 + 10;
  throw errInvalidByte(byte);
}

/** ErrLength returns an error about odd string length. */
export function errLength() {
  return new Error('encoding/hex: odd length hex string');
}

/**
 * ErrInvalidByte takes an invalid byte and returns an Error.
 * @param byte
 */
export function errInvalidByte(byte) {
  return new Error('encoding/hex: invalid byte: ' + new TextDecoder().decode(new Uint8Array([byte])));
}

export function hashSHA256(data: string): string {
  const hash = crypto.createHash('sha256').update(fromHex(data)).digest('hex');
  return hash;
}
