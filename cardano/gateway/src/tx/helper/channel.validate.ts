import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import {
  MsgChannelCloseConfirm,
  MsgChannelOpenAck,
  MsgChannelOpenConfirm,
  MsgChannelOpenInit,
  MsgChannelOpenTry,
  MsgChannelCloseInit,
} from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/tx';
import { ChannelCloseConfirmOperator } from '../dto/channel/channel-close-confirm-operator.dto';
import { ChannelOpenInitOperator } from '../dto/channel/channel-open-init-operator.dto';
import { Order } from 'src/shared/types/channel/order';
import { ChannelOpenTryOperator } from '../dto/channel/channel-open-try-operator.dto';
import { ChannelCloseInitOperator } from '../dto/channel/channel-close-init-operator.dto';
import { decodeMerkleProof } from './helper';
import { MerkleProof } from '@cardano-ibc/proto-types/build/ibc/core/commitment/v1/commitment';
import { initializeMerkleProof } from '@shared/helpers/merkle-proof';
import { ChannelOpenAckOperator } from '../dto/channel/channel-open-ack-operator.dto';
import { CHANNEL_ID_PREFIX, CONNECTION_ID_PREFIX } from 'src/constant';
import { ChannelOpenConfirmOperator } from '../dto/channel/channel-open-confirm-operator.dto';
import { Order as ChannelOrder } from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/channel';

function validateChannelOrdering(ordering: ChannelOrder): Order {
  switch (ordering) {
    case ChannelOrder.ORDER_UNORDERED:
      return Order.Unordered;
    case ChannelOrder.ORDER_ORDERED:
      return Order.Ordered;
    default:
      throw new GrpcInvalidArgumentException('Invalid argument: "channel.ordering" must be ordered or unordered');
  }
}

function validateIdentifierSequence(identifier: string, prefix: string, field: string): string {
  const prefixWithSeparator = `${prefix}-`;
  const sequence = identifier?.startsWith(prefixWithSeparator) ? identifier.slice(prefixWithSeparator.length) : '';
  if (!/^(0|[1-9][0-9]*)$/.test(sequence)) {
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "${field}" must be ${prefix}-{sequence} with a non-negative decimal sequence and no leading zeros`,
    );
  }
  return sequence;
}

function validateConnectionHops(connectionHops: string[]): string {
  if (connectionHops?.length !== 1) {
    throw new GrpcInvalidArgumentException(
      'Invalid argument: "channel.connection_hops" must contain exactly one connection',
    );
  }
  const connectionId = connectionHops[0];
  validateIdentifierSequence(connectionId, CONNECTION_ID_PREFIX, 'channel.connection_hops[0]');
  return connectionId;
}

export function validateAndFormatChannelOpenInitParams(data: MsgChannelOpenInit): {
  constructedAddress: string;
  channelOpenInitOperator: ChannelOpenInitOperator;
} {
  const constructedAddress: string = data.signer;
  if (!constructedAddress) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
  }
  const connectionId = validateConnectionHops(data.channel.connection_hops);
  const ordering = validateChannelOrdering(data.channel.ordering);
  // Prepare the Channel open init operator object
  const channelOpenInitOperator: ChannelOpenInitOperator = {
    connectionId,
    counterpartyPortId: data.channel.counterparty.port_id,
    ordering,
    version: data.channel.version,
    port_id: data.port_id,
  };
  return { constructedAddress, channelOpenInitOperator };
}
export function validateAndFormatChannelOpenTryParams(data: MsgChannelOpenTry): {
  constructedAddress: string;
  channelOpenTryOperator: ChannelOpenTryOperator;
} {
  const constructedAddress: string = data.signer;
  if (!constructedAddress) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
  }
  const connectionId = validateConnectionHops(data.channel.connection_hops);
  const ordering = validateChannelOrdering(data.channel.ordering);
  const decodedProofInitMsg: MerkleProof = decodeMerkleProof(data.proof_init);
  // Prepare the Channel open try operator object
  const channelOpenTryOperator: ChannelOpenTryOperator = {
    connectionId,
    counterparty: data.channel.counterparty,
    ordering,
    version: data.channel.version,
    port_id: data.port_id,
    counterpartyVersion: data.counterparty_version,
    proofInit: initializeMerkleProof(decodedProofInitMsg), // hex string

    proofHeight: {
      revisionHeight: BigInt(data.proof_height?.revision_height || 0n),
      revisionNumber: BigInt(data.proof_height?.revision_number || 0n),
    },
  };
  return { constructedAddress, channelOpenTryOperator };
}
export function validateAndFormatChannelOpenAckParams(data: MsgChannelOpenAck): {
  constructedAddress: string;
  channelOpenAckOperator: ChannelOpenAckOperator;
} {
  const constructedAddress: string = data.signer;
  if (!constructedAddress) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
  }
  const channelSequence = validateIdentifierSequence(data.channel_id, CHANNEL_ID_PREFIX, 'channel_id');
  const decodedProofTryMsg: MerkleProof = decodeMerkleProof(data.proof_try);
  // Prepare the Channel open ack operator object
  const channelOpenAckOperator: ChannelOpenAckOperator = {
    channelSequence: channelSequence,
    counterpartyChannelId: data.counterparty_channel_id,
    counterpartyVersion: data.counterparty_version,
    proofTry: initializeMerkleProof(decodedProofTryMsg), // hex string
    proofHeight: {
      revisionHeight: BigInt(data.proof_height?.revision_height || 0n),
      revisionNumber: BigInt(data.proof_height?.revision_number || 0n),
    },
  };
  return { constructedAddress, channelOpenAckOperator };
}
export function validateAndFormatChannelOpenConfirmParams(data: MsgChannelOpenConfirm): {
  constructedAddress: string;
  channelOpenConfirmOperator: ChannelOpenConfirmOperator;
} {
  const constructedAddress: string = data.signer;
  if (!constructedAddress) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
  }
  const channelSequence = validateIdentifierSequence(data.channel_id, CHANNEL_ID_PREFIX, 'channel_id');
  const decodedProofTryMsg: MerkleProof = decodeMerkleProof(data.proof_ack);
  // Prepare the Channel open init operator object
  const channelOpenConfirmOperator: ChannelOpenConfirmOperator = {
    //TODO: recheck
    channelSequence: channelSequence,
    proofAck: initializeMerkleProof(decodedProofTryMsg),
    proofHeight: {
      revisionHeight: BigInt(data.proof_height?.revision_height || 0n),
      revisionNumber: BigInt(data.proof_height?.revision_number || 0n),
    },
  };
  return { constructedAddress, channelOpenConfirmOperator };
}
export function validateAndFormatChannelCloseInitParams(data: MsgChannelCloseInit): {
  constructedAddress: string;
  channelCloseInitOperator: ChannelCloseInitOperator;
} {
  const constructedAddress: string = data.signer;
  if (!constructedAddress) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
  }
  const channelSequence = validateIdentifierSequence(data.channel_id, CHANNEL_ID_PREFIX, 'channel_id');

  const channelCloseInitOperator: ChannelCloseInitOperator = {
    port_id: data.port_id,
    channel_id: channelSequence,
    signer: data.signer,
  };
  return { constructedAddress, channelCloseInitOperator };
}

export function validateAndFormatChannelCloseConfirmParams(data: MsgChannelCloseConfirm): {
  constructedAddress: string;
  channelCloseConfirmOperator: ChannelCloseConfirmOperator;
} {
  const constructedAddress: string = data.signer;
  if (!constructedAddress) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
  }
  const channelSequence = validateIdentifierSequence(data.channel_id, CHANNEL_ID_PREFIX, 'channel_id');
  const decodedProofInitMsg: MerkleProof = decodeMerkleProof(data.proof_init);

  const channelCloseConfirmOperator: ChannelCloseConfirmOperator = {
    port_id: data.port_id,
    channelSequence,
    proofInit: initializeMerkleProof(decodedProofInitMsg),
    proofHeight: {
      revisionHeight: BigInt(data.proof_height?.revision_height || 0n),
      revisionNumber: BigInt(data.proof_height?.revision_number || 0n),
    },
  };

  return { constructedAddress, channelCloseConfirmOperator };
}
