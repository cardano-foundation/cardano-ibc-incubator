import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import {
  MsgChannelOpenAck,
  MsgChannelOpenConfirm,
  MsgChannelOpenInit,
  MsgChannelOpenTry,
  MsgChannelCloseInit,
} from '@plus/proto-types/build/ibc/core/channel/v1/tx';
import { ChannelOpenInitOperator } from '../dto/channel/channel-open-init-operator.dto';
import { Order } from 'src/shared/types/channel/order';
import { ChannelOpenTryOperator } from '../dto/channel/channel-open-try-operator.dto';
import { ChannelCloseInitOperator } from '../dto/channel/channel-close-init-operator.dto';
import { decodeMerkleProof } from './helper';
import { MerkleProof } from '@plus/proto-types/build/ibc/core/commitment/v1/commitment';
import { initializeMerkleProof } from '@shared/helpers/merkle-proof';
import { ChannelOpenAckOperator } from '../dto/channel/channel-open-ack-operator.dto';
import { CHANNEL_ID_PREFIX } from 'src/constant';
import { ChannelOpenConfirmOperator } from '../dto/channel/channel-open-confirm-operator.dto';
import { Order as ChannelOrder } from '@plus/proto-types/build/ibc/core/channel/v1/channel';
export function validateAndFormatChannelOpenInitParams(data: MsgChannelOpenInit): {
  constructedAddress: string;
  channelOpenInitOperator: ChannelOpenInitOperator;
} {
  const constructedAddress: string = data.signer;
  if (!constructedAddress) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
  }
  if (data.channel.connection_hops.length == 0) {
    throw new GrpcInvalidArgumentException('Invalid connection id: Connection Id is not valid');
  }
  // if (['transfer'].includes(data.port_id.toLocaleLowerCase())) data.port_id = 'port-99';

  // if (['transfer'].includes(data.port_id.toLocaleLowerCase())) data.port_id = 'port-99';

  // Prepare the Channel open init operator object
  let orderingChannel: Order;
  switch (data.channel.ordering) {
    case ChannelOrder.ORDER_NONE_UNSPECIFIED:
      orderingChannel = Order.None;
      break;
    case ChannelOrder.ORDER_UNORDERED:
      orderingChannel = Order.Unordered;
      break;
    case ChannelOrder.ORDER_ORDERED:
      orderingChannel = Order.Ordered;
      break;
  }
  const channelOpenInitOperator: ChannelOpenInitOperator = {
    //TODO: check in channel.connection_hops
    connectionId: data.channel.connection_hops[0],
    counterpartyPortId: data.channel.counterparty.port_id,
    ordering: orderingChannel,
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
  if (data.channel.connection_hops.length == 0) {
    throw new GrpcInvalidArgumentException('Invalid connection id: Connection Id is not valid');
  }
  const decodedProofInitMsg: MerkleProof = decodeMerkleProof(data.proof_init);
  // if (['transfer'].includes(data.port_id.toLocaleLowerCase())) data.port_id = 'port-99';
  // Prepare the Channel open try operator object
  const channelOpenTryOperator: ChannelOpenTryOperator = {
    //TODO: check with connection_hops
    connectionId: data.channel.connection_hops[0],
    counterparty: data.channel.counterparty,
    ordering: Order.Unordered,
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
  if (!data.channel_id?.startsWith(`${CHANNEL_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
    );
  // if (['transfer'].includes(data.port_id.toLocaleLowerCase())) data.port_id = 'port-99';
  const channelSequence: string = data.channel_id.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');
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
  if (!data.channel_id?.startsWith(`${CHANNEL_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
    );
  const decodedProofTryMsg: MerkleProof = decodeMerkleProof(data.proof_ack);
  const channelSequence: string = data.channel_id.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');
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
  const channelSequence: string = data.channel_id.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');

  const channelCloseInitOperator: ChannelCloseInitOperator = {
    port_id: data.port_id,
    channel_id: channelSequence,
    signer: data.signer,
  };
  return { constructedAddress, channelCloseInitOperator };
}
