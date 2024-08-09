import BigNumber from 'bignumber.js';

const capitalizeString = (str: string): string => {
  if (!str) return str;
  return str
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

const formatNumberInput = (
  input: string,
  exponent: number,
  maxAmount?: string,
): string => {
  const num = parseFloat(input);
  if (Number.isNaN(num)) {
    return '0';
  }
  if (maxAmount) {
    if (BigNumber(input).isGreaterThanOrEqualTo(BigNumber(maxAmount))) {
      return maxAmount;
    }
  }
  return num.toFixed(exponent);
};

export { capitalizeString, formatNumberInput };
