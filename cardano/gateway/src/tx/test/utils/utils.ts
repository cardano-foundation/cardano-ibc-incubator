export const generateRandomString = ({ length }: { length: number }): string =>
  Array.from({ length }, (_) => Math.random().toString(36)[2]).join('');
