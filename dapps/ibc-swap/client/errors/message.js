import { ERROR_CODE } from './code';

export const getMessage = (code) => {
  switch (code) {
    case ERROR_CODE.BAD_REQUEST:
      return 'badRequest';
    case ERROR_CODE.UNAUTHORIZED:
      return 'unauthorized';
    case ERROR_CODE.USER_REJECTED_REQUEST:
      return 'userRejectedRequest';
    default:
      return '';
  }
};
