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

export function doubleToFraction(value: number): { numerator: number; denominator: number } {
  const tolerance = 1.0e-6;
  let h1 = 1;
  let h2 = 0;
  let k1 = 0;
  let k2 = 1;
  let b = value;
  do {
    const a = Math.floor(b);
    let aux = h1;
    h1 = a * h1 + h2;
    h2 = aux;
    aux = k1;
    k1 = a * k1 + k2;
    k2 = aux;
    b = 1 / (b - a);
  } while (Math.abs(value - h1 / k1) > value * tolerance);
  return { numerator: h1, denominator: k1 };
}
