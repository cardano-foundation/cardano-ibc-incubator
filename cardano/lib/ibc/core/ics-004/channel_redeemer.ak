use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/types/packet.{Packet}

pub type MintChannelRedeemer {
  ChanOpenInit { handler_token: AuthToken }
  ChanOpenTry {
    handler_token: AuthToken,
    counterparty_version: ByteArray,
    proof_init: ByteArray,
    proof_height: Height,
  }
}

pub type SpendChannelRedeemer {
  ChanOpenAck {
    counterparty_version: ByteArray,
    proof_try: ByteArray,
    proof_height: Height,
  }
  ChanOpenConfirm { proof_ack: ByteArray, proof_height: Height }
  RecvPacket {
    packet: Packet,
    proof_commitment: ByteArray,
    proof_height: Height,
  }
}
