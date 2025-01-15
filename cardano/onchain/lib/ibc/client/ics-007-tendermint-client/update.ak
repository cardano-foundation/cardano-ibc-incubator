use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header_handle as header_handle_mod
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/misbehaviour_handle as misbehaviour_handle_mod
use ibc/client/ics_007_tendermint_client/msgs.{
  ClientMessage, HeaderCase, MisbehaviourCase,
}
use ibc/utils/tx_time.{TxTime} as tx_time_mod

pub fn verify_client_message(
  cs: ClientState,
  tx_time: TxTime,
  consensus_states: Pairs<Height, ConsensusState>,
  msg: ClientMessage,
) {
  when msg is {
    HeaderCase(header) ->
      header_handle_mod.verify_header(cs, tx_time, consensus_states, header)
    MisbehaviourCase(misbehaviour) ->
      misbehaviour_handle_mod.verify_misbehaviour(
        cs,
        tx_time,
        consensus_states,
        misbehaviour,
      )
  }
}
