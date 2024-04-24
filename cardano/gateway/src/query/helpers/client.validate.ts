import { GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import { QueryClientStateRequest, QueryConsensusStateRequest } from '@plus/proto-types/src/ibc/core/client/v1/query';
import { CLIENT_ID_PREFIX } from '../../constant';

export function validQueryClientStateParam(request: QueryClientStateRequest): QueryClientStateRequest {
  if (!request.client_id) throw new GrpcInvalidArgumentException('Invalid argument: "client_id" must be provided');
  // validate prefix client id
  if (!request.client_id.startsWith(`${CLIENT_ID_PREFIX}-`)) {
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "client_id". Please use the prefix "${CLIENT_ID_PREFIX}-"`,
    );
  }

  request.client_id = request.client_id.replace(`${CLIENT_ID_PREFIX}-`, '');
  return request;
}

export function validQueryConsensusStateParam(request: QueryConsensusStateRequest): QueryConsensusStateRequest {
  if (!request.client_id) throw new GrpcInvalidArgumentException('Invalid argument: "client_id" must be provided');
  // validate prefix client id
  if (!request.client_id.startsWith(`${CLIENT_ID_PREFIX}-`)) {
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "client_id". Please use the prefix "${CLIENT_ID_PREFIX}-"`,
    );
  }
  if (!request.height) {
    throw new GrpcInvalidArgumentException('Invalid argument: "height" must be provided');
  }

  request.client_id = request.client_id.replace(`${CLIENT_ID_PREFIX}-`, '');
  return request;
}
