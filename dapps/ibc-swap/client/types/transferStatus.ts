export type TransferLifecyclePhase =
  | 'source_tx_pending'
  | 'send_packet_indexed'
  | 'recv_packet_observed'
  | 'write_acknowledgement_observed'
  | 'acknowledge_packet_observed'
  | 'timeout_observed'
  | 'failed'
  | 'unsupported';

export type IbcPacketSummary = {
  sequence: string;
  sourcePort: string;
  sourceChannel: string;
  destinationPort: string;
  destinationChannel: string;
  dataHex: string;
  acknowledgementHex?: string;
};

export type TransferObservedEvent = {
  chainId: string;
  type: string;
  txHash?: string;
  height?: string;
  packet: IbcPacketSummary;
  acknowledgementHex?: string;
};

export type TransferPacketHopStatus =
  | 'pending_send'
  | 'sent'
  | 'received'
  | 'acknowledgement_written'
  | 'acknowledged'
  | 'timed_out';

export type TransferPacketHop = {
  index: number;
  sourceChainId: string;
  destinationChainId: string;
  status: TransferPacketHopStatus;
  packet: IbcPacketSummary;
  send?: TransferObservedEvent;
  recv?: TransferObservedEvent;
  writeAcknowledgement?: TransferObservedEvent;
  acknowledge?: TransferObservedEvent;
  timeout?: TransferObservedEvent;
};

export type TransferStatusResponse = {
  status: TransferLifecyclePhase;
  message: string;
  sourceTxHash: string;
  sourceChainId: string;
  destinationChainId: string;
  routeChainIds: string[];
  packets: TransferPacketHop[];
  updatedAt: string;
  error?: string;
};
