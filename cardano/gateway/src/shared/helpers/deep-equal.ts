export function deepEquals(x: unknown, y: unknown): boolean {
  // Handle primitive types directly
  if (typeof x === typeof y) {
    switch (typeof x) {
      case 'string':
      case 'number':
      case 'boolean':
      case 'bigint':
        return x === y;
      default:
        break;
    }
  }

  // Handle null and undefined values
  if (x === null || y === null || x === undefined || y === undefined) {
    return x === y;
  }

  // Handle arrays using recursion
  if (Array.isArray(x) && Array.isArray(y)) {
    if (x.length !== y.length) {
      return false;
    }
    for (let i = 0; i < x.length; i++) {
      if (!deepEquals(x[i], y[i])) {
        return false;
      }
    }
    return true;
  }

  // Handle objects using a library like lodash or a custom implementation
  if (typeof x === 'object' && typeof y === 'object') {
    // You can use a library like lodash or write your own logic to compare object properties recursively
    return deepObjectEquals(x, y); // Placeholder function using a library or custom implementation
  }

  // For other types, consider throwing an error or returning false
  return false;
}

function deepObjectEquals(obj1: object, obj2: object): boolean {
  const record1 = obj1 as Record<string, unknown>;
  const record2 = obj2 as Record<string, unknown>;
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  // Check for length difference
  if (keys1.length !== keys2.length) {
    return false;
  }

  // Iterate through keys and compare values recursively
  for (const key of keys1) {
    if (!Object.prototype.hasOwnProperty.call(record2, key) || !deepEquals(record1[key], record2[key])) {
      return false;
    }
  }

  return true;
}
