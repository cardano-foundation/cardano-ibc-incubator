use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/proof_update/eureka_output.{
  UpdateClientOutput,
}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational.{
  UncheckedRational,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}

const two_to_32_seconds_in_nanoseconds = 4_294_967_296_000_000_000

const two_to_64 = 18_446_744_073_709_551_616

const two_to_128 = 340_282_366_920_938_463_463_374_607_431_768_211_456

const bytes31 =
  #"00000000000000000000000000000000000000000000000000000000000000"

const bytes33 =
  #"000000000000000000000000000000000000000000000000000000000000000000"

const changed32 =
  #"0000000000000000000000000000000000000000000000000000000000000001"

const fixture_public_values =
  #"0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000018000000000000000000000000000000000000000000000000018ac5aa0090c0265aef8b4344c566856024153a6d926846fa86247d424aa9a2897acdc903e550fd9a94f05181f311848889c44bf508e23f2c12685ab4e4090c2ac093e5d6114d39e00000000000000000000000000000000000000000000000018ac5b18c746809a480cf4c31bde380d1e21ab9f8b09eb211acee7bb5b5b773529e716cc30133a3fff1ca5b63e9d71d07c9aaffcb666e2fd8d4a2cfc00d324e7e8ec665a5b61f6db00000000000000000000000000000000000000000000000018ac5b2fb3bbc46800000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000001d8647a00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000001d864d400000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000001d8647a000000000000000000000000000000000000000000000000000000000012750000000000000000000000000000000000000000000000000000000000001baf8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b636f736d6f736875622d34000000000000000000000000000000000000000000"

fn fixture_output() -> UpdateClientOutput {
  UpdateClientOutput {
    client_state: ClientState {
      chain_id: #"636f736d6f736875622d34",
      trust_level: UncheckedRational { numerator: 1, denominator: 3 },
      trusting_period: 1_209_600_000_000_000,
      unbonding_period: 1_814_400_000_000_000,
      max_clock_drift: 15_000_000_000,
      frozen_height: Height { revision_number: 0, revision_height: 0 },
      latest_height: Height { revision_number: 4, revision_height: 30_958_714 },
      proof_specs: [],
    },
    trusted_consensus_state: ConsensusState {
      timestamp: 1_777_895_596_297_552_485,
      root: MerkleRoot {
        hash: #"aef8b4344c566856024153a6d926846fa86247d424aa9a2897acdc903e550fd9",
      },
      next_validators_hash: #"a94f05181f311848889c44bf508e23f2c12685ab4e4090c2ac093e5d6114d39e",
    },
    new_consensus_state: ConsensusState {
      timestamp: 1_777_896_114_885_132_442,
      root: MerkleRoot {
        hash: #"480cf4c31bde380d1e21ab9f8b09eb211acee7bb5b5b773529e716cc30133a3f",
      },
      next_validators_hash: #"ff1ca5b63e9d71d07c9aaffcb666e2fd8d4a2cfc00d324e7e8ec665a5b61f6db",
    },
    time: 1_777_896_213_341_521_000,
    trusted_height: Height { revision_number: 4, revision_height: 30_958_714 },
    new_height: Height { revision_number: 4, revision_height: 30_958_804 },
  }
}

fn rejects(output: UpdateClientOutput) -> Bool {
  eureka_output.encode(output) == None
}

fn changes(output: UpdateClientOutput) -> Bool {
  when eureka_output.encode(output) is {
    Some(bytes) -> bytes != fixture_public_values
    None -> False
  }
}

test fixture_matches_exact_eureka_solidity_abi() {
  eureka_output.encode(fixture_output()) == Some(fixture_public_values)
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
      eureka_output.encode(
        UpdateClientOutput { ..output, client_state: chain33 },
      )
    is {
      Some(bytes) -> bytearray.length(bytes) == 800
      None -> False
    },
    when
      eureka_output.encode(
        UpdateClientOutput { ..output, client_state: chain50 },
      )
    is {
      Some(bytes) -> bytearray.length(bytes) == 800
      None -> False
    },
  }
}

test rejects_chain_id_outside_1_to_50_bytes() {
  let output = fixture_output()
  let client_state = output.client_state
  and {
    rejects(
      UpdateClientOutput {
        ..output,
        client_state: ClientState { ..client_state, chain_id: #"" },
      },
    ),
    rejects(
      UpdateClientOutput {
        ..output,
        client_state: ClientState {
          ..client_state,
          chain_id: #"313233343536373839303132333435363738393031323334353637383930313233343536373839303132333435363738393031",
        },
      },
    ),
  }
}

test rejects_invalid_uint8_or_semantic_trust_thresholds() {
  let output = fixture_output()
  let client_state = output.client_state
  and {
    rejects_with_trust(output, client_state, 0, 3),
    rejects_with_trust(output, client_state, 256, 255),
    rejects_with_trust(output, client_state, 1, 0),
    rejects_with_trust(output, client_state, 1, 256),
    rejects_with_trust(output, client_state, 1, 4),
    rejects_with_trust(output, client_state, 2, 1),
  }
}

fn rejects_with_trust(
  output: UpdateClientOutput,
  client_state: ClientState,
  numerator: Int,
  denominator: Int,
) -> Bool {
  rejects(
    UpdateClientOutput {
      ..output,
      client_state: ClientState {
        ..client_state,
        trust_level: UncheckedRational { numerator, denominator },
      },
    },
  )
}

test rejects_latest_height_outside_uint64_or_zero_revision_height() {
  let output = fixture_output()
  let client_state = output.client_state
  and {
    rejects_with_latest_height(output, client_state, -1, 1),
    rejects_with_latest_height(output, client_state, two_to_64, 1),
    rejects_with_latest_height(output, client_state, 1, 0),
    rejects_with_latest_height(output, client_state, 1, two_to_64),
  }
}

fn rejects_with_latest_height(
  output: UpdateClientOutput,
  client_state: ClientState,
  revision_number: Int,
  revision_height: Int,
) -> Bool {
  rejects(
    UpdateClientOutput {
      ..output,
      client_state: ClientState {
        ..client_state,
        latest_height: Height { revision_number, revision_height },
      },
    },
  )
}

test rejects_durations_not_representable_as_positive_uint32_seconds() {
  let output = fixture_output()
  let client_state = output.client_state
  and {
    rejects_with_durations(
      output,
      client_state,
      0,
      client_state.unbonding_period,
    ),
    rejects_with_durations(
      output,
      client_state,
      client_state.trusting_period + 1,
      client_state.unbonding_period,
    ),
    rejects_with_durations(
      output,
      client_state,
      two_to_32_seconds_in_nanoseconds,
      two_to_32_seconds_in_nanoseconds + 1_000_000_000,
    ),
    rejects_with_durations(
      output,
      client_state,
      client_state.trusting_period,
      0,
    ),
    rejects_with_durations(
      output,
      client_state,
      client_state.trusting_period,
      client_state.unbonding_period + 1,
    ),
    rejects_with_durations(
      output,
      client_state,
      client_state.trusting_period,
      two_to_32_seconds_in_nanoseconds,
    ),
    rejects_with_durations(
      output,
      client_state,
      client_state.trusting_period,
      client_state.trusting_period,
    ),
  }
}

test rejects_clock_drift_other_than_eurekas_fixed_15_seconds() {
  let output = fixture_output()
  let client_state = output.client_state
  and {
    rejects(
      UpdateClientOutput {
        ..output,
        client_state: ClientState { ..client_state, max_clock_drift: 0 },
      },
    ),
    rejects(
      UpdateClientOutput {
        ..output,
        client_state: ClientState {
          ..client_state,
          max_clock_drift: client_state.max_clock_drift + 1,
        },
      },
    ),
  }
}

fn rejects_with_durations(
  output: UpdateClientOutput,
  client_state: ClientState,
  trusting_period: Int,
  unbonding_period: Int,
) -> Bool {
  rejects(
    UpdateClientOutput {
      ..output,
      client_state: ClientState {
        ..client_state,
        trusting_period,
        unbonding_period,
      },
    },
  )
}

test rejects_consensus_timestamps_and_time_outside_uint128() {
  let output = fixture_output()
  let trusted = output.trusted_consensus_state
  let new = output.new_consensus_state
  and {
    rejects(
      UpdateClientOutput {
        ..output,
        trusted_consensus_state: ConsensusState { ..trusted, timestamp: -1 },
      },
    ),
    rejects(
      UpdateClientOutput {
        ..output,
        trusted_consensus_state: ConsensusState {
          ..trusted,
          timestamp: two_to_128,
        },
      },
    ),
    rejects(
      UpdateClientOutput {
        ..output,
        new_consensus_state: ConsensusState { ..new, timestamp: -1 },
      },
    ),
    rejects(
      UpdateClientOutput {
        ..output,
        new_consensus_state: ConsensusState { ..new, timestamp: two_to_128 },
      },
    ),
    rejects(UpdateClientOutput { ..output, time: -1 }),
    rejects(UpdateClientOutput { ..output, time: two_to_128 }),
  }
}

test rejects_each_non_bytes32_consensus_hash() {
  let output = fixture_output()
  let trusted = output.trusted_consensus_state
  let new = output.new_consensus_state
  and {
    rejects_with_trusted_root(output, trusted, bytes31),
    rejects_with_trusted_root(output, trusted, bytes33),
    rejects_with_trusted_next_hash(output, trusted, bytes31),
    rejects_with_trusted_next_hash(output, trusted, bytes33),
    rejects_with_new_root(output, new, bytes31),
    rejects_with_new_root(output, new, bytes33),
    rejects_with_new_next_hash(output, new, bytes31),
    rejects_with_new_next_hash(output, new, bytes33),
  }
}

fn rejects_with_trusted_root(
  output: UpdateClientOutput,
  state: ConsensusState,
  hash: ByteArray,
) -> Bool {
  rejects(
    UpdateClientOutput {
      ..output,
      trusted_consensus_state: ConsensusState {
        ..state,
        root: MerkleRoot { hash },
      },
    },
  )
}

fn rejects_with_trusted_next_hash(
  output: UpdateClientOutput,
  state: ConsensusState,
  hash: ByteArray,
) -> Bool {
  rejects(
    UpdateClientOutput {
      ..output,
      trusted_consensus_state: ConsensusState {
        ..state,
        next_validators_hash: hash,
      },
    },
  )
}

fn rejects_with_new_root(
  output: UpdateClientOutput,
  state: ConsensusState,
  hash: ByteArray,
) -> Bool {
  rejects(
    UpdateClientOutput {
      ..output,
      new_consensus_state: ConsensusState { ..state, root: MerkleRoot { hash } },
    },
  )
}

fn rejects_with_new_next_hash(
  output: UpdateClientOutput,
  state: ConsensusState,
  hash: ByteArray,
) -> Bool {
  rejects(
    UpdateClientOutput {
      ..output,
      new_consensus_state: ConsensusState {
        ..state,
        next_validators_hash: hash,
      },
    },
  )
}

test rejects_each_height_outside_uint64_or_with_zero_revision_height() {
  let output = fixture_output()
  and {
    rejects_with_trusted_height(output, -1, 1),
    rejects_with_trusted_height(output, two_to_64, 1),
    rejects_with_trusted_height(output, 1, 0),
    rejects_with_trusted_height(output, 1, two_to_64),
    rejects_with_new_height(output, -1, 1),
    rejects_with_new_height(output, two_to_64, 1),
    rejects_with_new_height(output, 1, 0),
    rejects_with_new_height(output, 1, two_to_64),
  }
}

fn rejects_with_trusted_height(
  output: UpdateClientOutput,
  revision_number: Int,
  revision_height: Int,
) -> Bool {
  rejects(
    UpdateClientOutput {
      ..output,
      trusted_height: Height { revision_number, revision_height },
    },
  )
}

fn rejects_with_new_height(
  output: UpdateClientOutput,
  revision_number: Int,
  revision_height: Int,
) -> Bool {
  rejects(
    UpdateClientOutput {
      ..output,
      new_height: Height { revision_number, revision_height },
    },
  )
}

// Each field represented in UpdateClientOutput must either change the exact
// ABI bytes or, for a frozen client, make the update unencodable.
test every_client_state_output_field_is_bound() {
  let output = fixture_output()
  let client_state = output.client_state
  and {
    changes(
      UpdateClientOutput {
        ..output,
        client_state: ClientState {
          ..client_state,
          chain_id: #"6f736d6f7369732d31",
        },
      },
    ),
    changes(
      UpdateClientOutput {
        ..output,
        client_state: ClientState {
          ..client_state,
          trust_level: UncheckedRational { numerator: 2, denominator: 3 },
        },
      },
    ),
    changes(
      UpdateClientOutput {
        ..output,
        client_state: ClientState {
          ..client_state,
          trust_level: UncheckedRational { numerator: 1, denominator: 2 },
        },
      },
    ),
    changes(
      UpdateClientOutput {
        ..output,
        client_state: ClientState {
          ..client_state,
          latest_height: Height {
            ..client_state.latest_height,
            revision_number: 5,
          },
        },
      },
    ),
    changes(
      UpdateClientOutput {
        ..output,
        client_state: ClientState {
          ..client_state,
          latest_height: Height {
            ..client_state.latest_height,
            revision_height: client_state.latest_height.revision_height + 1,
          },
        },
      },
    ),
    changes(
      UpdateClientOutput {
        ..output,
        client_state: ClientState {
          ..client_state,
          trusting_period: client_state.trusting_period + 1_000_000_000,
        },
      },
    ),
    changes(
      UpdateClientOutput {
        ..output,
        client_state: ClientState {
          ..client_state,
          unbonding_period: client_state.unbonding_period + 1_000_000_000,
        },
      },
    ),
    rejects(
      UpdateClientOutput {
        ..output,
        client_state: ClientState {
          ..client_state,
          frozen_height: Height { revision_number: 4, revision_height: 1 },
        },
      },
    ),
  }
}

test every_consensus_and_height_output_field_is_bound() {
  let output = fixture_output()
  let trusted = output.trusted_consensus_state
  let new = output.new_consensus_state
  and {
    changes(
      UpdateClientOutput {
        ..output,
        trusted_consensus_state: ConsensusState {
          ..trusted,
          timestamp: trusted.timestamp + 1,
        },
      },
    ),
    changes(
      UpdateClientOutput {
        ..output,
        trusted_consensus_state: ConsensusState {
          ..trusted,
          root: MerkleRoot { hash: changed32 },
        },
      },
    ),
    changes(
      UpdateClientOutput {
        ..output,
        trusted_consensus_state: ConsensusState {
          ..trusted,
          next_validators_hash: changed32,
        },
      },
    ),
    changes(
      UpdateClientOutput {
        ..output,
        new_consensus_state: ConsensusState {
          ..new,
          timestamp: new.timestamp + 1,
        },
      },
    ),
    changes(
      UpdateClientOutput {
        ..output,
        new_consensus_state: ConsensusState {
          ..new,
          root: MerkleRoot { hash: changed32 },
        },
      },
    ),
    changes(
      UpdateClientOutput {
        ..output,
        new_consensus_state: ConsensusState {
          ..new,
          next_validators_hash: changed32,
        },
      },
    ),
    changes(UpdateClientOutput { ..output, time: output.time + 1 }),
    changes(
      UpdateClientOutput {
        ..output,
        trusted_height: Height {
          ..output.trusted_height,
          revision_number: output.trusted_height.revision_number + 1,
        },
      },
    ),
    changes(
      UpdateClientOutput {
        ..output,
        trusted_height: Height {
          ..output.trusted_height,
          revision_height: output.trusted_height.revision_height + 1,
        },
      },
    ),
    changes(
      UpdateClientOutput {
        ..output,
        new_height: Height {
          ..output.new_height,
          revision_number: output.new_height.revision_number + 1,
        },
      },
    ),
    changes(
      UpdateClientOutput {
        ..output,
        new_height: Height {
          ..output.new_height,
          revision_height: output.new_height.revision_height + 1,
        },
      },
    ),
  }
}
