/* global BigInt */

const capitalizeString = (str: string): string => {
  if (!str) return str;
  return str
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

const DECIMAL_INPUT_REGEX = /^(?:\d+|\d*\.\d*)$/;
const INTEGER_AMOUNT_REGEX = /^\d+$/;

const normalizeTokenExponent = (exponent?: number): number => {
  if (!Number.isInteger(exponent) || !exponent || exponent < 0) {
    return 0;
  }
  return exponent;
};

const stripLeadingZeros = (value: string): string =>
  value.replace(/^0+(?=\d)/, '') || '0';

// Chain-facing amounts stay as exact base-unit integer strings.
const normalizeDecimalInput = (input: string): string | null => {
  const normalized = input.trim().replace(',', '.');
  if (!normalized) return '';
  if (!DECIMAL_INPUT_REGEX.test(normalized)) return null;
  return normalized;
};

const decimalDisplayToBaseAmount = (
  displayAmount: string,
  exponent: number,
): string | null => {
  const normalized = normalizeDecimalInput(displayAmount);
  if (!normalized) return null;

  const tokenExponent = normalizeTokenExponent(exponent);
  const [wholeInput = '', fractionalInput = ''] = normalized.split('.');
  if (fractionalInput.length > tokenExponent) {
    return null;
  }

  const whole = stripLeadingZeros(wholeInput || '0');
  const fractional = fractionalInput.padEnd(tokenExponent, '0');
  const baseAmount = stripLeadingZeros(`${whole}${fractional}`);

  return INTEGER_AMOUNT_REGEX.test(baseAmount) ? baseAmount : null;
};

const baseAmountToDisplayAmount = (
  baseAmount: string,
  exponent: number,
): string => {
  const normalizedBase = baseAmount.trim();
  if (!INTEGER_AMOUNT_REGEX.test(normalizedBase)) {
    return '0';
  }

  const tokenExponent = normalizeTokenExponent(exponent);
  const base = stripLeadingZeros(normalizedBase);
  if (tokenExponent === 0) {
    return base;
  }

  const paddedBase = base.padStart(tokenExponent + 1, '0');
  const whole = stripLeadingZeros(paddedBase.slice(0, -tokenExponent));
  const fractional = paddedBase.slice(-tokenExponent).replace(/0+$/, '');

  return fractional ? `${whole}.${fractional}` : whole;
};

const isPositiveBaseAmount = (
  baseAmount?: string | null,
): baseAmount is string => {
  if (!baseAmount || !INTEGER_AMOUNT_REGEX.test(baseAmount)) {
    return false;
  }
  return BigInt(baseAmount) > BigInt(0);
};

const isBaseAmountWithinBalance = (
  baseAmount?: string | null,
  balance?: string,
): baseAmount is string => {
  if (
    !baseAmount ||
    !INTEGER_AMOUNT_REGEX.test(baseAmount) ||
    !balance ||
    !INTEGER_AMOUNT_REGEX.test(balance)
  ) {
    return false;
  }
  return BigInt(baseAmount) <= BigInt(balance);
};

const formatNumberInput = (
  input: string,
  exponent: number,
  maxAmount?: string,
): string => {
  const normalized = normalizeDecimalInput(input);
  if (normalized === null) {
    return '';
  }
  if (!normalized) {
    return '';
  }

  const tokenExponent = normalizeTokenExponent(exponent);
  const hasDecimalPoint = normalized.includes('.');
  const [wholeInput = '', fractionalInput = ''] = normalized.split('.');
  const whole = stripLeadingZeros(wholeInput || '0');
  const fractional =
    tokenExponent > 0 ? fractionalInput.slice(0, tokenExponent) : '';
  const display =
    tokenExponent > 0 && hasDecimalPoint ? `${whole}.${fractional}` : whole;

  const baseAmount = decimalDisplayToBaseAmount(display, tokenExponent);
  if (
    baseAmount &&
    maxAmount &&
    INTEGER_AMOUNT_REGEX.test(maxAmount) &&
    BigInt(baseAmount) > BigInt(maxAmount)
  ) {
    return baseAmountToDisplayAmount(maxAmount, tokenExponent);
  }

  return display;
};

function formatPrice(price?: string): string {
  if (!price) return '';
  return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const formatTokenSymbol = (symbol: string): string => {
  if (symbol.length <= 10) {
    return symbol.toUpperCase();
  }
  return symbol
    .slice(0, 4)
    .concat('...')
    .concat(symbol.slice(symbol.length - 3))
    .toUpperCase();
};

const getPathTrace = (path: string) => {
  const steps = path.split('/');
  if (steps.length % 2 !== 0) {
    return [];
  }
  const tmp = [];
  for (let index = 0; index < steps.length; index += 2) {
    tmp.push(`${steps[index]}/${steps[index + 1]}`);
  }
  return tmp;
};

export {
  baseAmountToDisplayAmount,
  capitalizeString,
  decimalDisplayToBaseAmount,
  formatNumberInput,
  formatPrice,
  formatTokenSymbol,
  getPathTrace,
  isBaseAmountWithinBalance,
  isPositiveBaseAmount,
};
