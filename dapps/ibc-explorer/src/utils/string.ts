export const truncateString = (
  str: string,
  numStart: number,
  numEnd: number,
): string | undefined => {
  if (!str) return '';
  if (typeof numStart !== 'number' || typeof numEnd !== 'number') return str;
  if (str.length <= numStart + numEnd) {
    return str;
  }
  return str
    .slice(0, numStart)
    .concat('...')
    .concat(str.slice(str.length - numEnd));
};

export const formatUnixTimestamp = (
  unixTimestamp?: string,
  isHasYear?: boolean,
): string => {
  if (!unixTimestamp) return '--';
  const timeStampNumber = Number(unixTimestamp);
  if (!timeStampNumber || Number.isNaN(timeStampNumber)) return '--';
  const date = new Date(timeStampNumber * 1000); // Convert to milliseconds

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  if (isHasYear) {
    // Format and return the date as 'yyyy-mm-dd HH:mm:ss'
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
  // Format and return the date as 'mm-dd HH:mm:ss'
  return `${month}-${day} ${hours}:${minutes}:${seconds}`;
};

export const unixTimestampToDate = (unixTimestamp: string): Date => {
  if (!unixTimestamp) return new Date();
  const timeStampNumber = Number(unixTimestamp);
  if (!timeStampNumber || Number.isNaN(timeStampNumber)) return new Date();
  return new Date(timeStampNumber * 1000);
};

export const shortenAddress = (
  address?: string,
  numChars: number = 12,
): string => {
  if (!address) return '';

  if (typeof numChars !== 'number') return address;

  if (address.length <= numChars) {
    return address;
  }

  const start = address.slice(0, numChars);
  const end = address.slice(-numChars);

  return `${start}...${end}`;
};
