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

export const deleteSortMap = <K, V>(
  sortedMap: Map<K, V>,
  keyToDelete: K,
  keyComparator?: (a: K, b: K) => number,
): Map<K, V> => {
  // Convert the sorted map to an array of key-value pairs
  const entriesArray: [K, V][] = Array.from(sortedMap.entries());

  // Find the index of the key to delete
  const indexToDelete = entriesArray.findIndex(([key]) =>
    keyComparator ? keyComparator(key, keyToDelete) === 0 : key === keyToDelete,
  );

  // If the key is found, remove it from the array
  if (indexToDelete !== -1) {
    entriesArray.splice(indexToDelete, 1);
  }

  // Create a new Map from the modified array
  const updatedMap = new Map<K, V>(entriesArray);

  return updatedMap;
};

export function getDenomPrefix(portId: string, channelId: string): string {
  return `${portId}/${channelId}/`;
}

// write function delete key of sort map by typescript
export const deleteKeySortMap = <K, V>(inputMap: Map<K, V>, deleteKey: K): Map<K, V> => {
  const updatedMap = new Map(inputMap);
  updatedMap.delete(deleteKey);
  return updatedMap;
};
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

export const prependToMap = <K, V>(map: Map<K, V>, key: K, val: V): Map<K, V> => {
  const newMap = new Map<K, V>([[key, val]]);
  for (const [k, v] of map) {
    newMap.set(k, v);
  }
  return newMap;
};
