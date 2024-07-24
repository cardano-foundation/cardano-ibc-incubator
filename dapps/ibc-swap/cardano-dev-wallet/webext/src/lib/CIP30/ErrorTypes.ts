// Error Types

type PaginateError = {
  maxSize: number;
};

type APIError = {
  code: APIErrorCode;
  info: string;
};

type DataSignError = {
  code: DataSignErrorCode;
  info: string;
};

type TxSendError = {
  code: TxSendErrorCode;
  info: string;
};

type TxSignError = {
  code: TxSignErrorCode;
  info: string;
};

enum APIErrorCode {
  InvalidRequest = -1,
  InternalError = -2,
  Refused = -3,
  AccountChange = -4,
}

enum DataSignErrorCode {
  ProofGeneration = 1,
  AddressNotPK = 2,
  UserDeclined = 3,
}

enum TxSendErrorCode {
  Refused = 1,
  Failure = 2,
}

enum TxSignErrorCode {
  ProofGeneration = 1,
  UserDeclined = 2,
}

export type {
  PaginateError,
  APIError,
  DataSignError,
  TxSendError,
  TxSignError,
};

export { APIErrorCode, DataSignErrorCode, TxSendErrorCode, TxSignErrorCode };
