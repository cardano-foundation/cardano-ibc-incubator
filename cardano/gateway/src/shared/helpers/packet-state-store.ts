import { ICS23MerkleTree } from './ics23-merkle-tree';

type PacketStoreKind = 'commitments' | 'receipts' | 'acks';

type PacketStoreEntry = {
  sequence: bigint;
  value: string;
};

export function packetStorePath(
  kind: PacketStoreKind,
  portId: string,
  channelId: string,
  sequence: bigint | number | string,
): string {
  return `${kind}/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
}

/** Decode the on-chain `cbor.serialise(ByteArray)` packet leaf value. */
function decodePacketStoreValue(
  value: Buffer,
  Lucid: typeof import('@lucid-evolution/lucid'),
): string {
  const decoded = Lucid.Data.from(value.toString('hex'), Lucid.Data.Bytes() as any) as unknown;
  if (typeof decoded !== 'string') {
    throw new Error('Packet state leaf is not a CBOR-encoded byte array');
  }
  return decoded;
}

export function getPacketStoreValue(
  tree: ICS23MerkleTree,
  kind: PacketStoreKind,
  portId: string,
  channelId: string,
  sequence: bigint | number | string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): string | undefined {
  const value = tree.get(packetStorePath(kind, portId, channelId, sequence));
  return value ? decodePacketStoreValue(value, Lucid) : undefined;
}

export function listPacketStoreEntries(
  tree: ICS23MerkleTree,
  kind: PacketStoreKind,
  portId: string,
  channelId: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): PacketStoreEntry[] {
  const prefix = `${kind}/ports/${portId}/channels/${channelId}/sequences/`;
  return tree
    .getKeys()
    .filter((key) => key.startsWith(prefix))
    .map((key) => {
      const sequenceText = key.slice(prefix.length);
      if (!/^\d+$/.test(sequenceText)) {
        throw new Error(`Malformed packet state sequence in key '${key}'`);
      }
      const value = tree.get(key);
      if (!value) {
        throw new Error(`Packet state key '${key}' disappeared while reading tree`);
      }
      return {
        sequence: BigInt(sequenceText),
        value: decodePacketStoreValue(value, Lucid),
      };
    })
    .sort((left, right) =>
      left.sequence === right.sequence ? 0 : left.sequence < right.sequence ? -1 : 1,
    );
}
