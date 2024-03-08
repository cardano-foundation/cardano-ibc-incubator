import { PageRequest } from '@cosmjs-types/src/cosmos/base/query/v1beta1/pagination';
import { GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';

export function validPagination(pagination: PageRequest): PageRequest {
  // if (pagination.offset == undefined && !pagination.key)
  //   throw new GrpcInvalidArgumentException(
  //     'Invalid argument: "pagination.offset" or "pagination.key" must be provided',
  //   );

  if (!pagination.limit)
    throw new GrpcInvalidArgumentException('Invalid argument: "pagination.limit" must be provided');
  return pagination;
}
