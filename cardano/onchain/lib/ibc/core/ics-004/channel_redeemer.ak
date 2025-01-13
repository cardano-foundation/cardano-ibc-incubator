use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}

pub type MintChannelRedeemer {
  ChanOpenInit { handler_token: AuthToken }
  ChanOpenTry {
    handler_token: AuthToken,
    counterparty_version: ByteArray,
    proof_init: MerkleProof,
    proof_height: Height,
  }
}

pub type SpendChannelRedeemer {
  ChanOpenAck {
    counterparty_version: ByteArray,
    proof_try: MerkleProof,
    proof_height: Height,
  }
  ChanOpenConfirm { proof_ack: MerkleProof, proof_height: Height }
  RecvPacket {
    packet: Packet,
    proof_commitment: MerkleProof,
    proof_height: Height,
  }
  TimeoutPacket {
    packet: Packet,
    proof_unreceived: MerkleProof,
    proof_height: Height,
    next_sequence_recv: Int,
  }
  AcknowledgePacket {
    packet: Packet,
    acknowledgement: ByteArray,
    proof_acked: MerkleProof,
    proof_height: Height,
  }
  SendPacket { packet: Packet }
  ChanCloseInit
  ChanCloseConfirm { proof_init: MerkleProof, proof_height: Height }
  RefreshUtxo
}
