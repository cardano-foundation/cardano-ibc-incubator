import { ChannelCounterparty } from 'src/shared/types/channel/counterparty';
import { Order } from 'src/shared/types/channel/order';
import { Height } from 'src/shared/types/height';
import { MerkleProof } from '@shared/types/isc-23/merkle';

export type ChannelOpenTryOperator = {
  connectionId: string;
  counterparty: ChannelCounterparty;
  ordering: Order;
  version: string;
  port_id: string;
  counterpartyVersion: string;
  proofInit: MerkleProof; // hex string
  proofHeight: Height;
};
