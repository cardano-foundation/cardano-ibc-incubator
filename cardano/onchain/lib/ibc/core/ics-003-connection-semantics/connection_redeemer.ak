use ibc/client/ics_007_tendermint_client/height.{Height}

pub type MintConnectionRedeemer {
  ConnOpenInit
  ConnOpenTry {
    client_state: ByteArray,
    proof_init: Data,
    proof_client: Data,
    proof_height: Height,
  }
}

pub type SpendConnectionRedeemer {
  ConnOpenAck
  ConnOpenConfirm { proof_ack: Data, proof_height: Height }
  ReclaimConnection
}
