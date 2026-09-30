use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/types/packet.{Packet}

pub type MintChannelRedeemer {
  ChanOpenInit
  ChanOpenTry {
    counterparty_version: ByteArray,
    proof_init: Data,
    proof_height: Height,
  }
}

pub type SpendChannelRedeemer {
  ChanOpenAck {
    counterparty_version: ByteArray,
    proof_try: Data,
    proof_height: Height,
  }
  ChanOpenConfirm { proof_ack: Data, proof_height: Height }
  RecvPacket { packet: Packet, proof_commitment: Data, proof_height: Height }
  TimeoutPacket {
    packet: Packet,
    proof_unreceived: Data,
    proof_height: Height,
    next_sequence_recv: Int,
  }
  AcknowledgePacket {
    packet: Packet,
    acknowledgement: ByteArray,
    proof_acked: Data,
    proof_height: Height,
  }
  SendPacket { packet: Packet }
  ChanCloseInit
  ChanCloseConfirm { proof_init: Data, proof_height: Height }
  PrunePacketHistory {
    sequence: Int,
    proof_commitment_absence: Data,
    proof_height: Height,
  }
  TimeoutOnClose {
    packet: Packet,
    proof_unreceived: Data,
    proof_close: Data,
    proof_height: Height,
    next_sequence_recv: Int,
  }
  ReclaimChannel
}
