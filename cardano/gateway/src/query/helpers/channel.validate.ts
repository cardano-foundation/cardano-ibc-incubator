import { GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import { CHANNEL_ID_PREFIX, CONNECTION_ID_PREFIX } from '../../constant';
import {
  QueryChannelRequest,
  QueryConnectionChannelsRequest,
  QueryPacketAcknowledgementRequest,
  QueryPacketAcknowledgementsRequest,
  QueryPacketCommitmentRequest,
  QueryPacketCommitmentsRequest,
} from '@cosmjs-types/src/ibc/core/channel/v1/query';
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

  request.channel_id = request.channel_id.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');
  request.pagination = validPagination(request.pagination);

  return request;
}
