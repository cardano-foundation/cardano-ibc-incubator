use aiken/crypto.{Blake2b_224, Hash, Script}
use aiken/interval
use aiken/primitive/int
use cardano/address.{from_script}
use cardano/assets.{PolicyId, add, from_asset}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, ValidityRange,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState} as client_state_mod
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_002_client_semantics/types/keys as client_keys_mod
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as conn_counterparty_mod
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys_mod
use ibc/core/ics_003_connection_semantics/types/state as conn_state_mod
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_005/types/keys as port_keys_mod
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  InnerSpec, LeafOp, ProofSpec,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateDatum, ModuleRegistration, empty_ibc_state_root,
  host_state_token_name,
}

pub type MockData {
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
  channel_minting_policy_id: PolicyId,
  chan_open_ack_policy_id: PolicyId,
  chan_open_confirm_policy_id: PolicyId,
  recv_packet_policy_id: PolicyId,
  send_packet_policy_id: PolicyId,
  timeout_packet_policy_id: PolicyId,
  acknowledge_packet_policy_id: PolicyId,
  chan_close_init_policy_id: PolicyId,
  chan_close_confirm_policy_id: PolicyId,
  channel_id: ByteArray,
  channel_sequence: ByteArray,
  channel_token: AuthToken,
  base_token: AuthToken,
  connection_id: ByteArray,
  connection_input: Input,
  client_input: Input,
  validity_range: ValidityRange,
  port_id: ByteArray,
  host_state_nft_policy_id: PolicyId,
  host_state_input: Input,
  module_token: AuthToken,
  module_input: Input,
}

pub fn setup() -> MockData {
  let host_state_nft_policy_id: PolicyId = "mock host state nft policy id"
  let base_token =
    AuthToken {
      name: host_state_token_name,
      policy_id: host_state_nft_policy_id,
    }

  //========================Channel============================
  let channel_id = "channel-0"
  let channel_sequence = "0"
  let channel_minting_policy_id = "mock channel_minting_policy_id"

  let channel_token_name =
    auth.generate_token_name(
      base_token,
      chan_keys_mod.channel_prefix,
      channel_sequence,
    )
  let channel_token =
    AuthToken { policy_id: channel_minting_policy_id, name: channel_token_name }

  //========================Connection============================
  let connection_datum =
    ConnectionDatum {
      state: ConnectionEnd {
        client_id: "07-tendermint-10",
        versions: [
          Version {
            identifier: "1",
            features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
          },
        ],
        state: conn_state_mod.Open,
        counterparty: Counterparty {
          client_id: "07-tendermint-0",
          connection_id: "connection-0",
          prefix: MerklePrefix { key_prefix: "ibc" },
        },
        delay_period: 0,
      },
      token: AuthToken { name: "", policy_id: "" },
    }

  let connection_id = "connection-134"

  let connection_sequence =
    conn_keys_mod.parse_connection_id_sequence(connection_id)

  let connection_token_name =
    auth.generate_token_name(
      base_token,
      conn_keys_mod.connection_prefix,
      connection_sequence,
    )

  let connection_minting_policy_id = "mock connection_minting_policy_id"

  let connection_token =
    AuthToken {
      policy_id: connection_minting_policy_id,
      name: connection_token_name,
    }

  let connection_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 0,
      },
      output: Output {
        address: from_script("mock connection script hash"),
        value: from_asset(connection_token.policy_id, connection_token.name, 1),
        datum: InlineDatum(connection_datum),
        reference_script: None,
      },
    }

  //========================Client============================
  let cons_state =
    ConsensusState {
      timestamp: 1577923295000000000,
      next_validators_hash: #"be42d79cf15375efd54cf594c9f016db8c8b8dc4e91f35f11bba000ec7e9f439",
      root: MerkleRoot {
        hash: #"3d89dd39e1f1c7a0cec08f3ebf31fcb485f42068fcb79a8aeb3a9ca9f4e7091d",
      },
    }

  let trust_level = unchecked_rational.new(1, 3)

  let proof_specs =
    [
      ProofSpec {
        leaf_spec: LeafOp {
          hash: 1,
          prehash_value: 1,
          length: 1,
          prefix: #"00",
          prehash_key: 0,
        },
        inner_spec: InnerSpec {
          child_order: [0, 1],
          child_size: 33,
          min_prefix_length: 4,
          max_prefix_length: 12,
          hash: 1,
          empty_child: #"",
        },
        max_depth: 0,
        min_depth: 0,
        prehash_key_before_comparison: False,
      },
      ProofSpec {
        leaf_spec: LeafOp {
          hash: 1,
          prehash_value: 1,
          length: 1,
          prefix: #"00",
          prehash_key: 0,
        },
        inner_spec: InnerSpec {
          child_order: [0, 1],
          child_size: 32,
          min_prefix_length: 1,
          max_prefix_length: 1,
          hash: 1,
          empty_child: #"",
        },
        max_depth: 0,
        min_depth: 0,
        prehash_key_before_comparison: False,
      },
    ]

  let client_state =
    ClientState {
      chain_id: "testchain1-1",
      trust_level,
      trusting_period: 1209600000000000,
      unbonding_period: 1814400000000000,
      max_clock_drift: 10000000000,
      frozen_height: height_mod.zero_height(),
      latest_height: Height { revision_number: 1, revision_height: 13 },
      proof_specs,
    }

  let client_sequence =
    client_keys_mod.parse_client_id_sequence(connection_datum.state.client_id)

  let client_token_name =
    auth.generate_token_name(
      base_token,
      client_keys_mod.client_prefix,
      client_sequence,
    )

  let client_minting_policy_id = "mock client_minting_policy_id"

  let client_token =
    AuthToken { policy_id: client_minting_policy_id, name: client_token_name }

  let proof_height = Height { revision_number: 1, revision_height: 13 }

  let client_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state,
        consensus_states: [Pair(proof_height, cons_state)],
        processed_times: [Pair(proof_height, 0)],
        processed_heights: [Pair(proof_height, 0)],
      },
      token: client_token,
    }

  let client_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 1,
      },
      output: Output {
        address: from_script("mock client script hash"),
        value: from_asset(client_token.policy_id, client_token.name, 1),
        datum: InlineDatum(client_datum),
        reference_script: None,
      },
    }

  //==========================ValidityRange===========================
  let valid_to =
    ( cons_state.timestamp + client_state.trusting_period ) / 1_000_000 - 1
  let validity_range = interval.before(valid_to)

  //==========================Module===========================
  let port_minting_policy_id = "mock port_minting_policy_id"

  let port_id = "port-1"
  let port_number_bytes = port_keys_mod.parse_port_id_number(port_id)
  expect Some(port_number) = int.from_utf8(port_number_bytes)
  let port_token_name =
    auth.generate_token_name(
      base_token,
      port_keys_mod.port_prefix,
      port_number_bytes,
    )
  let port_token =
    AuthToken { policy_id: port_minting_policy_id, name: port_token_name }
  let module_script_hash = "mock module script hash"
  let module_token =
    AuthToken {
      policy_id: "mock module token policy id",
      name: "mock module token name",
    }

  let module_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 2,
      },
      output: Output {
        address: from_script(module_script_hash),
        value: from_asset(port_token.policy_id, port_token.name, 1)
          |> add(module_token.policy_id, module_token.name, 1),
        datum: NoDatum,
        reference_script: None,
      },
    }

  //==========================HostState=========================
  let registration =
    ModuleRegistration { module_script_hash, port_token, module_token }
  let host_state_datum =
    HostStateDatum {
      state: HostState {
        version: 1,
        ibc_state_root: empty_ibc_state_root,
        next_client_sequence: 0,
        next_connection_sequence: 0,
        next_channel_sequence: 0,
        bound_port: [Pair(port_number, registration)],
        last_update_time: 0,
      },
      nft_policy: host_state_nft_policy_id,
      deployer: "mock deployer key hash",
      shutdown: Active,
    }
  let host_state_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 3,
      },
      output: Output {
        address: from_script("mock host state script hash"),
        value: from_asset(host_state_nft_policy_id, host_state_token_name, 1),
        datum: InlineDatum(host_state_datum),
        reference_script: None,
      },
    }

  MockData {
    client_minting_policy_id,
    connection_minting_policy_id,
    port_minting_policy_id,
    spend_channel_script_hash: "mock spend_channel_script_hash",
    channel_minting_policy_id,
    chan_open_ack_policy_id: "mock chan_open_ack_policy_id",
    chan_open_confirm_policy_id: "mock chan_open_confirm_policy_id",
    recv_packet_policy_id: "mock recv_packet_policy_id",
    send_packet_policy_id: "mock send_packet_policy_id",
    timeout_packet_policy_id: "mock timeout_packet_policy_id",
    acknowledge_packet_policy_id: "mock acknowledge_packet_policy_id",
    chan_close_init_policy_id: "fake chan close init policy id",
    chan_close_confirm_policy_id: "fake chan close init policy id",
    verify_proof_policy_id: "mock verify_proof_policy_id",
    channel_id,
    channel_sequence,
    channel_token,
    base_token,
    connection_id,
    connection_input,
    client_input,
    validity_range,
    port_id,
    host_state_nft_policy_id,
    host_state_input,
    module_token,
    module_input,
  }
}
