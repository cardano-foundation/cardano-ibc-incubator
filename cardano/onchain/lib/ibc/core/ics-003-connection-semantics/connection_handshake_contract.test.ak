use aiken/fuzz
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/consensus_state
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  BatchVerifyMembership, VerifyMembership, VerifyMembershipParams,
  VerifyProofRedeemer,
}
use ibc/core/ics_023_vector_commitments/merkle
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  CreateConnection, HostStateRedeemer, UpdateConnection,
}
use ibc/testing/fuzz_dsl

fn test_height(revision_height: Int) -> Height {
  Height { revision_number: 0, revision_height }
}

fn test_client_state() {
  client_state.new_client_state(
    "testchain-1",
    unchecked_rational.from_int(1),
    1000,
    1500,
    10,
    test_height(10),
    merkle.get_sdk_specs(),
  )
}

fn test_membership(height: Height, value: ByteArray) -> VerifyMembershipParams {
  VerifyMembershipParams {
    cs: test_client_state(),
    cons_state: consensus_state.null_consensus_state(),
    height,
    processed_time: 0,
    processed_height: 0,
    delay_time_period: 0,
    delay_block_period: 0,
    proof: merkle.null_merkle_proof(),
    path: merkle.new_merkle_path(["ibc", "key"]),
    value,
  }
}

fn conn_open_try_expected_proof(
  height: Height,
  counterparty_client_state: ByteArray,
) -> VerifyProofRedeemer {
  BatchVerifyMembership(
    [
      test_membership(height, "connection-end"),
      test_membership(height, counterparty_client_state),
    ],
  )
}

fn has_connection_and_client_proofs(redeemer: VerifyProofRedeemer) -> Bool {
  when redeemer is {
    BatchVerifyMembership([_, _]) -> True
    _ -> False
  }
}

fn is_create_connection_host_redeemer(redeemer: HostStateRedeemer) -> Bool {
  when redeemer is {
    CreateConnection { .. } -> True
    _ -> False
  }
}

fn uses_requested_height(
  redeemer: VerifyProofRedeemer,
  requested_height: Height,
) -> Bool {
  when redeemer is {
    VerifyMembership { height, .. } -> height == requested_height
    _ -> False
  }
}

test prop_conn_open_try_rejects_missing_client_proof(_seed via fuzz.int()) {
  fuzz.label(@"contract.conn.open_try.invalid_missing_client_proof")

  let malformed_redeemer =
    BatchVerifyMembership([test_membership(test_height(10), "connection-end")])

  fuzz_dsl.mutated_check(
    "conn",
    "open_try",
    "missing_client_proof",
    "has_connection_and_client_proofs",
    has_connection_and_client_proofs(malformed_redeemer),
  )
    |> fuzz_dsl.assert_rejected
}

test prop_conn_open_try_rejects_wrong_counterparty_client_state(
  _seed via fuzz.int(),
) {
  fuzz.label(@"contract.conn.open_try.invalid_wrong_counterparty_client_state")

  let height = test_height(10)
  let expected_redeemer = conn_open_try_expected_proof(height, "client-state")
  let wrong_redeemer =
    conn_open_try_expected_proof(height, "wrong-client-state")

  fuzz_dsl.mutated_check(
    "conn",
    "open_try",
    "wrong_counterparty_client_state",
    "conn_open_try_expected_proof",
    wrong_redeemer == expected_redeemer,
  )
    |> fuzz_dsl.assert_rejected
}

test prop_conn_open_try_rejects_wrong_host_redeemer(_seed via fuzz.int()) {
  fuzz.label(@"contract.conn.open_try.invalid_wrong_host_redeemer")

  fuzz_dsl.mutated_check(
    "conn",
    "open_try",
    "wrong_host_redeemer",
    "is_create_connection_host_redeemer",
    is_create_connection_host_redeemer(
      UpdateConnection { connection_siblings: [] },
    ),
  )
    |> fuzz_dsl.assert_rejected
}

test prop_conn_open_ack_rejects_wrong_proof_height(_seed via fuzz.int()) {
  fuzz.label(@"contract.conn.open_ack.invalid_wrong_proof_height")

  let requested_height = test_height(10)
  let wrong_height = test_height(11)
  let wrong_redeemer =
    VerifyMembership {
      cs: test_client_state(),
      cons_state: consensus_state.null_consensus_state(),
      height: wrong_height,
      processed_time: 0,
      processed_height: 0,
      delay_time_period: 0,
      delay_block_period: 0,
      proof: merkle.null_merkle_proof(),
      path: merkle.new_merkle_path(["ibc", "connection"]),
      value: "connection-end",
    }

  fuzz_dsl.mutated_check(
    "conn",
    "open_ack",
    "wrong_proof_height",
    "uses_requested_height",
    uses_requested_height(wrong_redeemer, requested_height),
  )
    |> fuzz_dsl.assert_rejected
}
