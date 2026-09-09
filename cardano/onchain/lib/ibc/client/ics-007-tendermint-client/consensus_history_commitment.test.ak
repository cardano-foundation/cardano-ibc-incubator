use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/block/header as tm_header
use ibc/client/ics_007_tendermint_client/cometbft/signed_header
use ibc/client/ics_007_tendermint_client/consensus_history.{ConsensusStateDatum}
use ibc/client/ics_007_tendermint_client/consensus_history_commitment.{Witness} as history
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/misbehaviour.{Misbehaviour}
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase, MisbehaviourCase}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}
use ibc/core/ics_025_handler_interface/ibc_state_commitment as tree
use ibc/testing/sparse_tree

const client_policy =
  #"11111111111111111111111111111111111111111111111111111111"

fn token() -> AuthToken {
  AuthToken { policy_id: client_policy, name: #"22" }
}

fn height(n: Int) -> Height {
  Height { revision_number: 0, revision_height: n }
}

fn record() -> ConsensusStateDatum {
  ConsensusStateDatum {
    client_token: token(),
    height: height(1),
    consensus_state: ConsensusState {
      timestamp: 7,
      next_validators_hash: #"cc",
      root: MerkleRoot { hash: #"dd" },
    },
    processed_time: 8,
    processed_height: 9,
  }
}

fn zero_siblings() -> List<ByteArray> {
  list.repeat(tree.empty_hash, tree.merkle_depth_bits)
}

fn root() -> ByteArray {
  history.insert(tree.empty_hash, record(), zero_siblings())
}

fn witness() -> Witness {
  Witness { record: record(), siblings: zero_siblings() }
}

fn client() -> ClientDatum {
  let tip = height(10)
  ClientDatum {
    token: token(),
    state: ClientDatumState {
      client_state: ClientState {
        chain_id: "chain-0",
        trust_level: unchecked_rational.new(1, 3),
        trusting_period: 100,
        unbonding_period: 200,
        max_clock_drift: 1,
        frozen_height: height(0),
        latest_height: tip,
        proof_specs: [],
      },
      consensus_states: [
        Pair(tip, ConsensusState { ..record().consensus_state, timestamp: 90 }),
      ],
      processed_times: [Pair(tip, 91)],
      processed_heights: [Pair(tip, 92)],
    },
  }
}

fn header_at(trusted: Int, target: Int) -> header.Header {
  let h = header.null_header()
  header.Header {
    ..h,
    trusted_height: height(trusted),
    signed_header: signed_header.SignedHeader {
      ..h.signed_header,
      header: tm_header.TmHeader {
        ..h.signed_header.header,
        chain_id: "chain-0",
        height: target,
      },
    },
  }
}

test key_and_value_match_normalized_offchain_vector() {
  and {
    history.key(token(), height(1)) == "internal/consensus-history/v1/d8799fd8799f581c111111111111111111111111111111111111111111111111111111114122ffd8799f0001ffff",
    history.value(record()) == #"d8799fd8799f581c111111111111111111111111111111111111111111111111111111114122ffd8799f0001ffd8799f0741ccd8799f41ddffff0809ff",
    root() == #"caee7ebf5c9bd19dc904e771797ce4e98f91301273dd86c9f32dc8c8a4fc6e7f",
    history.authenticate(root(), token(), height(1), record(), zero_siblings()),
  }
}

test key_binds_policy_name_revision_and_height() {
  let identity = token()
  let base = history.key(identity, height(1))
  and {
    history.key(AuthToken { ..identity, policy_id: #"22" }, height(1)) != base,
    history.key(AuthToken { ..identity, name: #"23" }, height(1)) != base,
    history.key(identity, Height { revision_number: 1, revision_height: 1 }) != base,
    history.key(identity, height(2)) != base,
  }
}

test equivalent_input_cbor_does_not_change_key_value_or_authentication() {
  expect Some(raw) =
    cbor.deserialise(
      #"d87985d87982581c111111111111111111111111111111111111111111111111111111114122d879820001d879830741ccd8798141dd0809",
    )
  expect decoded: ConsensusStateDatum = raw
  and {
    history.key(decoded.client_token, decoded.height) == history.key(
      token(),
      height(1),
    ),
    history.value(decoded) == history.value(record()),
    history.authenticate(root(), token(), height(1), decoded, zero_siblings()),
  }
}

test tampered_consensus_fields_and_processing_metadata_are_rejected() {
  let original = record()
  let state = original.consensus_state
  let changed =
    [
      ConsensusStateDatum {
        ..original,
        consensus_state: ConsensusState { ..state, timestamp: 8 },
      },
      ConsensusStateDatum {
        ..original,
        consensus_state: ConsensusState { ..state, next_validators_hash: #"ce" },
      },
      ConsensusStateDatum {
        ..original,
        consensus_state: ConsensusState {
          ..state,
          root: MerkleRoot { hash: #"de" },
        },
      },
      ConsensusStateDatum { ..original, processed_time: 7 },
      ConsensusStateDatum { ..original, processed_height: 8 },
    ]
  let committed = root()
  list.all(
    changed,
    fn(candidate) {
      !history.authenticate(
        committed,
        token(),
        height(1),
        candidate,
        zero_siblings(),
      )
    },
  )
}

test different_expected_client_or_full_height_is_rejected() {
  let identity = token()
  let committed = root()
  and {
    !history.authenticate(
      committed,
      AuthToken { ..identity, name: #"23" },
      height(1),
      record(),
      zero_siblings(),
    ),
    !history.authenticate(
      committed,
      AuthToken { ..identity, policy_id: #"22" },
      height(1),
      record(),
      zero_siblings(),
    ),
    !history.authenticate(
      committed,
      identity,
      height(2),
      record(),
      zero_siblings(),
    ),
    !history.authenticate(
      committed,
      identity,
      Height { revision_number: 1, revision_height: 1 },
      record(),
      zero_siblings(),
    ),
  }
}

test changed_record_identity_does_not_authenticate_under_old_root() {
  let original = record()
  let changed =
    ConsensusStateDatum {
      ..original,
      height: Height { revision_number: 1, revision_height: 1 },
    }
  !history.authenticate(
    root(),
    changed.client_token,
    changed.height,
    changed,
    zero_siblings(),
  )
}

test wrong_root_and_wrong_sibling_are_rejected() {
  let original = record()
  and {
    !history.authenticate(
      tree.empty_hash,
      token(),
      height(1),
      original,
      zero_siblings(),
    ),
    !history.authenticate(
      root(),
      token(),
      height(1),
      original,
      [client_policy |> crypto.sha2_256, ..list.drop(zero_siblings(), 1)],
    ),
  }
}

test short_proof_is_rejected() fail {
  history.authenticate(
    root(),
    token(),
    height(1),
    record(),
    list.take(zero_siblings(), 63),
  )
}

test long_proof_is_rejected() fail {
  history.authenticate(
    root(),
    token(),
    height(1),
    record(),
    [tree.empty_hash, ..zero_siblings()],
  )
}

test malformed_sibling_is_rejected() fail {
  history.authenticate(
    root(),
    token(),
    height(1),
    record(),
    [#"00", ..list.drop(zero_siblings(), 1)],
  )
}

test duplicate_insertion_is_rejected() fail {
  history.insert(root(), record(), zero_siblings()) != #""
}

test changed_metadata_cannot_replace_an_existing_leaf() fail {
  let original = record()
  history.insert(
    root(),
    ConsensusStateDatum { ..original, processed_time: 0 },
    zero_siblings(),
  ) != #""
}

test insertion_and_lookup_accept_updated_witness_after_unrelated_root_change() {
  let original = record()
  let original_key = history.key(token(), height(1))
  let entries = [Pair(original_key, history.value(original))]
  let second = ConsensusStateDatum { ..original, height: height(2) }
  let second_key = history.key(token(), height(2))
  let updated_root =
    history.insert(root(), second, sparse_tree.siblings(entries, second_key))
  let updated_entries = [Pair(second_key, history.value(second)), ..entries]
  and {
    !history.authenticate(
      updated_root,
      token(),
      height(1),
      original,
      zero_siblings(),
    ),
    history.authenticate(
      updated_root,
      token(),
      height(1),
      original,
      sparse_tree.siblings(updated_entries, original_key),
    ),
    history.authenticate(
      updated_root,
      token(),
      height(2),
      second,
      sparse_tree.siblings(updated_entries, second_key),
    ),
    updated_root == sparse_tree.root(updated_entries),
  }
}

test packet_hydration_preserves_tip_and_authenticates_processing_metadata() {
  let hydrated =
    history.with_witness_at_height(
      client(),
      root(),
      Some(witness()),
      106,
      Some(height(1)),
    )
  and {
    pairs.get_first(hydrated.state.consensus_states, height(1)) == Some(
      record().consensus_state,
    ),
    pairs.get_first(hydrated.state.processed_times, height(1)) == Some(8),
    pairs.get_first(hydrated.state.processed_heights, height(1)) == Some(9),
    hydrated.state.client_state == client().state.client_state,
    pairs.get_first(hydrated.state.consensus_states, height(10)) == pairs.get_first(
      client().state.consensus_states,
      height(10),
    ),
  }
}

test latest_and_no_proof_height_need_no_history_witness() {
  and {
    history.with_witness_at_height(
      client(),
      root(),
      None,
      100,
      Some(height(10)),
    ) == client(),
    history.with_witness_at_height(client(), root(), None, 100, None) == client(),
  }
}

test packet_expiry_boundary_is_rejected() fail {
  let hydrated =
    history.with_witness_at_height(
      client(),
      root(),
      Some(witness()),
      107,
      Some(height(1)),
    )
  hydrated.state.client_state.latest_height == height(10)
}

test packet_history_requires_a_witness() fail {
  let hydrated =
    history.with_witness_at_height(client(), root(), None, 100, Some(height(1)))
  hydrated.state.client_state.latest_height == height(10)
}

test packet_wrong_requested_revision_is_rejected() fail {
  let hydrated =
    history.with_witness_at_height(
      client(),
      root(),
      Some(witness()),
      100,
      Some(Height { revision_number: 1, revision_height: 1 }),
    )
  hydrated.state.client_state.latest_height == height(10)
}

test packet_history_rejects_a_different_client() fail {
  let original = client()
  let changed =
    ClientDatum {
      ..original,
      token: AuthToken { ..original.token, name: #"23" },
    }
  let hydrated =
    history.with_witness_at_height(
      changed,
      root(),
      Some(witness()),
      100,
      Some(height(1)),
    )
  hydrated.state.client_state.latest_height == height(10)
}

test packet_history_cannot_shadow_the_tip_with_a_witness() fail {
  let hydrated =
    history.with_witness_at_height(
      client(),
      root(),
      Some(witness()),
      100,
      Some(height(10)),
    )
  hydrated.state.client_state.latest_height == height(10)
}

test packet_history_rejects_a_committed_future_height() fail {
  let original = record()
  let future = ConsensusStateDatum { ..original, height: height(11) }
  let committed = history.insert(tree.empty_hash, future, zero_siblings())
  let hydrated =
    history.with_witness_at_height(
      client(),
      committed,
      Some(Witness { record: future, siblings: zero_siblings() }),
      100,
      Some(height(11)),
    )
  hydrated.state.client_state.latest_height == height(10)
}

test message_hydration_loads_old_trusted_state() {
  let states =
    history.consensus_states_for_message(
      client(),
      root(),
      [witness()],
      100,
      HeaderCase(header_at(1, 11)),
    )
  and {
    pairs.get_first(states, height(1)) == Some(record().consensus_state),
    pairs.get_first(states, height(10)) != None,
  }
}

test conflicting_header_can_load_existing_historical_height() {
  let states =
    history.consensus_states_for_message(
      client(),
      root(),
      [witness()],
      100,
      HeaderCase(header_at(0, 1)),
    )
  pairs.get_first(states, height(1)) == Some(record().consensus_state)
}

test misbehaviour_hydration_loads_both_trusted_heights() {
  let first = record()
  let second = ConsensusStateDatum { ..first, height: height(2) }
  let entries =
    [
      Pair(history.key(token(), height(1)), history.value(first)),
      Pair(history.key(token(), height(2)), history.value(second)),
    ]
  let witnesses =
    [
      Witness {
        record: first,
        siblings: sparse_tree.siblings(entries, history.key(token(), height(1))),
      },
      Witness {
        record: second,
        siblings: sparse_tree.siblings(entries, history.key(token(), height(2))),
      },
    ]
  let msg =
    MisbehaviourCase(
      Misbehaviour {
        client_id: "07-tendermint-0",
        header1: header_at(1, 11),
        header2: header_at(2, 11),
      },
    )
  let states =
    history.consensus_states_for_message(
      client(),
      sparse_tree.root(entries),
      witnesses,
      100,
      msg,
    )
  and {
    pairs.get_first(states, height(1)) == Some(first.consensus_state),
    pairs.get_first(states, height(2)) == Some(second.consensus_state),
  }
}

test message_rejects_duplicate_witnesses() fail {
  let states =
    history.consensus_states_for_message(
      client(),
      root(),
      [witness(), witness()],
      100,
      HeaderCase(header_at(1, 11)),
    )
  list.length(states) >= 0
}

test message_rejects_irrelevant_witnesses() fail {
  let states =
    history.consensus_states_for_message(
      client(),
      root(),
      [witness()],
      100,
      HeaderCase(header_at(10, 11)),
    )
  list.length(states) >= 0
}

test message_rejects_more_than_two_witnesses() fail {
  let states =
    history.consensus_states_for_message(
      client(),
      root(),
      [witness(), witness(), witness()],
      100,
      HeaderCase(header_at(1, 11)),
    )
  list.length(states) >= 0
}

test message_rejects_expired_trusted_state() fail {
  let states =
    history.consensus_states_for_message(
      client(),
      root(),
      [witness()],
      107,
      HeaderCase(header_at(1, 11)),
    )
  list.length(states) >= 0
}
