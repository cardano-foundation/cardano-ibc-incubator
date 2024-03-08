import { AuthToken } from '../types/auth-token';
import { convertHex2String, hashSha3_256, hexToBytes } from './hex';

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

const sortByNumberKey = <K, V>(map: Map<K, V>, reverse?: boolean): Map<K, V> => {
  return new Map(
    Array.from(map.entries()).sort(([keyA], [keyB]) =>
      reverse ? Number(keyB) - Number(keyA) : Number(keyA) - Number(keyB),
    ),
  );
};

export const insertSortMap = <K, V>(inputMap: Map<K, V>, newKey: K, newValue: V, reverse?: boolean): Map<K, V> => {
  // Convert the Map to an array of key-value pairs
  // const entriesArray: [K, V][] = Array.from(inputMap.entries());

  // // Add the new key-value pair to the array
  // entriesArray.push([newKey, newValue]);

  // Sort the array based on the keys using the provided comparator function
  // entriesArray.sort((entry1, entry2) =>
  //   keyComparator ? keyComparator(entry1[0], entry2[0]) : Number(entry1[0]) - Number(entry2[0]),
  // );

  // // Create a new Map from the sorted array
  // const sortedMap = new Map<K, V>(entriesArray);
  // return sortedMap;

  inputMap.set(newKey, newValue);
  return sortByKey(inputMap, reverse);
};

export const insertSortMapWithNumberKey = <K, V>(
  inputMap: Map<K, V>,
  newKey: K,
  newValue: V,
  reverse?: boolean,
): Map<K, V> => {
  // Convert the Map to an array of key-value pairs
  // const entriesArray: [K, V][] = Array.from(inputMap.entries());

  // // Add the new key-value pair to the array
  // entriesArray.push([newKey, newValue]);

  // Sort the array based on the keys using the provided comparator function
  // entriesArray.sort((entry1, entry2) =>
  //   keyComparator ? keyComparator(entry1[0], entry2[0]) : Number(entry1[0]) - Number(entry2[0]),
  // );

  // // Create a new Map from the sorted array
  // const sortedMap = new Map<K, V>(entriesArray);
  // return sortedMap;

  inputMap.set(newKey, newValue);
  return sortByNumberKey(inputMap, reverse);
};
