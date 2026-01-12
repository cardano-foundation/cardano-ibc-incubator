import { HandlerDatum } from '../types/handler-datum';
import { HostStateDatum } from '../types/host-state-datum';

/**
 * Encode HostStateDatum to CBOR with DEFINITE-length arrays
 * 
 * Aiken-compiled Plutus validators expect definite-length CBOR arrays.
 * This encoder manually constructs the CBOR bytes to ensure perfect compatibility.
 * 
 * CBOR encoding:
 * - Constructor 0: 0xd87982 (tag 121, array of 2)
 * - Constructor 0 (inner): 0xd87987 (tag 121, array of 7)
 * - Integer 0-23: 0x00-0x17
 * - Bytestring (32 bytes): 0x5820 + bytes
 * - Empty array: 0x80
 * - BigInt: 0x1b + 8 bytes (big-endian)
 */
export function encodeHostStateDatumDefinite(datum: HostStateDatum): string {
  const bytes: number[] = [];
  
  // Outer Constructor 0 with 2 fields
  bytes.push(0xd8, 0x79, 0x82);
  
  // Inner Constructor 0 with 7 fields (HostState)
  bytes.push(0xd8, 0x79, 0x87);
  
  // Field 1: version (integer)
  encodeInteger(bytes, Number(datum.state.version));
  
  // Field 2: ibc_state_root (32-byte bytestring)
  bytes.push(0x58, 0x20);  // bytestring of length 32
  const rootBytes = hexToBytes(datum.state.ibc_state_root);
  bytes.push(...rootBytes);
  
  // Field 3: next_client_sequence (integer)
  encodeInteger(bytes, Number(datum.state.next_client_sequence));
  
  // Field 4: next_connection_sequence (integer)
  encodeInteger(bytes, Number(datum.state.next_connection_sequence));
  
  // Field 5: next_channel_sequence (integer)
  encodeInteger(bytes, Number(datum.state.next_channel_sequence));
  
  // Field 6: bound_port (array)
  encodeArray(bytes, datum.state.bound_port);
  
  // Field 7: last_update_time (big integer)
  encodeBigInt(bytes, Number(datum.state.last_update_time));
  
  // Field 8 (outer): nft_policy (28-byte bytestring)
  encodeBytes(bytes, datum.nft_policy);
  
  return Buffer.from(bytes).toString('hex');
}

/**
 * Encode HandlerDatum to CBOR with DEFINITE-length arrays
 *
 * Structure:
 * Constr 0 [
 *   Constr 0 [next_client_seq, next_connection_seq, next_channel_seq, bound_port, ibc_state_root],
 *   Constr 0 [policy_id, name]
 * ]
 */
export function encodeHandlerDatumDefinite(datum: HandlerDatum): string {
  const bytes: number[] = [];

  // Outer Constructor 0 with 2 fields
  bytes.push(0xd8, 0x79, 0x82);

  // HandlerState (Constr 0) with 5 fields
  bytes.push(0xd8, 0x79, 0x85);
  encodeInteger(bytes, Number(datum.state.next_client_sequence));
  encodeInteger(bytes, Number(datum.state.next_connection_sequence));
  encodeInteger(bytes, Number(datum.state.next_channel_sequence));
  encodeArray(bytes, datum.state.bound_port);
  encodeBytes(bytes, datum.state.ibc_state_root);

  // AuthToken (Constr 0) with 2 fields
  bytes.push(0xd8, 0x79, 0x82);
  encodeBytes(bytes, datum.token.policyId);
  encodeBytes(bytes, datum.token.name);

  return Buffer.from(bytes).toString('hex');
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

function encodeInteger(bytes: number[], n: number) {
  if (n >= 0 && n <= 23) {
    bytes.push(n);
  } else if (n >= 24 && n <= 255) {
    bytes.push(0x18, n);
  } else if (n >= 256 && n <= 65535) {
    bytes.push(0x19, (n >> 8) & 0xff, n & 0xff);
  } else if (n >= 65536 && n <= 0xffffffff) {
    bytes.push(0x1a, (n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  } else {
    // Fallback to 64-bit encoding
    encodeBigInt(bytes, n);
  }
}

function encodeBigInt(bytes: number[], n: number) {
  bytes.push(0x1b);  // 64-bit unsigned integer
  const hi = Math.floor(n / 0x100000000);
  const lo = n & 0xffffffff;
  bytes.push(
    (hi >> 24) & 0xff, (hi >> 16) & 0xff, (hi >> 8) & 0xff, hi & 0xff,
    (lo >> 24) & 0xff, (lo >> 16) & 0xff, (lo >> 8) & 0xff, lo & 0xff
  );
}

function encodeBytes(bytes: number[], hex: string) {
  const payload = hexToBytes(hex);
  const len = payload.length;
  if (len <= 23) {
    bytes.push(0x40 + len);
  } else if (len <= 0xff) {
    bytes.push(0x58, len);
  } else if (len <= 0xffff) {
    bytes.push(0x59, (len >> 8) & 0xff, len & 0xff);
  } else {
    throw new Error(`Bytestring too long: ${len}`);
  }
  bytes.push(...payload);
}

function encodeArray(bytes: number[], arr: bigint[] | number[]) {
  const len = arr.length;
  if (len <= 23) {
    bytes.push(0x80 + len);  // definite array
  } else {
    throw new Error(`Array length ${len} not supported`);
  }
  for (const item of arr) {
    encodeInteger(bytes, Number(item));
  }
}
