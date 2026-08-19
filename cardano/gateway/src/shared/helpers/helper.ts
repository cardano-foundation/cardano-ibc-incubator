import { AuthToken } from '../types/auth-token';
import { hashSha3_256, hexToBytes } from './hex';

export function getIdByTokenName(tokenName: string, baseToken: AuthToken, prefix: string): string {
  const baseTokenPart = hashSha3_256(baseToken.policyId + baseToken.name).slice(0, 40);
  const prefixPart = hashSha3_256(prefix).slice(0, 8);
  const prefixFull = baseTokenPart + prefixPart;

  if (!tokenName.includes(prefixFull)) return '';
  const idHex = tokenName.replaceAll(prefixFull, '');

  return Buffer.from(hexToBytes(idHex)).toString();
}

const sortByKey = <K, V>(map: Map<K, V>, reverse?: boolean): Map<K, V> => {
  return new Map(
    Array.from(map.entries()).sort(([keyA], [keyB]) =>
      reverse ? String(keyB).localeCompare(String(keyA)) : String(keyA).localeCompare(String(keyB)),
    ),
  );
};

export const insertSortMap = <K, V>(inputMap: Map<K, V>, newKey: K, newValue: V, reverse?: boolean): Map<K, V> => {
  // Build a new map so callers can keep using the input snapshot they already hold.
  const updatedMap = new Map(inputMap);
  // `set` replaces existing values for `newKey` and inserts when missing.
  updatedMap.set(newKey, newValue);
  // Always return a sorted view because downstream code expects deterministic key order.
  return sortByKey(updatedMap, reverse);
};

export function getDenomPrefix(portId: string, channelId: string): string {
  return `${portId}/${channelId}/`;
}
export function sortedStringify(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return JSON.stringify(obj);
  }

  const sortedObj = {};
  Object.keys(obj)
    .sort()
    .forEach((key) => {
      sortedObj[key] = obj[key];
    });

  return JSON.stringify(sortedObj);
}

export function stringifyIcs20PacketData(packet: {
  denom?: string;
  amount?: string;
  sender?: string;
  receiver?: string;
  memo?: string;
}) {
  const ordered: Record<string, string> = {};

  if (packet.amount !== undefined && packet.amount !== '') {
    ordered.amount = packet.amount;
  }
  if (packet.denom !== undefined && packet.denom !== '') {
    ordered.denom = packet.denom;
  }
  if (packet.memo !== undefined && packet.memo !== '') {
    ordered.memo = packet.memo;
  }
  if (packet.receiver !== undefined && packet.receiver !== '') {
    ordered.receiver = packet.receiver;
  }
  if (packet.sender !== undefined && packet.sender !== '') {
    ordered.sender = packet.sender;
  }

  return JSON.stringify(ordered);
}
