use aiken/builtin
use aiken/collection/list
use aiken/collection/pairs
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_redeemer.{MintClientRedeemer}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_history.{Witness}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{HostStateRedeemer}
use ibc/core/ics_025_handler_interface/ibc_state_commitment as tree

fn h(n: Int) -> Height {
  Height { revision_number: 0, revision_height: n }
}

fn client(n: Int) -> ClientDatum {
  ClientDatum {
    state: ClientDatumState {
      client_state: ClientState {
        chain_id: "chain-0",
        trust_level: unchecked_rational.new(1, 3),
        trusting_period: 100_000_000,
        unbonding_period: 200_000_000,
        max_clock_drift: 1,
        frozen_height: h(0),
        latest_height: h(n),
        proof_specs: merkle.get_sdk_specs(),
      },
      consensus_states: [
        Pair(
          h(n),
          ConsensusState {
            timestamp: n * 1_000_000,
            next_validators_hash: #"cc",
            root: MerkleRoot { hash: #"dd" },
          },
        ),
      ],
      processed_times: [Pair(h(n), n * 1_000_000 + 500)],
      processed_heights: [Pair(h(n), n)],
    },
    token: AuthToken { policy_id: #"11", name: #"22" },
    history_root: tree.empty_hash,
  }
}

fn siblings() -> List<ByteArray> {
  list.repeat(tree.empty_hash, 64)
}

fn live() -> ClientDatum {
  ClientDatum {
    ..client(2),
    history_root: consensus_history.insert(
      tree.empty_hash,
      consensus_history.from_client(client(1)),
      siblings(),
    ),
  }
}

fn witness() -> Witness {
  Witness {
    record: consensus_history.from_client(client(1)),
    siblings: siblings(),
  }
}

test production_history_lookup_authenticates_client_root_and_preserves_metadata() {
  let hydrated =
    consensus_history.with_witness_at_height(
      live(),
      Some(witness()),
      3_000_000,
      Some(h(1)),
    )
  and {
    hydrated.history_root == live().history_root,
    pairs.get_first(hydrated.state.processed_times, h(1)) == Some(1_000_500),
    pairs.get_first(hydrated.state.processed_heights, h(1)) == Some(1),
    pairs.get_first(hydrated.state.consensus_states, h(1)) == pairs.get_first(
      client(1).state.consensus_states,
      h(1),
    ),
    list.length(hydrated.state.consensus_states) == 2,
  }
}

test production_history_lookup_rejects_record_without_witness() fail {
  expect _ =
    consensus_history.with_witness_at_height(
      live(),
      None,
      3_000_000,
      Some(h(1)),
    )
  True
}

test production_history_lookup_rejects_root_from_another_client_state() fail {
  expect _ =
    consensus_history.with_witness_at_height(
      client(2),
      Some(witness()),
      3_000_000,
      Some(h(1)),
    )
  True
}

test production_history_lookup_rejects_changed_processing_metadata() fail {
  let original = witness()
  let changed =
    Witness {
      ..original,
      record: consensus_history.ConsensusStateDatum {
        ..original.record,
        processed_time: 0,
      },
    }
  expect _ =
    consensus_history.with_witness_at_height(
      live(),
      Some(changed),
      3_000_000,
      Some(h(1)),
    )
  True
}

test production_history_lookup_rejects_expiry_boundary() fail {
  expect _ =
    consensus_history.with_witness_at_height(
      live(),
      Some(witness()),
      101_000_000,
      Some(h(1)),
    )
  True
}

test production_latest_needs_no_history_proof() {
  consensus_history.with_witness_at_height(live(), None, 3_000_000, Some(h(2))) == live()
}

test production_history_never_overwrites_a_checkpoint() fail {
  expect _ =
    consensus_history.insert(
      live().history_root,
      consensus_history.from_client(client(1)),
      siblings(),
    )
  True
}

test production_freeze_preserves_history_root() {
  let old = live()
  let frozen =
    ClientDatum {
      ..old,
      state: ClientDatumState {
        ..old.state,
        client_state: ClientState {
          ..old.state.client_state,
          frozen_height: h(1),
        },
      },
    }
  client_datum.update_state_on_misbehaviour(old, frozen)
}

test production_freeze_rejects_history_root_change() {
  let old = live()
  let frozen =
    ClientDatum {
      ..old,
      history_root: tree.empty_hash,
      state: ClientDatumState {
        ..old.state,
        client_state: ClientState {
          ..old.state.client_state,
          frozen_height: h(1),
        },
      },
    }
  !client_datum.update_state_on_misbehaviour(old, frozen)
}

test production_creation_rejects_preseeded_history_root() {
  !client_datum.is_initialized_valid(live(), live().token)
}

test production_creation_accepts_empty_history_root() {
  client_datum.is_initialized_valid(client(1), client(1).token)
}

test removed_archive_mint_redeemer_is_rejected() fail {
  let raw = builtin.constr_data(1, [])
  expect _: MintClientRedeemer = raw
  True
}

test removed_consensus_prune_redeemer_is_rejected() fail {
  let raw = builtin.constr_data(11, [])
  expect _: HostStateRedeemer = raw
  True
}
