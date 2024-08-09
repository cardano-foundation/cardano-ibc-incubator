const capitalizeString = (str: string): string => {
  if (!str) return str;
  return str
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

const formatNumberInput = (input: string, exponent: number): string => {
  const num = parseFloat(input);
  if (Number.isNaN(num)) {
    return '0';
  }
  return num.toFixed(exponent);
};

export { capitalizeString, formatNumberInput };
