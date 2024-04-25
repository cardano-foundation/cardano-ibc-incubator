import { GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import { CHANNEL_ID_PREFIX, PORT_ID_PREFIX, TRANSFER_MODULE_PORT } from 'src/constant';
import { decodeMerkleProof } from './helper';
import { MerkleProof } from '@plus/proto-types/build/ibc/core/commitment/v1/commitment';
import { RecvPacketOperator } from '../dto/packet/recv-packet-operator.dto';
import { convertHex2String, convertString2Hex, toHex } from '@shared/helpers/hex';
import { initializeMerkleProof } from '@shared/helpers/merkle-proof';
import {
  MsgAcknowledgement,
  MsgRecvPacket,
  MsgTimeout,
  MsgTransfer,
} from '@plus/proto-types/build/ibc/core/channel/v1/tx';
import { SendPacketOperator } from '../dto/packet/send-packet-operator.dto';
import { FungibleTokenPacketDatum } from '@shared/types/apps/transfer/types/fungible-token-packet-data';
import { TimeoutPacketOperator } from '../dto/packet/time-out-packet-operator.dto';
import { AckPacketOperator } from '../dto/packet/ack-packet-operator.dto';

export function validateAndFormatRecvPacketParams(data: MsgRecvPacket): {
  constructedAddress: string;
  recvPacketOperator: RecvPacketOperator;
} {
  const constructedAddress: string = data.signer;
  if (!constructedAddress) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
  }
  if (!data.packet.destination_channel.startsWith(`${CHANNEL_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "destination_channel". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
    );
  if (data.packet.destination_port !== `${PORT_ID_PREFIX}-${TRANSFER_MODULE_PORT}`)
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "destination_port" ${data.packet.destination_port} not supported`,
    );
  const decodedProofCommitment: MerkleProof = decodeMerkleProof(data.proof_commitment);
  // Prepare the Recv packet operator object
  const recvPacketOperator: RecvPacketOperator = {
    channelId: data.packet.destination_channel,
    packetSequence: BigInt(data.packet.sequence),
    packetData: toHex(data.packet.data),
    proofCommitment: initializeMerkleProof(decodedProofCommitment),
    proofHeight: {
      revisionHeight: BigInt(data.proof_height?.revision_height || 0),
      revisionNumber: BigInt(data.proof_height?.revision_number || 0),
    },
    timeoutHeight: {
      revisionHeight: BigInt(data.packet.timeout_height?.revision_height || 0),
      revisionNumber: BigInt(data.packet.timeout_height?.revision_number || 0),
    },
    timeoutTimestamp: BigInt(data.packet?.timeout_timestamp || 0),
  };
  return { constructedAddress, recvPacketOperator };
}

export function validateAndFormatSendPacketParams(data: MsgTransfer): SendPacketOperator {
  if (!data.sender) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: sender is not valid');
  }
  if (!data.receiver) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: receiver is not valid');
  }
  if (!data.source_channel.startsWith(`${CHANNEL_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "source_channel". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
    );
  if (!data.signer) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: signer is not valid');
  }

  // Prepare the Recv packet operator object
  const sendPacketOperator: SendPacketOperator = {
    sourcePort: data.source_port,
    sourceChannel: data.source_channel,
    token: {
      denom: data.token.denom,
      amount: data.token.amount,
    },
    sender: data.sender,
    receiver: data.receiver,
    signer: data.signer,
    timeoutHeight: {
      revisionHeight: BigInt(data.timeout_height?.revision_height || 0),
      revisionNumber: BigInt(data.timeout_height?.revision_number || 0),
    },
    timeoutTimestamp: BigInt(data?.timeout_timestamp || 0),
    memo: data.memo,
  };
  return sendPacketOperator;
}

export function validateAndFormatTimeoutPacketParams(data: MsgTimeout): {
  constructedAddress: string;
  timeoutPacketOperator: TimeoutPacketOperator;
} {
  const constructedAddress: string = data.signer;
  if (!constructedAddress) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: sender is not valid');
  }
  if (!data.packet.source_channel?.startsWith(`${CHANNEL_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
    );
  const fungibleTokenPacketData: FungibleTokenPacketDatum = JSON.parse(convertHex2String(toHex(data.packet.data)));
  const decodedProofUnreceived: MerkleProof = decodeMerkleProof(data.proof_unreceived);
  // Prepare the timeoutPacketOperator object
  const timeoutPacketOperator: TimeoutPacketOperator = {
    fungibleTokenPacketData: fungibleTokenPacketData,
    proofUnreceived: initializeMerkleProof(decodedProofUnreceived),
    proofHeight: {
      revisionHeight: BigInt(data.proof_height?.revision_height || 0n),
      revisionNumber: BigInt(data.proof_height?.revision_number || 0n),
    },
    nextSequenceRecv: BigInt(data.next_sequence_recv) || 0n,
    packet: {
      sequence: BigInt(data.packet?.sequence || 0n),
      source_port: convertString2Hex(data.packet.source_port),
      source_channel: convertString2Hex(data.packet.source_channel),
      destination_port: convertString2Hex(data.packet.destination_port),
      destination_channel: convertString2Hex(data.packet.destination_channel),
      data: toHex(data.packet.data),
      timeout_height: {
        revisionHeight: BigInt(data.packet.timeout_height?.revision_height || 0n),
        revisionNumber: BigInt(data.packet.timeout_height?.revision_number || 0n),
      },
      timeout_timestamp: BigInt(data.packet?.timeout_timestamp || 0n),
    },
  };
  return { constructedAddress, timeoutPacketOperator };
}

export function validateAndFormatAcknowledgementPacketParams(data: MsgAcknowledgement): {
  constructedAddress: string;
  ackPacketOperator: AckPacketOperator;
} {
  const constructedAddress: string = data.signer;
  if (!constructedAddress) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
  }
  if (!data.packet.source_channel.startsWith(`${CHANNEL_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "source_channel". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
    );
  if (data.packet.source_port !== `${PORT_ID_PREFIX}-${TRANSFER_MODULE_PORT}`)
    throw new GrpcInvalidArgumentException(`Invalid argument: "source_port" ${data.packet.source_port} not supported`);

  // Prepare the Recv packet operator object
  const decodedProofAcked: MerkleProof = decodeMerkleProof(data.proof_acked);
  const ackPacketOperator: AckPacketOperator = {
    channelId: data.packet.source_channel,
    packetSequence: BigInt(data.packet.sequence),
    packetData: toHex(data.packet.data),
    proofHeight: {
      revisionHeight: BigInt(data.proof_height?.revision_height || 0),
      revisionNumber: BigInt(data.proof_height?.revision_number || 0),
    },
    proofAcked: initializeMerkleProof(decodedProofAcked),
    acknowledgement: toHex(data.acknowledgement),
    timeoutHeight: {
      revisionHeight: BigInt(data.packet.timeout_height?.revision_height || 0),
      revisionNumber: BigInt(data.packet.timeout_height?.revision_number || 0),
    },
    timeoutTimestamp: BigInt(data.packet?.timeout_timestamp || 0),
  };
  return { constructedAddress, ackPacketOperator };
}
