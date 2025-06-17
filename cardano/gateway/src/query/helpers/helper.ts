import { PageRequest } from '@plus/proto-types/build/cosmos/base/query/v1beta1/pagination';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';

export function validPagination(pagination: PageRequest): PageRequest {
  // if (pagination.offset == undefined && !pagination.key)
  //   throw new GrpcInvalidArgumentException(
  //     'Invalid argument: "pagination.offset" or "pagination.key" must be provided',
  //   );

  if (!pagination.limit)
    throw new GrpcInvalidArgumentException('Invalid argument: "pagination.limit" must be provided');
  return pagination;
}
