import { GrpcInvalidArgumentException } from '../../exception/grpc_exceptions';

type PacketCursor = {
  version: 1;
  scope: string;
  reverse: boolean;
  sequence: string;
  height: string;
  blockHash: string;
};

// Packet pages belong to one accepted block, including across relayer restarts.
export function decodePacketCursor(key: Uint8Array, scope: string, reverse: boolean): PacketCursor {
  try {
    const cursor = JSON.parse(Buffer.from(key).toString('utf8'));
    if (cursor.version === 1 && cursor.scope === scope && cursor.reverse === reverse &&
        typeof cursor.sequence === 'string' && /^[1-9][0-9]*$/.test(cursor.sequence) &&
        BigInt(cursor.sequence) <= 0xffffffffffffffffn &&
        typeof cursor.height === 'string' && /^[1-9][0-9]*$/.test(cursor.height) &&
        typeof cursor.blockHash === 'string' && /^[0-9a-f]{64}$/.test(cursor.blockHash)) {
      return cursor;
    }
  } catch {
    // A legacy offset cursor must restart enumeration rather than skip records.
  }
  throw new GrpcInvalidArgumentException('Invalid packet pagination cursor, restart enumeration');
}

export function encodePacketCursor(cursor: Omit<PacketCursor, 'version'>): Uint8Array {
  return Buffer.from(JSON.stringify({ version: 1, ...cursor }));
}
