import {
  KEY_PACKET_ACK_PREFIX,
  KEY_PACKET_COMMITMENT_PREFIX,
  KEY_PACKET_RECEIPT_PREFIX,
  KEY_SEQUENCE_PREFIX,
} from '../../constant';
import { channelPathForPacket } from './channel';

export function packetReceiptPath(portId: string, channelId: string, sequence: bigint): string {
  return `${KEY_PACKET_RECEIPT_PREFIX}/${channelPathForPacket(portId, channelId)}/${KEY_SEQUENCE_PREFIX}/${sequence.toString()}`;
}

export function packetCommitmentPath(portId: string, channelId: string, sequence: bigint): string {
  return `${KEY_PACKET_COMMITMENT_PREFIX}/${channelPathForPacket(portId, channelId)}/${KEY_SEQUENCE_PREFIX}/${sequence.toString()}`;
}

export function packetAcknowledgementPath(portId: string, channelId: string, sequence: bigint): string {
  return `${KEY_PACKET_ACK_PREFIX}/${channelPathForPacket(portId, channelId)}/${KEY_SEQUENCE_PREFIX}/${sequence.toString()}`;
}
