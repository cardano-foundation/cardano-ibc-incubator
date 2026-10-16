export function safeAdd(a: number, b: number): { sum: number; overflow: boolean } {
  if (b > 0 && a > Number.MAX_SAFE_INTEGER - b) {
    return { sum: -1, overflow: true };
  } else if (b < 0 && a < Number.MIN_SAFE_INTEGER - b) {
    return { sum: -1, overflow: true };
  }
  return { sum: a + b, overflow: false };
}

export function safeAddClip(a: number, b: number): number {
  const { sum, overflow } = safeAdd(a, b);
  if (overflow) {
    return b < 0 ? Number.MIN_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
  }
  return sum;
}
