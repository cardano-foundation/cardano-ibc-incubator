import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import type { status as GrpcStatusCode } from '@grpc/grpc-js';

type GrpcExceptionPayload = {
  message: string;
  code: GrpcStatusCode | number;
};

export const GATEWAY_GRPC_ERROR_CODE = {
  HEIGHT_NOT_FOUND: 'HEIGHT_NOT_FOUND',
  HEIGHT_NOT_ACCEPTED: 'HEIGHT_NOT_ACCEPTED',
  HISTORY_NOT_READY: 'HISTORY_NOT_READY',
  INVALID_TRUSTED_HEIGHT: 'INVALID_TRUSTED_HEIGHT',
} as const;

type GatewayGrpcErrorCode = (typeof GATEWAY_GRPC_ERROR_CODE)[keyof typeof GATEWAY_GRPC_ERROR_CODE];

export function gatewayGrpcError(
  code: GatewayGrpcErrorCode,
  message: string,
  details?: Record<string, string | number | boolean | null>,
) {
  return {
    code,
    message,
    ...(details ? { details } : {}),
  };
}

function errorObject(error: string | object, code: GrpcStatusCode): GrpcExceptionPayload {
  return {
    message: JSON.stringify({
      error,
      type: typeof error === 'string' ? 'string' : 'object',
      exceptionName: RpcException.name,
    }),
    code,
  };
}

export class GrpcInternalException extends RpcException {
  constructor(error: string | object) {
    super(errorObject(error, status.INTERNAL));
  }
}

export class GrpcFailedPreconditionException extends RpcException {
  constructor(error: string | object) {
    super(errorObject(error, status.FAILED_PRECONDITION));
  }
}

export class GrpcInvalidArgumentException extends RpcException {
  constructor(error: string | object) {
    super(errorObject(error, status.INVALID_ARGUMENT));
  }
}

export class GrpcNotFoundException extends RpcException {
  constructor(error: string | object) {
    super(errorObject(error, status.NOT_FOUND));
  }
}
