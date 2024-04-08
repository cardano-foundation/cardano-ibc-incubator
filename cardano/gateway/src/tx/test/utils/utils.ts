export const generateRandomString = ({ length: length }) =>
  Array.from({ length }, (_) => Math.random().toString(36)[2]).join('');
