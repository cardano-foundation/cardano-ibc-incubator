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

fn check(header1: Header, header2: Header) -> Bool {
  let msg =
    MisbehaviourCase(Misbehaviour { client_id: "client-0", header1, header2 })
  let consensus_states: Pairs<Height, ConsensusState> = []
  misbehaviour_handle.check_for_misbehaviour(msg, consensus_states)
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
