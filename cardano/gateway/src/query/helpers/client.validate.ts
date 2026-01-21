import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { QueryClientStateRequest, QueryConsensusStateRequest } from '@plus/proto-types/src/ibc/core/client/v1/query';
import { CLIENT_ID_PREFIX } from '../../constant';

/**
 * IMPORTANT: Understanding "Query Height" vs "Consensus Height"
 * =====================================================================
 * This pattern can look confusing at first.
 * There are two different "heights" in IBC queries that serve different purposes:
 * 
 * 1. QUERY HEIGHT (state snapshot height)
 *    - "Which version of this chain's state tree do you want to read from?"
 *    - In Cosmos SDK gRPC, this is NOT a field in the protobuf request
 *    - It's passed as gRPC metadata (commonly `x-cosmos-block-height`)
 *    - If omitted, the standard convention is to use "latest committed state"
 *    - Hermes follows this convention: QueryHeight::Latest omits the header
 * 
 * 2. CONSENSUS HEIGHT (counterparty height / data identifier)
 *    - "Which specific consensus state entry do you want?"
 *    - This IS an explicit field in requests like QueryConsensusStateRequest
 *    - It identifies a specific piece of data (consensus state at revision X)
 *    - Example: revision_number/revision_height fields
 * 
 * The Gateway implements IBC-compatible behavior:
 * - Query height: Optional, defaults to latest (standard Cosmos/Hermes behavior)
 * - Consensus height: Can be 0 to mean "latest consensus state for this client"
 */

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
  // Note: height (consensus height) is optional here.
  // If not provided or 0, the service will use the latest consensus state.
  // This is the "consensus height" (which specific consensus state entry),
  // not the "query height" (which state snapshot to read from).

  request.client_id = request.client_id.replace(`${CLIENT_ID_PREFIX}-`, '');
  return request;
}
