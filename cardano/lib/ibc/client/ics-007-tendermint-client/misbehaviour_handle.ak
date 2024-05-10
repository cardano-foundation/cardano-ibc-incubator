use aiken/bytearray
use aiken/dict.{Dict}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/validation
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header.{Header} as header_mod
use ibc/client/ics_007_tendermint_client/header_handle as header_handle_mod
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/misbehaviour.{Misbehaviour} as misbehaviour_mod
use ibc/client/ics_007_tendermint_client/msgs.{
  ClientMessage, HeaderCase, MisbehaviourCase,
}
use ibc/client/ics_007_tendermint_client/store
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/utils/tx_time.{TxTime} as tx_time_mod

// check_for_misbehaviour() detects duplicate height misbehaviour and BFT time violation misbehaviour
// in a submitted Header message and verifies the correctness of a submitted Misbehaviour ClientMessage
pub fn check_for_misbehaviour(
  msg: ClientMessage,
  consensus_states: Dict<Height, ConsensusState>,
) -> Bool {
  when msg is {
    HeaderCase(h) ->
      when
        store.get_consensus_state(consensus_states, header_mod.get_height(h))
      is {
        Some(existing_cons_state) ->
          existing_cons_state != header_mod.consensus_state(h)
        None -> {
          let invalid_prev =
            when
              store.get_prev_consensus_state(
                consensus_states,
                header_mod.get_height(h),
              )
            is {
              Some(prev_cons) -> prev_cons.timestamp >= header_mod.get_time(h)
              None -> False
            }

          if !invalid_prev {
            let invalid_next =
              when
                store.get_next_consensus_state(
                  consensus_states,
                  header_mod.get_height(h),
                )
              is {
                Some(next_cons) -> next_cons.timestamp <= header_mod.get_time(h)
                None -> False
              }

            invalid_next
          } else {
            invalid_prev
          }
        }
      }

    MisbehaviourCase(misbehaviour) ->
      if
      height.compare(
        header_mod.get_height(misbehaviour.header1),
        header_mod.get_height(misbehaviour.header2),
      ) == Equal{
      
        if
        !(bytearray.compare(
          misbehaviour.header1.signed_header.commit.block_id.hash,
          misbehaviour.header2.signed_header.commit.block_id.hash,
        ) == Equal){
        
          True
        } else {
          False
        }
      } else {
        if
        !(misbehaviour.header1.signed_header.header.time > misbehaviour.header2.signed_header.header.time){
        
          True
        } else {
          False
        }
      }
  }
}

/// verify_misbehaviour() determines whether or not two conflicting
/// headers at the same height would have convinced the light client.
pub fn verify_misbehaviour(
  cs: ClientState,
  tx_time: TxTime,
  consensus_states: Dict<Height, ConsensusState>,
  misbehaviour: Misbehaviour,
) -> Bool {
  expect Some(cons_state1) =
    dict.get(consensus_states, misbehaviour.header1.trusted_height)
  expect Some(cons_state2) =
    dict.get(consensus_states, misbehaviour.header2.trusted_height)

  expect
    check_misbehaviour_header(
      cs,
      cons_state1,
      misbehaviour.header1,
      tx_time.valid_to,
    )
  expect
    check_misbehaviour_header(
      cs,
      cons_state2,
      misbehaviour.header2,
      tx_time.valid_to,
    )
  True
}

/// check_misbehaviour_header checks that a Header in Misbehaviour is valid misbehaviour given
/// a trusted ConsensusState
fn check_misbehaviour_header(
  cs: ClientState,
  cons_state: ConsensusState,
  h: Header,
  current_timestamp: Int,
) -> Bool {
  expect header_handle_mod.check_trusted_header(h, cons_state)
  expect current_timestamp - cons_state.timestamp < cs.trusting_period

  expect Some(cs_trust_level) = unchecked_rational.to_rational(cs.trust_level)

  validation.verify_commit_light_trusting(
    cs.chain_id,
    h.trusted_validators,
    h.signed_header.commit,
    cs_trust_level,
  )
}
