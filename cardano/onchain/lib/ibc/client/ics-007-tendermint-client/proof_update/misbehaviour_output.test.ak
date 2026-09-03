use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/proof_update/misbehaviour_output.{
  MisbehaviourOutput,
}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational.{
  UncheckedRational,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}

const fixture_public_values =
  #"00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000180000000000000000000000000000000000000000000000000184552f89add48500000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000b0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000b000000000000000000000000000000000000000000000000184552ed2e838413c32c75363706f881cfef63833c3aa59d8c4d54dd92a35ac094f8579aba2a61075fd4d30cb56bfe6ff5a1aed14f42a273e44a40405bf02d5d755f93805528bba7000000000000000000000000000000000000000000000000184552ed2e838413c32c75363706f881cfef63833c3aa59d8c4d54dd92a35ac094f8579aba2a61075fd4d30cb56bfe6ff5a1aed14f42a273e44a40405bf02d5d755f93805528bba70000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000b000000000000000000000000000000000000000000000000000000000012750000000000000000000000000000000000000000000000000000000000001baf8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000673696d642d310000000000000000000000000000000000000000000000000000"

fn fixture_output() -> MisbehaviourOutput {
  let height = Height { revision_number: 1, revision_height: 11 }
  let consensus_state =
    ConsensusState {
      timestamp: 1_748_895_208_944_403_475,
      root: MerkleRoot {
        hash: #"c32c75363706f881cfef63833c3aa59d8c4d54dd92a35ac094f8579aba2a6107",
      },
      next_validators_hash: #"5fd4d30cb56bfe6ff5a1aed14f42a273e44a40405bf02d5d755f93805528bba7",
    }
  MisbehaviourOutput {
    client_state: ClientState {
      chain_id: "simd-1",
      trust_level: UncheckedRational { numerator: 1, denominator: 3 },
      latest_height: height,
      trusting_period: 1_209_600_000_000_000,
      unbonding_period: 1_814_400_000_000_000,
      max_clock_drift: 15_000_000_000,
      frozen_height: Height { revision_number: 0, revision_height: 0 },
      proof_specs: [],
    },
    time: 1_748_895_258_006_866_000,
    trusted_height_1: height,
    trusted_height_2: height,
    trusted_consensus_state_1: consensus_state,
    trusted_consensus_state_2: consensus_state,
  }
}

test fixture_matches_exact_eureka_misbehaviour_abi() {
  misbehaviour_output.encode(fixture_output()) == Some(fixture_public_values)
}

test exact_misbehaviour_output_is_768_bytes() {
  when misbehaviour_output.encode(fixture_output()) is {
    Some(bytes) -> bytearray.length(bytes) == 768
    None -> False
  }
}

test chain_ids_from_33_through_50_bytes_use_two_abi_data_words() {
  let output = fixture_output()
  let client_state = output.client_state
  let chain33 =
    ClientState {
      ..client_state,
      chain_id: #"313233343536373839303132333435363738393031323334353637383930313233",
    }
  let chain50 =
    ClientState {
      ..client_state,
      chain_id: #"3132333435363738393031323334353637383930313233343536373839303132333435363738393031323334353637383930",
    }

  and {
    when
      misbehaviour_output.encode(
        MisbehaviourOutput { ..output, client_state: chain33 },
      )
    is {
      Some(bytes) -> bytearray.length(bytes) == 800
      None -> False
    },
    when
      misbehaviour_output.encode(
        MisbehaviourOutput { ..output, client_state: chain50 },
      )
    is {
      Some(bytes) -> bytearray.length(bytes) == 800
      None -> False
    },
  }
}

test rejects_chain_id_larger_than_50_bytes() {
  let output = fixture_output()
  let client_state = output.client_state
  misbehaviour_output.encode(
    MisbehaviourOutput {
      ..output,
      client_state: ClientState {
        ..client_state,
        chain_id: #"313233343536373839303132333435363738393031323334353637383930313233343536373839303132333435363738393031",
      },
    },
  ) == None
}

test every_proof_bound_field_changes_the_public_output() {
  let output = fixture_output()
  let height_1 = output.trusted_height_1
  let consensus_2 = output.trusted_consensus_state_2
  and {
    changes(MisbehaviourOutput { ..output, time: output.time + 1 }),
    changes(
      MisbehaviourOutput {
        ..output,
        trusted_height_1: Height {
          ..height_1,
          revision_height: height_1.revision_height + 1,
        },
      },
    ),
    changes(
      MisbehaviourOutput {
        ..output,
        trusted_consensus_state_2: ConsensusState {
          ..consensus_2,
          timestamp: consensus_2.timestamp + 1,
        },
      },
    ),
  }
}

fn changes(output: MisbehaviourOutput) -> Bool {
  when misbehaviour_output.encode(output) is {
    Some(bytes) -> bytes != fixture_public_values
    None -> False
  }
}
