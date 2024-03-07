import { QueryConnectionRequest } from '@cosmjs-types/src/ibc/core/connection/v1/query';
import { GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import { CONNECTION_ID_PREFIX } from '../../constant';

export function validQueryConnectionParam(request: QueryConnectionRequest): QueryConnectionRequest {
  if (!request.connection_id)
    throw new GrpcInvalidArgumentException('Invalid argument: "connection_id" must be provided');
  // validate prefix connection id
  if (!request.connection_id.startsWith(`${CONNECTION_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "connection_id". Please use the prefix "${CONNECTION_ID_PREFIX}-"`,
    );

  request.connection_id = request.connection_id.replaceAll(`${CONNECTION_ID_PREFIX}-`, '');

  return request;
}
