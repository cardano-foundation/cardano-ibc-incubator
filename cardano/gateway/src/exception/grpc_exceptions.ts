import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import type { status as GrpcStatusCode } from '@grpc/grpc-js';

type GrpcExceptionPayload = {
  message: string;
  code: GrpcStatusCode | number;
};

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
