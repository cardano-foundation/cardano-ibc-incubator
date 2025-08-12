import crypto from 'crypto';
import { Packet } from '../types/channel/packet';
import { fromHex, hashSHA256, toHex } from './hex';

// CommitPacket calculates the packet commitment bytes
export function commitPacket(packet: Packet): string {
  const timeoutHeight = packet.timeout_height;

  // Concatenate byte arrays efficiently
  let buf = uint64ToBigEndian(packet.timeout_timestamp);
  const revisionNumber = uint64ToBigEndian(timeoutHeight.revisionNumber);
  buf = appendBuffer(buf, revisionNumber);

  const revisionHeight = uint64ToBigEndian(timeoutHeight.revisionHeight);
  buf = appendBuffer(buf, revisionHeight);

  const dataHash = crypto.createHash('sha256').update(fromHex(packet.data)).digest('hex');

  const bufHex = `${toHex(buf)}${dataHash}`;

  return hashSHA256(bufHex); // Convert to Uint8Array
}

// Uint64ToBigEndian - marshals uint64 to a bigendian byte slice so it can be sorted
function uint64ToBigEndian(i: bigint): Uint8Array {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, i);
  return new Uint8Array(buffer);
}

// appendBuffer - appends a Uint8Array to another Uint8Array
function appendBuffer(buf1: Uint8Array, buf2: Uint8Array): Uint8Array {
  const result = new Uint8Array(buf1.length + buf2.length);
  result.set(buf1, 0);
  result.set(buf2, buf1.length);
  return result;
}
