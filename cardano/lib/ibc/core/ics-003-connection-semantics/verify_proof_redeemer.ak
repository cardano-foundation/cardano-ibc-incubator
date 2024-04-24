use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatumState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}

pub type VerifyProofRedeemer {
  VerifyChannelState {
    client_datum_state: ClientDatumState,
    connection: ConnectionEnd,
    port_id: ByteArray,
    channel_id: ByteArray,
    proof: MerkleProof,
    proof_height: Height,
    channel: Channel,
  }

  VerifyPacketCommitment {
    client_datum_state: ClientDatumState,
    connection: ConnectionEnd,
    proof_height: Height,
    proof: MerkleProof,
    port_id: ByteArray,
    channel_id: ByteArray,
    sequence: Int,
    commitment_bytes: ByteArray,
  }

  VerifyPacketAcknowledgement {
    client_datum_state: ClientDatumState,
    connection: ConnectionEnd,
    proof_height: Height,
    proof: MerkleProof,
    port_id: ByteArray,
    channel_id: ByteArray,
    sequence: Int,
    acknowledgement: ByteArray,
  }

  VerifyPacketReceiptAbsence {
    client_datum_state: ClientDatumState,
    connection: ConnectionEnd,
    proof_height: Height,
    proof: MerkleProof,
    port_id: ByteArray,
    channel_id: ByteArray,
    sequence: Int,
  }

  VerifyOther
}
