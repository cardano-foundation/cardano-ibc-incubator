use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs
use aiken/interval
use cardano/address.{from_script}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, Spend,
  Transaction,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  ArchiveConsensusState, PruneConsensusState, RecoverClient, UpdateClient,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/block/header as tm_header
use ibc/client/ics_007_tendermint_client/cometbft/signed_header
use ibc/client/ics_007_tendermint_client/consensus_history.{ConsensusStateDatum}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_002_client_semantics/types/keys.{client_prefix}
use ibc/core/ics_023_vector_commitments/merkle
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateControl, HostStateDatum, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer as host_redeemer
use ibc/core/ics_025_handler_interface/ibc_state_commitment as tree
use ibc/testing/sparse_tree
use minting_client_stt
use spending_consensus_state

const host_policy = "host policy"

const client_policy = "client policy"

const client_script = "client script"

const archive_script = "archive script"

test archive_key_matches_offchain_cbor_and_sha3_vector() {
  let identity =
    AuthToken {
      policy_id: #"11111111111111111111111111111111111111111111111111111111",
      name: #"22",
    }
  let key =
    consensus_history.ConsensusStateKey {
      client_token: identity,
      height: Height { revision_number: 0, revision_height: 1 },
    }
  and {
    cbor.serialise(key) == #"d8799fd8799f581c111111111111111111111111111111111111111111111111111111114122ffd8799f0001ffff",
    consensus_history.asset_name(identity, key.height) == #"8a9809d798ed7117cb8269bda61fb07c0cbe54b62eb0ed59ef6175b5c55dc99c",
  }
}

test archive_key_does_not_depend_on_input_constructor_encoding() {
  expect Some(raw_token) =
    cbor.deserialise(
      #"d87982581c111111111111111111111111111111111111111111111111111111114122",
    )
  expect identity: AuthToken = raw_token
  expect Some(raw_height) = cbor.deserialise(#"d879820001")
  expect h: Height = raw_height
  consensus_history.asset_name(identity, h) == #"8a9809d798ed7117cb8269bda61fb07c0cbe54b62eb0ed59ef6175b5c55dc99c"
}

fn client_token() -> AuthToken {
  AuthToken {
    policy_id: client_policy,
    name: auth.generate_token_name(
      AuthToken { policy_id: host_policy, name: host_state_token_name },
      client_prefix,
      "0",
    ),
  }
}

fn height(n: Int) -> Height {
  Height { revision_number: 0, revision_height: n }
}

fn client(n: Int) -> ClientDatum {
  let h = height(n)
  ClientDatum {
    token: client_token(),
    state: ClientDatumState {
      client_state: ClientState {
        chain_id: "chain-0",
        trust_level: unchecked_rational.new(1, 3),
        trusting_period: 100_000_000,
        unbonding_period: 200_000_000,
        max_clock_drift: 1,
        frozen_height: height(0),
        latest_height: h,
        proof_specs: [],
      },
      consensus_states: [
        Pair(
          h,
          ConsensusState {
            timestamp: n * 1_000_000,
            next_validators_hash: #"11",
            root: merkle.new_merkle_root(#"22"),
          },
        ),
      ],
      processed_times: [Pair(h, n * 1_000_000 + 500)],
      processed_heights: [Pair(h, n + 3)],
    },
  }
}

fn output(token: AuthToken, datum: Data, script: ByteArray) -> Output {
  Output {
    address: from_script(script),
    value: assets.from_asset(token.policy_id, token.name, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn input(token: AuthToken, datum: Data, script: ByteArray, index: Int) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"00",
      output_index: index,
    },
    output: output(token, datum, script),
  }
}

fn archive(record: ConsensusStateDatum) -> Input {
  input(
    consensus_history.token(record.client_token, record.height),
    record,
    archive_script,
    2,
  )
}

fn fixture(prune: Bool) -> Transaction {
  let old = client(1)
  let record = consensus_history.from_client(old)
  let archive_token = consensus_history.token(old.token, record.height)
  let old_entries =
    if prune {
      [
        Pair(
          "clients/07-tendermint-0/consensusStates/1",
          cbor.serialise(record.consensus_state),
        ),
      ]
    } else {
      [
        Pair(
          "clients/07-tendermint-0/consensusStates/1",
          cbor.serialise(record.consensus_state),
        ),
        Pair(
          "clients/07-tendermint-0/clientState",
          cbor.serialise(old.state.client_state),
        ),
      ]
    }
  let updated = client(2)
  expect [Pair(_, new_consensus)] = updated.state.consensus_states
  let after_client_entries =
    [
      Pair(
        "clients/07-tendermint-0/consensusStates/1",
        cbor.serialise(record.consensus_state),
      ),
      Pair(
        "clients/07-tendermint-0/clientState",
        cbor.serialise(updated.state.client_state),
      ),
    ]
  let next_root =
    if prune {
      tree.empty_hash
    } else {
      sparse_tree.root(
        [
          Pair(
            "clients/07-tendermint-0/consensusStates/2",
            cbor.serialise(new_consensus),
          ),
          ..after_client_entries
        ],
      )
    }
  let siblings =
    sparse_tree.siblings(
      old_entries,
      "clients/07-tendermint-0/consensusStates/1",
    )
  let old_root = sparse_tree.root(old_entries)
  let host_datum =
    HostStateDatum {
      nft_policy: host_policy,
      deployer: #"aa",
      control: HostStateControl { port_registry: [], shutdown: Active },
      state: HostState {
        version: 0,
        ibc_state_root: old_root,
        next_client_sequence: 1,
        next_connection_sequence: 0,
        next_channel_sequence: 0,
        bound_port: [],
        last_update_time: 0,
      },
    }
  let new_host =
    HostStateDatum {
      ..host_datum,
      state: HostState {
        ..host_datum.state,
        version: 1,
        ibc_state_root: next_root,
      },
    }
  let host =
    input(
      AuthToken { policy_id: host_policy, name: host_state_token_name },
      host_datum,
      "host script",
      0,
    )
  let live = input(old.token, old, client_script, 1)
  let host_action: Redeemer =
    if prune {
      host_redeemer.PruneConsensusState {
        client_token: old.token,
        height: record.height,
        consensus_state_siblings: siblings,
      }
    } else {
      host_redeemer.UpdateClient {
        client_state_siblings: sparse_tree.siblings(
          old_entries,
          "clients/07-tendermint-0/clientState",
        ),
        consensus_state_siblings: sparse_tree.siblings(
          after_client_entries,
          "clients/07-tendermint-0/consensusStates/2",
        ),
        removed_consensus_state_siblings: [],
      }
    }
  let mint_action: Redeemer =
    if prune {
      PruneConsensusState { client_token: old.token, height: record.height }
    } else {
      ArchiveConsensusState { client_token: old.token }
    }
  let client_action: Redeemer =
    RecoverClient {
      substitute_token: AuthToken { policy_id: client_policy, name: #"ff" },
    }
  Transaction {
    ..transaction.placeholder,
    inputs: if prune {
      [host, archive(record)]
    } else {
      [host, live]
    },
    reference_inputs: if prune {
      [input(old.token, client(2), client_script, 3)]
    } else {
      []
    },
    outputs: if prune {
      [
        output(
          AuthToken { policy_id: host_policy, name: host_state_token_name },
          new_host,
          "host script",
        ),
      ]
    } else {
      [
        output(old.token, client(2), client_script),
        archive(record).output,
        output(
          AuthToken { policy_id: host_policy, name: host_state_token_name },
          new_host,
          "host script",
        ),
      ]
    },
    mint: assets.from_asset(
      client_policy,
      archive_token.name,
      if prune {
        -1
      } else {
        1
      },
    ),
    validity_range: interval.between(101, 102),
    redeemers: [
      Pair(Spend(host.output_reference), host_action),
      Pair(Spend(live.output_reference), client_action),
      Pair(Mint(client_policy), mint_action),
    ],
  }
}

const archive_fixture = fixture(False)

const pruning_fixture = fixture(True)

// Isolate the mint policy's output binding. Signature verification remains in
// spend_client and is exercised with real signed headers in the ledger tests.
fn normal_update_fixture() -> Transaction {
  let tx = archive_fixture
  expect [client_output, record_output, host_output] = tx.outputs
  let next = client(2)
  let processed = 3_000_000
  let next =
    ClientDatum {
      ..next,
      state: ClientDatumState {
        ..next.state,
        processed_times: [Pair(height(2), processed)],
        processed_heights: [
          Pair(height(2), client_datum.processed_height_from_time(processed)),
        ],
      },
    }
  let base = header.null_header()
  let h =
    header.Header {
      ..base,
      signed_header: signed_header.SignedHeader {
        ..base.signed_header,
        header: tm_header.TmHeader {
          ..base.signed_header.header,
          chain_id: "chain-0",
          height: 2,
          time: 2_000_000,
          next_validators_hash: #"11",
          app_hash: #"22",
        },
      },
    }
  let action: Redeemer = UpdateClient { msg: HeaderCase(h) }
  expect [host_action, Pair(client_purpose, _), mint_action] = tx.redeemers
  Transaction {
    ..tx,
    validity_range: interval.between(3, 4),
    outputs: [
      Output { ..client_output, datum: InlineDatum(next) },
      record_output,
      host_output,
    ],
    redeemers: [host_action, Pair(client_purpose, action), mint_action],
  }
}

const normal_fixture = normal_update_fixture()

fn check_archive(tx: Transaction) -> Bool {
  minting_client_stt.mint_client_stt.mint(
    client_script,
    host_policy,
    archive_script,
    ArchiveConsensusState { client_token: client_token() },
    client_policy,
    tx,
  )
}

fn check_prune(tx: Transaction) -> Bool {
  minting_client_stt.mint_client_stt.mint(
    client_script,
    host_policy,
    archive_script,
    PruneConsensusState { client_token: client_token(), height: height(1) },
    client_policy,
    tx,
  )
}

test archive_authenticates_exact_checkpoint_and_metadata() {
  check_archive(archive_fixture)
}

test normal_update_mint_binds_checkpoint_and_processing_metadata() {
  check_archive(normal_fixture)
}

test normal_update_mint_rejects_wrong_processing_time() fail {
  let tx = normal_fixture
  expect [client_output, record_output, host_output] = tx.outputs
  expect InlineDatum(raw) = client_output.datum
  expect next: ClientDatum = raw
  let forged =
    ClientDatum {
      ..next,
      state: ClientDatumState {
        ..next.state,
        processed_times: [Pair(height(2), 3_000_001)],
      },
    }
  check_archive(
    Transaction {
      ..tx,
      outputs: [
        Output { ..client_output, datum: InlineDatum(forged) },
        record_output,
        host_output,
      ],
    },
  )
}

test normal_update_mint_rejects_wrong_checkpoint_even_with_matching_root() fail {
  let tx = normal_fixture
  expect [client_output, record_output, host_output] = tx.outputs
  expect InlineDatum(raw_client) = client_output.datum
  expect next: ClientDatum = raw_client
  expect [Pair(h, consensus)] = next.state.consensus_states
  let wrong_consensus =
    ConsensusState { ..consensus, root: merkle.new_merkle_root(#"99") }
  let forged =
    ClientDatum {
      ..next,
      state: ClientDatumState {
        ..next.state,
        consensus_states: [Pair(h, wrong_consensus)],
      },
    }
  expect InlineDatum(raw_host) = host_output.datum
  expect host: HostStateDatum = raw_host
  let old_record = consensus_history.from_client(client(1))
  let forged_host =
    HostStateDatum {
      ..host,
      state: HostState {
        ..host.state,
        ibc_state_root: sparse_tree.root(
          [
            Pair(
              "clients/07-tendermint-0/consensusStates/1",
              cbor.serialise(old_record.consensus_state),
            ),
            Pair(
              "clients/07-tendermint-0/clientState",
              cbor.serialise(next.state.client_state),
            ),
            Pair(
              "clients/07-tendermint-0/consensusStates/2",
              cbor.serialise(wrong_consensus),
            ),
          ],
        ),
      },
    }
  check_archive(
    Transaction {
      ..tx,
      outputs: [
        Output { ..client_output, datum: InlineDatum(forged) },
        record_output,
        Output { ..host_output, datum: InlineDatum(forged_host) },
      ],
    },
  )
}

test archive_rejects_missing_output() fail {
  let tx = archive_fixture
  expect [client_output, _, host_output] = tx.outputs
  check_archive(Transaction { ..tx, outputs: [client_output, host_output] })
}

test archive_rejects_changed_processing_time() fail {
  let tx = archive_fixture
  expect [_, _, host_output] = tx.outputs
  let record = consensus_history.from_client(client(1))
  check_archive(
    Transaction {
      ..tx,
      outputs: [
        output(client_token(), client(2), client_script),
        archive(
          ConsensusStateDatum {
            ..record,
            processed_time: record.processed_time + 1,
          },
        ).output,
        host_output,
      ],
    },
  )
}

test archive_rejects_movable_output() fail {
  let tx = archive_fixture
  expect [_, _, host_output] = tx.outputs
  let record = consensus_history.from_client(client(1))
  check_archive(
    Transaction {
      ..tx,
      outputs: [
        output(client_token(), client(2), client_script),
        output(
          consensus_history.token(record.client_token, record.height),
          record,
          "wrong script",
        ),
        host_output,
      ],
    },
  )
}

test prune_accepts_exact_expiry_boundary() {
  check_prune(pruning_fixture)
}

test prune_rejects_unexpired_checkpoint() fail {
  let tx = pruning_fixture
  check_prune(Transaction { ..tx, validity_range: interval.between(100, 102) })
}

test prune_rejects_latest_checkpoint() fail {
  let tx = pruning_fixture
  check_prune(
    Transaction {
      ..tx,
      reference_inputs: [input(client_token(), client(1), client_script, 3)],
    },
  )
}

test prune_rejects_missing_client_reference() fail {
  let tx = pruning_fixture
  check_prune(Transaction { ..tx, reference_inputs: [] })
}

test prune_rejects_wrong_committed_root() fail {
  let tx = pruning_fixture
  expect [host_output] = tx.outputs
  expect InlineDatum(raw) = host_output.datum
  expect host: HostStateDatum = raw
  let forged =
    HostStateDatum {
      ..host,
      state: HostState {
        ..host.state,
        ibc_state_root: #"1111111111111111111111111111111111111111111111111111111111111111",
      },
    }
  check_prune(
    Transaction {
      ..tx,
      outputs: [Output { ..host_output, datum: InlineDatum(forged) }],
    },
  )
}

test prune_rejects_different_host_height() fail {
  let tx = pruning_fixture
  expect [Pair(purpose, _), ..rest] = tx.redeemers
  let wrong: Redeemer =
    host_redeemer.PruneConsensusState {
      client_token: client_token(),
      height: height(2),
      consensus_state_siblings: list.repeat(
        tree.empty_hash,
        tree.merkle_depth_bits,
      ),
    }
  check_prune(Transaction { ..tx, redeemers: [Pair(purpose, wrong), ..rest] })
}

test prune_rejects_wrong_old_consensus_leaf() fail {
  let tx = pruning_fixture
  expect [host, old_archive] = tx.inputs
  let record = consensus_history.from_client(client(1))
  let changed =
    ConsensusStateDatum {
      ..record,
      consensus_state: ConsensusState {
        ..record.consensus_state,
        root: merkle.new_merkle_root(#"99"),
      },
    }
  check_prune(
    Transaction {
      ..tx,
      inputs: [
        host,
        Input {
          ..old_archive,
          output: Output { ..old_archive.output, datum: InlineDatum(changed) },
        },
      ],
    },
  )
}

test proof_height_lookup_keeps_checkpoint_and_delay_metadata() {
  let old = consensus_history.from_client(client(1))
  let expanded =
    consensus_history.with_reference_at_height(
      client(2),
      [archive(old)],
      2_000_000,
      Some(old.height),
    )
  and {
    pairs.get_first(expanded.state.consensus_states, old.height) == Some(
      old.consensus_state,
    ),
    pairs.get_first(expanded.state.processed_times, old.height) == Some(
      old.processed_time,
    ),
    pairs.get_first(expanded.state.processed_heights, old.height) == Some(
      old.processed_height,
    ),
  }
}

test proof_height_lookup_matches_definite_encoded_current_and_historical_heights() {
  expect Some(raw_current) = cbor.deserialise(#"d879820002")
  expect current: Height = raw_current
  expect Some(raw_old) = cbor.deserialise(#"d879820001")
  expect old_height: Height = raw_old
  let live = client(2)
  let old = consensus_history.from_client(client(1))
  let expanded =
    consensus_history.with_reference_at_height(
      live,
      [archive(old)],
      2_000_000,
      Some(old_height),
    )
  and {
    consensus_history.with_reference_at_height(
      live,
      [],
      2_000_000,
      Some(current),
    ) == live,
    list.length(expanded.state.consensus_states) == 2,
    pairs.get_first(expanded.state.processed_times, old_height) == Some(
      old.processed_time,
    ),
  }
}

test proof_height_lookup_rejects_missing_historical_nft() fail {
  consensus_history.with_reference_at_height(
    client(2),
    [],
    2_000_000,
    Some(height(1)),
  ) == client(2)
}

test proof_height_lookup_rejects_forged_client_identity() fail {
  let old = consensus_history.from_client(client(1))
  let real = archive(old)
  let forged =
    ConsensusStateDatum {
      ..old,
      client_token: AuthToken { ..old.client_token, name: #"ff" },
    }
  let input =
    Input {
      ..real,
      output: Output { ..real.output, datum: InlineDatum(forged) },
    }
  consensus_history.with_reference_at_height(
    client(2),
    [input],
    2_000_000,
    Some(old.height),
  ) == client(2)
}

test proof_height_lookup_rejects_wrong_datum_height() fail {
  let old = consensus_history.from_client(client(1))
  let real = archive(old)
  let forged = ConsensusStateDatum { ..old, height: height(3) }
  let input =
    Input {
      ..real,
      output: Output { ..real.output, datum: InlineDatum(forged) },
    }
  consensus_history.with_reference_at_height(
    client(2),
    [input],
    2_000_000,
    Some(old.height),
  ) == client(2)
}

test proof_height_lookup_rejects_expired_history() fail {
  let old = consensus_history.from_client(client(1))
  consensus_history.with_reference_at_height(
    client(2),
    [archive(old)],
    101_000_000,
    Some(height(1)),
  ) == client(2)
}

test immutable_archive_spend_requires_matching_host_and_burn() {
  let record = consensus_history.from_client(client(1))
  spending_consensus_state.spend_consensus_state.spend(
    host_policy,
    Some(record),
    Void,
    archive(record).output_reference,
    pruning_fixture,
  )
}

test immutable_archive_rejects_no_burn() fail {
  let record = consensus_history.from_client(client(1))
  let tx = pruning_fixture
  spending_consensus_state.spend_consensus_state.spend(
    host_policy,
    Some(record),
    Void,
    archive(record).output_reference,
    Transaction { ..tx, mint: assets.zero },
  )
}

test historical_reference_preserves_processing_metadata() {
  let old = consensus_history.from_client(client(1))
  let expanded =
    consensus_history.with_reference_history(
      client(2),
      [archive(old)],
      2_000_000,
    )
  and {
    pairs.get_first(expanded.state.consensus_states, old.height) == Some(
      old.consensus_state,
    ),
    pairs.get_first(expanded.state.processed_times, old.height) == Some(
      old.processed_time,
    ),
    pairs.get_first(expanded.state.processed_heights, old.height) == Some(
      old.processed_height,
    ),
  }
}

test forged_history_without_nft_is_not_trusted() {
  let old = consensus_history.from_client(client(1))
  let forged = archive(old)
  consensus_history.with_reference_history(
    client(2),
    [Input { ..forged, output: Output { ..forged.output, value: assets.zero } }],
    2_000_000,
  ) == client(2)
}

test wrong_client_archive_is_not_trusted() {
  let old = consensus_history.from_client(client(1))
  let other =
    ConsensusStateDatum {
      ..old,
      client_token: AuthToken { ..old.client_token, name: #"ff" },
    }
  consensus_history.with_reference_history(
    client(2),
    [archive(other)],
    2_000_000,
  ) == client(2)
}

test expired_history_is_not_available_for_proofs() {
  let old = consensus_history.from_client(client(1))
  consensus_history.with_reference_history(
    client(2),
    [archive(old)],
    101_000_000,
  ) == client(2)
}

test duplicate_history_reference_is_rejected() fail {
  let old = consensus_history.from_client(client(1))
  consensus_history.with_reference_history(
    client(2),
    [archive(old), archive(old)],
    2_000_000,
  ) == client(2)
}

test archive_rejects_wrong_committed_root() fail {
  let tx = archive_fixture
  expect [client_output, archive_output, host_output] = tx.outputs
  expect InlineDatum(raw) = host_output.datum
  expect host: HostStateDatum = raw
  let forged =
    HostStateDatum {
      ..host,
      state: HostState { ..host.state, ibc_state_root: tree.empty_hash },
    }
  check_archive(
    Transaction {
      ..tx,
      outputs: [
        client_output,
        archive_output,
        Output { ..host_output, datum: InlineDatum(forged) },
      ],
    },
  )
}

test archive_rejects_two_client_continuations() fail {
  let tx = archive_fixture
  check_archive(
    Transaction {
      ..tx,
      outputs: [
        output(
          AuthToken { policy_id: client_policy, name: #"ff" },
          client(2),
          client_script,
        ),
        ..tx.outputs
      ],
    },
  )
}

test archive_rejects_different_staking_address() fail {
  let tx = archive_fixture
  expect [client_output, archive_output, host_output] = tx.outputs
  let staked =
    Output {
      ..archive_output,
      address: address.with_delegation_script(archive_output.address, #"1122"),
    }
  check_archive(
    Transaction { ..tx, outputs: [client_output, staked, host_output] },
  )
}
