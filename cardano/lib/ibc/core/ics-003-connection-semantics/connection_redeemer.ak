use ibc/auth.{AuthToken}
use ibc/client/cardano_client/client_state.{ClientState as CardanoClient}
use ibc/client/ics_007_tendermint_client/height.{Height}

pub type MintConnectionRedeemer {
  ConnOpenInit { handler_auth_token: AuthToken }
  ConnOpenTry {
    handler_auth_token: AuthToken,
    client_state: CardanoClient,
    proof_init: ByteArray,
    proof_client: ByteArray,
    proof_height: Height,
  }
}

pub type SpendConnectionRedeemer {
  ConnOpenAck {
    counterparty_client_state: CardanoClient,
    proof_try: ByteArray,
    proof_client: ByteArray,
    proof_height: Height,
  }
  ConnOpenConfirm { proof_ack: ByteArray, proof_height: Height }
}
