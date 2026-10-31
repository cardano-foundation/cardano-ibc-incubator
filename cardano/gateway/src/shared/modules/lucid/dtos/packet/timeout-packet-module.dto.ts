import type { UnsignedAckPacketModuleDto } from './ack-packet-module.dto';

export type UnsignedTimeoutPacketModuleDto = Omit<UnsignedAckPacketModuleDto, 'ackPacketPolicyId'> & {
  timeoutPacketPolicyId: string;
};
