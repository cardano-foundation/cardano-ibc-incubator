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
} from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/query';
import { validPagination } from './helper';
import { GrpcInvalidArgumentException, GrpcNotFoundException } from '~@/exception/grpc_exceptions';
import { convertHex2String } from '../../shared/helpers/hex';
import { validateIdentifierSequence } from '../../tx/helper/channel.validate';

// ICS-024 port identifier rule, as enforced on-chain by `port_identifier_validator`.
const PORT_ID_PATTERN = /^[A-Za-z0-9._+#[\]<>-]{2,128}$/;

/** Validates the requested port/channel pair and returns the channel sequence. */
export function validChannelIdentifiers(request: { port_id: string; channel_id: string }): string {
  if (!PORT_ID_PATTERN.test(request.port_id ?? ''))
    throw new GrpcInvalidArgumentException(
      'Invalid argument: "port_id" must be 2-128 letters, digits, or characters from ._+-#[]<>',
    );
  return validateIdentifierSequence(request.channel_id, CHANNEL_ID_PREFIX, 'channel_id');
}

/** Channel tokens are keyed by sequence alone, so a channel bound to another port is not found. */
export function assertChannelBoundToPort(storedPortHex: string, portId: string, channelSequence: string): void {
  if (convertHex2String(storedPortHex) !== portId)
    throw new GrpcNotFoundException(`${CHANNEL_ID_PREFIX}-${channelSequence} is not bound to port ${portId}`);
}

export function validQueryChannelParam(request: QueryChannelRequest): QueryChannelRequest {
  request.channel_id = validChannelIdentifiers(request);

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
  request.channel_id = validChannelIdentifiers(request);
  if (request.sequence < 0)
    throw new GrpcInvalidArgumentException('Invalid argument: "sequence" must be greater than 0');

  return request;
}

export function validQueryPacketAcknowledgementsParam(
  request: QueryPacketAcknowledgementsRequest,
): QueryPacketAcknowledgementsRequest {
  request.channel_id = validChannelIdentifiers(request);
  request.pagination = validPagination(request.pagination);

  return request;
}

export function validQueryPacketCommitmentParam(request: QueryPacketCommitmentRequest): QueryPacketCommitmentRequest {
  request.channel_id = validChannelIdentifiers(request);
  if (request.sequence < 0)
    throw new GrpcInvalidArgumentException('Invalid argument: "sequence" must be greater than 0');

  return request;
}

export function validQueryPacketCommitmentsParam(
  request: QueryPacketCommitmentsRequest,
): QueryPacketCommitmentsRequest {
  request.channel_id = validChannelIdentifiers(request);
  request.pagination = validPagination(request.pagination);

  return request;
}

export function validQueryPacketReceiptParam(request: QueryPacketReceiptRequest): QueryPacketReceiptRequest {
  request.channel_id = validChannelIdentifiers(request);
  if (request.sequence < 0)
    throw new GrpcInvalidArgumentException('Invalid argument: "sequence" must be greater than 0');

  return request;
}
export function validQueryProofUnreceivedPacketsParam(
  request: QueryProofUnreceivedPacketsRequest,
): QueryProofUnreceivedPacketsRequest {
  request.channel_id = validChannelIdentifiers(request);
  if (request.sequence < 0)
    throw new GrpcInvalidArgumentException('Invalid argument: "sequence" must be greater than 0');
  if (request.revision_height < 0)
    throw new GrpcInvalidArgumentException('Invalid argument: "revision_height" must be greater than 0');

  return request;
}
// export function validQueryUnreceivedPacketsParam
export function validQueryUnreceivedPacketsParam(
  request: QueryUnreceivedPacketsRequest,
): QueryUnreceivedPacketsRequest {
  request.channel_id = validChannelIdentifiers(request);
  if (!request.packet_commitment_sequences)
    throw new GrpcInvalidArgumentException('Invalid argument: "packet_commitment_sequences" must be provided');
  if (!request.packet_commitment_sequences?.length)
    throw new GrpcInvalidArgumentException('Invalid argument: "packet_commitment_sequences" must not empty');

  return request;
}

export function validQueryUnreceivedAcksParam(request: QueryUnreceivedAcksRequest): QueryUnreceivedAcksRequest {
  request.channel_id = validChannelIdentifiers(request);
  if (!request.packet_ack_sequences)
    throw new GrpcInvalidArgumentException('Invalid argument: "packet_ack_sequences" must be provided');
  if (!request.packet_ack_sequences?.length)
    throw new GrpcInvalidArgumentException('Invalid argument: "packet_ack_sequences" must not empty');

  return request;
}
export function validQueryNextSequenceReceiveParam(
  request: QueryNextSequenceReceiveRequest,
): QueryNextSequenceReceiveRequest {
  request.channel_id = validChannelIdentifiers(request);

  return request;
}
