import { toHex } from './hex';

// private initializeProof(proofSpecs: ProofSpec) {}
export function convertToProofType(obj: any, isTopLevel: boolean = true): any {
  const uint8ArrayToString = (uint8Array: Uint8Array): string => toHex(uint8Array);

  if (obj === null || typeof obj !== 'object') {
    return typeof obj === 'number' ? BigInt(obj) : obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => convertToProofType(item, isTopLevel));
  }

  if (obj instanceof Uint8Array) {
    return uint8ArrayToString(obj);
  }

  const newObj = Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, convertToProofType(value, false)]));

  if (isTopLevel) {
    newObj.prehash_key_before_comparison = false;
  }

  return newObj;
}
