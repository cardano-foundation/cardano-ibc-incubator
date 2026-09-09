use aiken/cbor
use aiken/collection/list
use aiken/crypto
use cardano/transaction.{InlineDatum, Input}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/msgs.{
  ClientMessage, HeaderCase, MisbehaviourCase,
}
use ibc/client/ics_007_tendermint_client/store

pub type ConsensusStateKey {
  client_token: AuthToken,
  height: Height,
}

pub type ConsensusStateDatum {
  client_token: AuthToken,
  height: Height,
  consensus_state: ConsensusState,
  processed_time: Int,
  processed_height: Int,
}

pub fn asset_name(client_token: AuthToken, height: Height) -> ByteArray {
  // Rebuild nested constructors so the hash does not inherit definite versus
  // indefinite CBOR arrays from a datum or redeemer supplied by the caller.
  crypto.sha3_256(
    cbor.serialise(
      ConsensusStateKey {
        client_token: AuthToken {
          policy_id: client_token.policy_id,
          name: client_token.name,
        },
        height: Height {
          revision_number: height.revision_number,
          revision_height: height.revision_height,
        },
      },
    ),
  )
}

pub const max_consensus_state_deletions = 1

pub fn token(client_token: AuthToken, height: Height) -> AuthToken {
  AuthToken {
    policy_id: client_token.policy_id,
    name: asset_name(client_token, height),
  }
}

pub fn from_client(client: ClientDatum) -> ConsensusStateDatum {
  expect client_datum.has_singleton_history(client)
  expect [Pair(height, consensus_state)] = client.state.consensus_states
  expect [Pair(_, processed_time)] = client.state.processed_times
  expect [Pair(_, processed_height)] = client.state.processed_heights
  ConsensusStateDatum {
    client_token: client.token,
    height,
    consensus_state,
    processed_time,
    processed_height,
  }
}

/// Only transaction-selected records are read. Their NFT authenticates the
/// contents and their spending validator allows deletion but no modification.
pub fn reference_records(
  client: ClientDatum,
  references: List<Input>,
  current_time: Int,
) -> List<ConsensusStateDatum> {
  list.foldl(
    references,
    [],
    fn(input, records) {
      when input.output.datum is {
        InlineDatum(raw) ->
          if raw is record: ConsensusStateDatum {
            if record.client_token == client.token && auth.contain_auth_token(
              input.output,
              token(record.client_token, record.height),
            ) {
              expect
                height.compare(
                  record.height,
                  client.state.client_state.latest_height,
                ) == Less
              expect
                !list.any(
                  records,
                  fn(existing: ConsensusStateDatum) {
                    height.equal(existing.height, record.height)
                  },
                )
              if client_state.is_expired(
                client.state.client_state,
                record.consensus_state.timestamp,
                current_time,
              ) {
                records
              } else {
                [record, ..records]
              }
            } else {
              records
            }
          } else {
            records
          }
        _ -> records
      }
    },
  )
}

/// Header verification needs roots but never the IBC delay metadata.
pub fn consensus_states_for_message(
  client: ClientDatum,
  references: List<Input>,
  current_time: Int,
  msg: ClientMessage,
) -> Pairs<Height, ConsensusState> {
  let heights =
    when msg is {
      HeaderCase(h) -> [h.trusted_height, header.get_height(h)]
      MisbehaviourCase(m) ->
        [m.header1.trusted_height, m.header2.trusted_height]
    }
  list.foldl(
    heights,
    client.state.consensus_states,
    fn(h, states) {
      if store.get_consensus_state(states, h) != None {
        states
      } else {
        let archive_token = token(client.token, h)
        when
          list.find(
            references,
            fn(input) { auth.contain_auth_token(input.output, archive_token) },
          )
        is {
          None -> states
          Some(input) -> {
            expect InlineDatum(raw) = input.output.datum
            expect record: ConsensusStateDatum = raw
            expect
              record.client_token == client.token && height.equal(
                record.height,
                h,
              )
            expect
              height.compare(h, client.state.client_state.latest_height) == Less
            if client_state.is_expired(
              client.state.client_state,
              record.consensus_state.timestamp,
              current_time,
            ) {
              states
            } else {
              [Pair(h, record.consensus_state), ..states]
            }
          }
        }
      }
    },
  )
}

/// Packet verification additionally needs the immutable processing metadata.
pub fn with_reference_at_height(
  client: ClientDatum,
  references: List<Input>,
  current_time: Int,
  proof_height: Option<Height>,
) -> ClientDatum {
  when proof_height is {
    None -> client
    Some(h) ->
      if height.equal(h, client.state.client_state.latest_height) {
        client
      } else {
        let archive_token = token(client.token, h)
        expect Some(input) =
          list.find(
            references,
            fn(input) { auth.contain_auth_token(input.output, archive_token) },
          )
        expect InlineDatum(raw) = input.output.datum
        expect record: ConsensusStateDatum = raw
        expect
          record.client_token == client.token && height.equal(record.height, h)
        expect
          height.compare(h, client.state.client_state.latest_height) == Less
        expect
          !client_state.is_expired(
            client.state.client_state,
            record.consensus_state.timestamp,
            current_time,
          )
        ClientDatum {
          ..client,
          state: ClientDatumState {
            ..client.state,
            consensus_states: [
              Pair(h, record.consensus_state),
              ..client.state.consensus_states
            ],
            processed_times: [
              Pair(h, record.processed_time),
              ..client.state.processed_times
            ],
            processed_heights: [
              Pair(h, record.processed_height),
              ..client.state.processed_heights
            ],
          },
        }
      }
  }
}

/// Collect multiple authenticated references for callers that explicitly need a
/// history view. Production packet validators select their single proof height.
pub fn with_reference_history(
  client: ClientDatum,
  references: List<Input>,
  current_time: Int,
) -> ClientDatum {
  list.foldl(
    reference_records(client, references, current_time),
    client,
    fn(record, accumulated) {
      ClientDatum {
        ..accumulated,
        state: ClientDatumState {
          ..accumulated.state,
          consensus_states: [
            Pair(record.height, record.consensus_state),
            ..accumulated.state.consensus_states
          ],
          processed_times: [
            Pair(record.height, record.processed_time),
            ..accumulated.state.processed_times
          ],
          processed_heights: [
            Pair(record.height, record.processed_height),
            ..accumulated.state.processed_heights
          ],
        },
      }
    },
  )
}
