use aiken/crypto.{Blake2b_224, Hash, Script, VerificationKeyHash}
use aiken/interval
use cardano/address.{from_script, from_verification_key}
use cardano/assets.{PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, Spend, Transaction,
  placeholder,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_redeemer as client_redeemer
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_003_connection_semantics/connection_datum.{
  ConnectionActive, ConnectionDatum, Retiring,
}
use ibc/core/ics_003_connection_semantics/connection_redeemer as connection_redeemer
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/state.{Open}
use ibc/core/ics_003_connection_semantics/types/version
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateDatum, empty_ibc_state_root, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer as host_redeemer
use ibc/core/ics_025_handler_interface/reclamation
use minting_client_stt
use minting_connection_stt
use spending_client
use spending_connection

const host_policy: PolicyId =
  #"01010101010101010101010101010101010101010101010101010101"

const client_policy: PolicyId =
  #"02020202020202020202020202020202020202020202020202020202"

const connection_policy: PolicyId =
  #"03030303030303030303030303030303030303030303030303030303"

const client_script_hash: Hash<Blake2b_224, Script> =
  #"04040404040404040404040404040404040404040404040404040404"

const connection_script_hash: Hash<Blake2b_224, Script> =
  #"05050505050505050505050505050505050505050505050505050505"

const host_script_hash: Hash<Blake2b_224, Script> =
  #"06060606060606060606060606060606060606060606060606060606"

const deployer: VerificationKeyHash =
  #"07070707070707070707070707070707070707070707070707070707"

const reclaim_to: VerificationKeyHash =
  #"08080808080808080808080808080808080808080808080808080808"

const other_reclaim_to: VerificationKeyHash =
  #"09090909090909090909090909090909090909090909090909090909"

const client_lovelace = 2_000_000

const connection_lovelace = 3_000_000

const host_ref =
  OutputReference {
    transaction_id: #"1010101010101010101010101010101010101010101010101010101010101010",
    output_index: 0,
  }

const client_ref =
  OutputReference {
    transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
    output_index: 0,
  }

const connection_ref =
  OutputReference {
    transaction_id: #"1212121212121212121212121212121212121212121212121212121212121212",
    output_index: 0,
  }

fn host_datum() -> HostStateDatum {
  HostStateDatum {
    state: HostState {
      version: 1,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 1,
      next_connection_sequence: 1,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
      live_client_count: 1,
      live_connection_count: 1,
      live_channel_count: 0,
    },
    nft_policy: host_policy,
    deployer,
    shutdown: Active,
  }
}

fn host_output() -> Output {
  Output {
    address: from_script(host_script_hash),
    value: assets.from_lovelace(2_000_000)
      |> assets.add(host_policy, host_state_token_name, 1),
    datum: InlineDatum(host_datum()),
    reference_script: None,
  }
}

fn host_input() -> Input {
  Input { output_reference: host_ref, output: host_output() }
}

fn payout(to: VerificationKeyHash, lovelace: Int) -> Output {
  Output {
    address: from_verification_key(to),
    value: assets.from_lovelace(lovelace),
    datum: InlineDatum(Void),
    reference_script: None,
  }
}

fn client_token() -> AuthToken {
  AuthToken { policy_id: client_policy, name: "client token" }
}

fn terminal_client_datum() -> ClientDatum {
  let latest_height = Height { revision_number: 1, revision_height: 10 }
  let consensus_state =
    ConsensusState {
      timestamp: 0,
      next_validators_hash: "validators",
      root: MerkleRoot { hash: "root" },
    }

  ClientDatum {
    state: ClientDatumState {
      client_state: ClientState {
        chain_id: "chain-1",
        trust_level: unchecked_rational.from_int(1),
        trusting_period: 1,
        unbonding_period: 2,
        max_clock_drift: 1,
        frozen_height: Height { revision_number: 1, revision_height: 1 },
        latest_height,
        proof_specs: [],
      },
      consensus_states: [Pair(latest_height, consensus_state)],
      processed_times: [Pair(latest_height, 0)],
      processed_heights: [Pair(latest_height, 0)],
    },
    token: client_token(),
  }
}

fn client_input() -> Input {
  Input {
    output_reference: client_ref,
    output: Output {
      address: from_script(client_script_hash),
      value: assets.from_lovelace(client_lovelace)
        |> assets.add(client_policy, client_token().name, 1),
      datum: InlineDatum(terminal_client_datum()),
      reference_script: None,
    },
  }
}

fn client_reclaim_transaction(
  bounty: Int,
  spend_reclaim_to: VerificationKeyHash,
) -> Transaction {
  let object_redeemer: Redeemer =
    client_redeemer.ReclaimClient { reclaim_to: spend_reclaim_to }
  let host_state_redeemer: Redeemer =
    host_redeemer.ReclaimClient {
      reclaim_to: spend_reclaim_to,
      client_state_siblings: [],
      consensus_state_siblings: [],
      client_connection_count_siblings: [],
    }

  Transaction {
    ..placeholder,
    inputs: [host_input(), client_input()],
    outputs: [host_output(), payout(spend_reclaim_to, bounty)],
    mint: assets.from_asset(client_policy, client_token().name, -1),
    validity_range: interval.after(1),
    redeemers: [
      Pair(Spend(host_ref), host_state_redeemer),
      Pair(Spend(client_ref), object_redeemer),
    ],
  }
}

fn validate_client_reclaim(
  transaction: Transaction,
  mint_reclaim_to: VerificationKeyHash,
) -> Bool {
  and {
    spending_client.spend_client.spend(
      host_policy,
      Some(terminal_client_datum()),
      client_redeemer.ReclaimClient { reclaim_to },
      client_ref,
      transaction,
    )?,
    minting_client_stt.mint_client_stt.mint(
      client_script_hash,
      host_policy,
      client_redeemer.BurnClient {
        token: client_token(),
        reclaim_to: mint_reclaim_to,
      },
      client_policy,
      transaction,
    )?,
  }
}

fn connection_token() -> AuthToken {
  AuthToken { policy_id: connection_policy, name: "connection token" }
}

fn connection_datum(
  lifecycle: connection_datum.ConnectionLifecycle,
  live_channel_count: Int,
) -> ConnectionDatum {
  ConnectionDatum {
    state: ConnectionEnd {
      client_id: "07-tendermint-0",
      versions: version.get_compatible_versions(),
      state: Open,
      counterparty: Counterparty {
        client_id: "07-tendermint-1",
        connection_id: "connection-1",
        prefix: MerklePrefix { key_prefix: "ibc" },
      },
      delay_period: 0,
    },
    token: connection_token(),
    live_channel_count,
    lifecycle,
  }
}

fn connection_input(datum: ConnectionDatum) -> Input {
  Input {
    output_reference: connection_ref,
    output: Output {
      address: from_script(connection_script_hash),
      value: assets.from_lovelace(connection_lovelace)
        |> assets.add(connection_policy, connection_token().name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  }
}

fn connection_reclaim_transaction(
  datum: ConnectionDatum,
  valid_from: Int,
) -> Transaction {
  let object_redeemer: Redeemer =
    connection_redeemer.ReclaimConnection { reclaim_to }
  let host_state_redeemer: Redeemer =
    host_redeemer.ReclaimConnection {
      reclaim_to,
      connection_siblings: [],
      client_connection_count: 1,
      client_connection_count_siblings: [],
    }

  Transaction {
    ..placeholder,
    inputs: [host_input(), connection_input(datum)],
    outputs: [host_output(), payout(reclaim_to, connection_lovelace)],
    mint: assets.from_asset(connection_policy, connection_token().name, -1),
    validity_range: interval.after(valid_from),
    redeemers: [
      Pair(Spend(host_ref), host_state_redeemer),
      Pair(Spend(connection_ref), object_redeemer),
    ],
  }
}

fn validate_connection_reclaim(
  transaction: Transaction,
  datum: ConnectionDatum,
) -> Bool {
  and {
    spending_connection.spend_connection.spend(
      client_policy,
      "verify policy",
      host_policy,
      Some(datum),
      connection_redeemer.ReclaimConnection { reclaim_to },
      connection_ref,
      transaction,
    )?,
    minting_connection_stt.mint_connection_stt.mint(
      client_policy,
      "verify policy",
      connection_script_hash,
      host_policy,
      connection_redeemer.BurnConnection {
        token: connection_token(),
        reclaim_to,
      },
      connection_policy,
      transaction,
    )?,
  }
}

test client_reclaim_spend_and_burn_accept_exact_terminal_cleanup() {
  client_reclaim_transaction(client_lovelace, reclaim_to)
    |> validate_client_reclaim(reclaim_to)
}

test client_burn_rejects_a_reclaim_target_not_bound_to_both_spends() fail {
  client_reclaim_transaction(client_lovelace, reclaim_to)
    |> validate_client_reclaim(other_reclaim_to)
}

test client_spend_rejects_an_underpaid_cleanup_bounty() fail {
  client_reclaim_transaction(client_lovelace - 1, reclaim_to)
    |> validate_client_reclaim(reclaim_to)
}

test connection_reclaim_spend_and_burn_accept_zero_child_cleanup() {
  let not_before = 50
  let datum = connection_datum(Retiring { not_before }, 0)
  connection_reclaim_transaction(datum, not_before)
    |> validate_connection_reclaim(datum)
}

test connection_reclaim_rejects_before_the_retirement_deadline() fail {
  let not_before = 50
  let datum = connection_datum(Retiring { not_before }, 0)
  connection_reclaim_transaction(datum, not_before - 1)
    |> validate_connection_reclaim(datum)
}

test connection_reclaim_rejects_a_live_child_channel() fail {
  let not_before = 50
  let datum = connection_datum(Retiring { not_before }, 1)
  connection_reclaim_transaction(datum, not_before)
    |> validate_connection_reclaim(datum)
}

fn validate_begin_retirement(has_deployer_signature: Bool) -> Bool {
  let valid_from = 1_000
  let not_before = reclamation.connection_retirement_not_before(valid_from)
  let input_datum = connection_datum(ConnectionActive, 1)
  let output_datum =
    ConnectionDatum { ..input_datum, lifecycle: Retiring { not_before } }
  let host_state_redeemer: Redeemer = host_redeemer.BeginConnectionRetirement
  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input(), connection_input(input_datum)],
      outputs: [
        host_output(),
        Output {
          ..connection_input(input_datum).output,
          datum: InlineDatum(output_datum),
        },
      ],
      validity_range: interval.after(valid_from),
      extra_signatories: if has_deployer_signature {
        [deployer]
      } else {
        []
      },
      redeemers: [Pair(Spend(host_ref), host_state_redeemer)],
    }

  spending_connection.spend_connection.spend(
    client_policy,
    "verify policy",
    host_policy,
    Some(input_datum),
    connection_redeemer.BeginConnectionRetirement { not_before },
    connection_ref,
    transaction,
  )
}

test connection_retirement_accepts_the_fixed_delay_and_deployer_signature() {
  validate_begin_retirement(True)
}

test connection_retirement_rejects_a_missing_deployer_signature() fail {
  validate_begin_retirement(False)
}

test connection_decrement_channel_count_accepts_reclaim_channel_companion() {
  let input_datum = connection_datum(ConnectionActive, 1)
  let output_datum = ConnectionDatum { ..input_datum, live_channel_count: 0 }
  let host_state_redeemer: Redeemer =
    host_redeemer.ReclaimChannel {
      reclaim_to,
      channel_siblings: [],
      next_sequence_send_siblings: [],
      next_sequence_recv_siblings: [],
      next_sequence_ack_siblings: [],
    }
  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input(), connection_input(input_datum)],
      outputs: [
        host_output(),
        Output {
          ..connection_input(input_datum).output,
          datum: InlineDatum(output_datum),
        },
      ],
      redeemers: [Pair(Spend(host_ref), host_state_redeemer)],
    }

  spending_connection.spend_connection.spend(
    client_policy,
    "verify policy",
    host_policy,
    Some(input_datum),
    connection_redeemer.DecrementChannelCount,
    connection_ref,
    transaction,
  )
}
