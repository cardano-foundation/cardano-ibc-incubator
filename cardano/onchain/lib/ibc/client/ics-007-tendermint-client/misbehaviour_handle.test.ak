use aiken/fuzz
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{
  BlockID, PartSetHeader,
}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/header as tm_header
use ibc/client/ics_007_tendermint_client/cometbft/protos/types_pb.{Consensus}
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header.{Header}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/misbehaviour.{Misbehaviour}
use ibc/client/ics_007_tendermint_client/misbehaviour_handle
use ibc/client/ics_007_tendermint_client/msgs.{MisbehaviourCase}
use ibc/core/ics_002_client_semantics/types/keys as client_keys
use ibc/testing/fuzz_dsl

fn test_header(height: Int, time: Int, block_hash: ByteArray) -> Header {
  Header {
    signed_header: SignedHeader {
      header: tm_header.TmHeader {
        ..tm_header.null_tm_header(),
        version: Consensus { block: 11, app: 0 },
        chain_id: "testchain-1",
        height,
        time,
      },
      commit: Commit {
        height,
        round: 0,
        block_id: BlockID {
          hash: block_hash,
          part_set_header: PartSetHeader { total: 0, hash: "" },
        },
        signatures: [],
      },
    },
    validator_set: validator_set.null_validator_set(),
    trusted_height: Height { revision_number: 1, revision_height: 1 },
    trusted_validators: validator_set.null_validator_set(),
  }
}

fn check_with_client_id(
  client_id: ByteArray,
  header1: Header,
  header2: Header,
) -> Bool {
  let msg = MisbehaviourCase(Misbehaviour { client_id, header1, header2 })
  let consensus_states: Pairs<Height, ConsensusState> = []
  misbehaviour_handle.check_for_misbehaviour(msg, consensus_states)
}

fn check(header1: Header, header2: Header) -> Bool {
  check_with_client_id("07-tendermint-0", header1, header2)
}

test two_valid_monotonic_headers_in_normal_order_are_not_misbehaviour() {
  !check(test_header(3, 30, #"01"), test_header(2, 20, #"02"))
}

test two_valid_monotonic_headers_in_reversed_order_are_not_misbehaviour() {
  !check(test_header(2, 20, #"01"), test_header(3, 30, #"02"))
}

test higher_height_header_with_equal_or_earlier_time_is_misbehaviour() {
  check(test_header(3, 20, #"01"), test_header(2, 20, #"02"))
}

test same_height_different_block_hash_is_misbehaviour() {
  check(test_header(3, 30, #"01"), test_header(3, 30, #"02"))
}

test same_height_same_block_hash_is_not_misbehaviour() {
  !check(test_header(3, 30, #"01"), test_header(3, 30, #"01"))
}

test prop_client_misbehaviour_accepts_same_height_conflict(seed via fuzz.int()) {
  fuzz.label(@"unit.client.misbehaviour.valid_same_height_conflict")

  fuzz_dsl.valid_check(
    "client",
    "misbehaviour",
    "misbehaviour_handle.check_for_misbehaviour",
    check(
      test_header(3, 30 + seed % 10, #"01"),
      test_header(3, 30 + seed % 10, #"02"),
    ),
  )
    |> fuzz_dsl.assert_valid
}

test prop_client_misbehaviour_accepts_time_violation(seed via fuzz.int()) {
  fuzz.label(@"unit.client.misbehaviour.valid_time_violation")

  let lower_time = 20 + seed % 10
  fuzz_dsl.valid_check(
    "client",
    "misbehaviour",
    "misbehaviour_handle.check_for_misbehaviour",
    check(test_header(3, lower_time, #"01"), test_header(2, lower_time, #"02")),
  )
    |> fuzz_dsl.assert_valid
}

test prop_client_misbehaviour_rejects_monotonic_headers(seed via fuzz.int()) {
  fuzz.label(@"unit.client.misbehaviour.invalid_monotonic_headers")

  let base_time = 20 + seed % 10
  fuzz_dsl.mutated_check(
    "client",
    "misbehaviour",
    "monotonic_headers",
    "misbehaviour_handle.check_for_misbehaviour",
    check(
      test_header(3, base_time + 10, #"01"),
      test_header(2, base_time, #"02"),
    ),
  )
    |> fuzz_dsl.assert_rejected
}

test prop_client_misbehaviour_rejects_same_header(seed via fuzz.int()) {
  fuzz.label(@"unit.client.misbehaviour.invalid_same_header")

  let time = 30 + seed % 10
  fuzz_dsl.mutated_check(
    "client",
    "misbehaviour",
    "same_header",
    "misbehaviour_handle.check_for_misbehaviour",
    check(test_header(3, time, #"01"), test_header(3, time, #"01")),
  )
    |> fuzz_dsl.assert_rejected
}

test prop_client_misbehaviour_rejects_wrong_client_id(_seed via fuzz.int()) {
  fuzz.label(@"unit.client.misbehaviour.invalid_wrong_client_id")

  fuzz_dsl.mutated_check(
    "client",
    "misbehaviour",
    "wrong_client_id",
    "client_keys.is_valid_client_id",
    client_keys.is_valid_client_id("client-0"),
  )
    |> fuzz_dsl.assert_rejected
}
