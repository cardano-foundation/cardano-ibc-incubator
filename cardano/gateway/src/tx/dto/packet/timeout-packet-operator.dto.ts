import { FungibleTokenPacketDatum } from '@shared/types/apps/transfer/types/fungible-token-packet-data';
import { Packet } from '@shared/types/channel/packet';
import { Height } from '@shared/types/height';
import { MerkleProof } from '@shared/types/isc-23/merkle';

export type TimeoutPacketOperator = {
  fungibleTokenPacketData: FungibleTokenPacketDatum;
  proofUnreceived: MerkleProof;
  proofHeight: Height;
  nextSequenceRecv: bigint;
  packet: Packet;
};
