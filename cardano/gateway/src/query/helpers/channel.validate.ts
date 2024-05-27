import { GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import { CHANNEL_ID_PREFIX, CONNECTION_ID_PREFIX } from '../../constant';
import {
  QueryChannelRequest,
  QueryConnectionChannelsRequest,
  QueryPacketAcknowledgementRequest,
  QueryPacketAcknowledgementsRequest,
  QueryPacketCommitmentRequest,
  QueryPacketCommitmentsRequest,
  QueryPacketReceiptRequest,
  QueryUnreceivedPacketsRequest,
  QueryUnreceivedAcksRequest,
  QueryProofUnreceivedPacketsRequest,
  QueryNextSequenceReceiveRequest,
} from '@plus/proto-types/build/ibc/core/channel/v1/query';
import { validPagination } from './helper';

export function validQueryChannelParam(request: QueryChannelRequest): QueryChannelRequest {
  if (!request.channel_id) throw new GrpcInvalidArgumentException('Invalid argument: "channel_id" must be provided');
  // validate prefix channel id
  if (!request.channel_id.startsWith(`${CHANNEL_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
    );

  request.channel_id = request.channel_id.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');

  return request;
}

export function validQueryConnectionChannelsParam(
  request: QueryConnectionChannelsRequest,
): QueryConnectionChannelsRequest {
  if (!request.connection) throw new GrpcInvalidArgumentException('Invalid argument: "connection" must be provided');
  // validate prefix connection id
  if (!request.connection.startsWith(`${CONNECTION_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "connection_id". Please use the prefix "${CONNECTION_ID_PREFIX}-"`,
    );
  request.pagination = validPagination(request.pagination);

  return request;
}

export function validQueryPacketAcknowledgementParam(
  request: QueryPacketAcknowledgementRequest,
): QueryPacketAcknowledgementRequest {
  if (!request.channel_id) throw new GrpcInvalidArgumentException('Invalid argument: "channel_id" must be provided');
  // validate prefix channel id
  if (!request.channel_id.startsWith(`${CHANNEL_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
    );

  if (!request.port_id) throw new GrpcInvalidArgumentException('Invalid argument: "port_id" must be provided');
  if (request.sequence < 0)
    throw new GrpcInvalidArgumentException('Invalid argument: "sequence" must be greater than 0');
  request.channel_id = request.channel_id.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');

  return request;
}

export function validQueryPacketAcknowledgementsParam(
  request: QueryPacketAcknowledgementsRequest,
): QueryPacketAcknowledgementsRequest {
  if (!request.channel_id) throw new GrpcInvalidArgumentException('Invalid argument: "channel_id" must be provided');
  // validate prefix channel id
  if (!request.channel_id.startsWith(`${CHANNEL_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
    );

  if (!request.port_id) throw new GrpcInvalidArgumentException('Invalid argument: "port_id" must be provided');
  request.channel_id = request.channel_id.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');
  request.pagination = validPagination(request.pagination);

  return request;
}

export function validQueryPacketCommitmentParam(request: QueryPacketCommitmentRequest): QueryPacketCommitmentRequest {
  if (!request.channel_id) throw new GrpcInvalidArgumentException('Invalid argument: "channel_id" must be provided');
  // validate prefix channel id
  if (!request.channel_id.startsWith(`${CHANNEL_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
    );
  if (!request.port_id) throw new GrpcInvalidArgumentException('Invalid argument: "port_id" must be provided');
  if (request.sequence < 0)
    throw new GrpcInvalidArgumentException('Invalid argument: "sequence" must be greater than 0');
  request.channel_id = request.channel_id.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');

  return request;
}

export function validQueryPacketCommitmentsParam(
  request: QueryPacketCommitmentsRequest,
): QueryPacketCommitmentsRequest {
  if (!request.channel_id) throw new GrpcInvalidArgumentException('Invalid argument: "channel_id" must be provided');
  // validate prefix channel id
  if (!request.channel_id.startsWith(`${CHANNEL_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
    );
  if (!request.port_id) throw new GrpcInvalidArgumentException('Invalid argument: "port_id" must be provided');

  request.channel_id = request.channel_id.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');
  request.pagination = validPagination(request.pagination);

  return request;
}

export function validQueryPacketReceiptParam(request: QueryPacketReceiptRequest): QueryPacketReceiptRequest {
  if (!request.channel_id) throw new GrpcInvalidArgumentException('Invalid argument: "channel_id" must be provided');
  // validate prefix channel id
  if (!request.channel_id.startsWith(`${CHANNEL_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
    );
  if (!request.port_id) throw new GrpcInvalidArgumentException('Invalid argument: "port_id" must be provided');
  if (request.sequence < 0)
    throw new GrpcInvalidArgumentException('Invalid argument: "sequence" must be greater than 0');
  request.channel_id = request.channel_id.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');

  return request;
}
export function validQueryProofUnreceivedPacketsParam(
  request: QueryProofUnreceivedPacketsRequest,
): QueryProofUnreceivedPacketsRequest {
  if (!request.channel_id) throw new GrpcInvalidArgumentException('Invalid argument: "channel_id" must be provided');
  // validate prefix channel id
  if (!request.channel_id.startsWith(`${CHANNEL_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
    );
  if (!request.port_id) throw new GrpcInvalidArgumentException('Invalid argument: "port_id" must be provided');
  if (request.sequence < 0)
    throw new GrpcInvalidArgumentException('Invalid argument: "sequence" must be greater than 0');
  if (request.revision_height < 0)
    throw new GrpcInvalidArgumentException('Invalid argument: "revision_height" must be greater than 0');

  request.channel_id = request.channel_id.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');

  return request;
}
// export function validQueryUnreceivedPacketsParam
export function validQueryUnreceivedPacketsParam(
  request: QueryUnreceivedPacketsRequest,
): QueryUnreceivedPacketsRequest {
  if (!request.channel_id) throw new GrpcInvalidArgumentException('Invalid argument: "channel_id" must be provided');
  // validate prefix channel id
  if (!request.channel_id.startsWith(`${CHANNEL_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
    );
  if (!request.port_id) throw new GrpcInvalidArgumentException('Invalid argument: "port_id" must be provided');
  if (!request.packet_commitment_sequences)
    throw new GrpcInvalidArgumentException('Invalid argument: "packet_commitment_sequences" must be provided');
  if (!request.packet_commitment_sequences?.length)
    throw new GrpcInvalidArgumentException('Invalid argument: "packet_commitment_sequences" must not empty');

  request.channel_id = request.channel_id.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');

  return request;
}

export function validQueryUnreceivedAcksParam(request: QueryUnreceivedAcksRequest): QueryUnreceivedAcksRequest {
  if (!request.channel_id) throw new GrpcInvalidArgumentException('Invalid argument: "channel_id" must be provided');
  // validate prefix channel id
  if (!request.channel_id.startsWith(`${CHANNEL_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
    );
  if (!request.port_id) throw new GrpcInvalidArgumentException('Invalid argument: "port_id" must be provided');
  if (!request.packet_ack_sequences)
    throw new GrpcInvalidArgumentException('Invalid argument: "packet_ack_sequences" must be provided');
  if (!request.packet_ack_sequences?.length)
    throw new GrpcInvalidArgumentException('Invalid argument: "packet_ack_sequences" must not empty');

  request.channel_id = request.channel_id.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');

  return request;
}

export function validQueryNextSequenceReceiveParam(
  request: QueryNextSequenceReceiveRequest,
): QueryNextSequenceReceiveRequest {
  if (!request.channel_id) throw new GrpcInvalidArgumentException('Invalid argument: "channel_id" must be provided');
  // validate prefix channel id
  if (!request.channel_id.startsWith(`${CHANNEL_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
    );
  if (!request.port_id) throw new GrpcInvalidArgumentException('Invalid argument: "port_id" must be provided');

  request.channel_id = request.channel_id.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');
    
  return request;
}