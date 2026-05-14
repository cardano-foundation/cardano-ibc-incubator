use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/interval.{Finite}
use aiken/option.{map}
use aiken/primitive/bytearray
use cardano/assets.{
  AssetName, PolicyId, Value, ada_asset_name, ada_policy_id, quantity_of, tokens,
}
use cardano/transaction.{
  InlineDatum, Input, Output, Redeemer, ScriptPurpose, Spend, ValidityRange,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/core/ics_002_client_semantics/types/keys as client_keys
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/keys as connection_keys
use ibc/core/ics_004/channel_datum.{ChannelDatum}
use ibc/core/ics_004/channel_redeemer.{SpendChannelRedeemer}
use ibc/core/ics_005/types/ibc_module_redeemer.{IBCModuleRedeemer}
use ibc/core/ics_005/types/keys as port_keys
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/core/ics_025_handler_interface/host_state_redeemer as host_state_redeemer

pub type ExpectedHostStateRedeemer {
  ExpectUpdateClient
  ExpectUpdateConnection
  ExpectUpdateChannel
  ExpectHandlePacket
}

type PosixTime =
  Int

pub fn get_inline_datum(output: Output) -> Data {
  expect InlineDatum(data) = output.datum
  data
}

pub fn quantity_token_output(
  outputs: List<Output>,
  policy_id: PolicyId,
  asset_name: AssetName,
) -> Int {
  outputs
    |> list.reduce(
        0,
        fn(prev, cur) {
          prev + (
            cur.value
              |> quantity_of(policy_id, asset_name)
          )
        },
      )
}

pub fn quantity_token_input(
  inputs: List<Input>,
  policy_id: PolicyId,
  asset_name: AssetName,
) -> Int {
  inputs
    |> list.map(fn(input) { input.output })
    |> quantity_token_output(policy_id, asset_name)
}

pub fn get_tx_valid_to(validity_range: ValidityRange) -> PosixTime {
  let upper_bound = validity_range.upper_bound

  // TODO: unable to set this value with Lucid
  // expect upper_bound.is_inclusive
  expect Finite(valid_to) = upper_bound.bound_type

  valid_to
}

pub fn get_tx_valid_from(validity_range: ValidityRange) -> PosixTime {
  let lower_bound = validity_range.lower_bound

  if lower_bound.is_inclusive {
    expect Finite(valid_from) = lower_bound.bound_type
    valid_from
  } else {
    fail @"Lower bound is not inclusive"
  }
}

pub fn extract_module_redeemer(
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_token_name: ByteArray,
  port_minting_policy_id: PolicyId,
  port_id: ByteArray,
) -> IBCModuleRedeemer {
  let port_number = port_keys.parse_port_id_number(port_id)
  let port_token_name =
    auth.generate_token_name_from_another(
      channel_token_name,
      port_keys.port_prefix,
      port_number,
    )
  let port_token =
    AuthToken { policy_id: port_minting_policy_id, name: port_token_name }

  expect [module_input] =
    list.filter(
      inputs,
      fn(input) { auth.contain_auth_token(input.output, port_token) },
    )

  expect Some(spent_module_redeemer) =
    pairs.get_first(redeemers, Spend(module_input.output_reference))
  expect ibc_module_redeemer: IBCModuleRedeemer = spent_module_redeemer

  ibc_module_redeemer
}

pub fn validate_referred_client(
  reference_inputs: List<Input>,
  referrer_token_name: ByteArray,
  client_minting_policy_id: PolicyId,
  client_id: ByteArray,
) -> ClientDatum {
  let client_sequence = client_keys.parse_client_id_sequence(client_id)

  let client_token_name =
    auth.generate_token_name_from_another(
      referrer_token_name,
      client_keys.client_prefix,
      client_sequence,
    )
  let client_token =
    AuthToken { policy_id: client_minting_policy_id, name: client_token_name }

  expect Some(client_input) =
    list.find(
      reference_inputs,
      fn(input) { input.output |> auth.contain_auth_token(client_token) },
    )
  expect client_datum: ClientDatum = get_inline_datum(client_input.output)
  client_datum
}

pub fn validate_referred_connection(
  reference_inputs: List<Input>,
  referrer_token_name: ByteArray,
  connection_minting_policy_id: PolicyId,
  connection_id: ByteArray,
) -> ConnectionDatum {
  let connection_sequence =
    connection_keys.parse_connection_id_sequence(connection_id)

  let connection_token_name =
    auth.generate_token_name_from_another(
      referrer_token_name,
      connection_keys.connection_prefix,
      connection_sequence,
    )
  let connection_token =
    AuthToken {
      policy_id: connection_minting_policy_id,
      name: connection_token_name,
    }

  expect Some(data) =
    list.find(
      reference_inputs,
      fn(input) { input.output |> auth.contain_auth_token(connection_token) },
    )
      |> map(fn(connection_input) { get_inline_datum(connection_input.output) })
  expect connection_datum: ConnectionDatum = data
  connection_datum
}

pub fn validate_mint(
  mint: Value,
  minting_policy_id: PolicyId,
  base_token: AuthToken,
  token_name_prefix: ByteArray,
  sequence: ByteArray,
) -> AuthToken {
  let token_name =
    auth.generate_token_name(base_token, token_name_prefix, sequence)

  let token = AuthToken { policy_id: minting_policy_id, name: token_name }

  if auth.mint_auth_token(mint, token) {
    token
  } else {
    fail @"Auth Token Not Minted"
  }
}

pub fn require_exact_marker_mint(
  mint: Value,
  own_policy_id: PolicyId,
  expected_asset_name: AssetName,
  expected_quantity: Int,
) -> Bool {
  tokens(mint, own_policy_id) == (
    dict.empty
      |> dict.insert(expected_asset_name, expected_quantity)
  )
}

/// Finds the single updated state output for a spent state UTxO.
/// The output must stay at the same validator address and carry the same auth token.
pub fn find_unique_continuation_output(
  spent_output: Output,
  outputs: List<Output>,
  token: AuthToken,
) -> Output {
  // The updated state output is identified by both its validator address and auth token.
  // This allows unrelated state UTxOs to share the same script address safely.
  expect auth.contain_auth_token(spent_output, token)?

  expect [updated_output] =
    list.filter(
      outputs,
      fn(output) {
        output.address == spent_output.address && auth.contain_auth_token(
          output,
          token,
        )
      },
    )
  updated_output
}

pub fn no_output_contains_auth_token(
  outputs: List<Output>,
  token: AuthToken,
) -> Bool {
  // Close/delete transitions remove this state token; other state outputs may still share the address.
  !list.any(outputs, fn(output) { auth.contain_auth_token(output, token) })
}

pub fn validate_token_remain(
  spent_output: Output,
  outputs: List<Output>,
  tokens: List<AuthToken>,
) -> Output {
  expect [updated_output] =
    if list.is_empty(tokens) {
      // With no token list, the helper can only select by address and compare the whole non-ADA value.
      list.filter(
        outputs,
        fn(output) { output.address == spent_output.address },
      )
    } else {
      // Prefer token-scoped selection when the caller knows which state tokens must remain.
      list.filter(
        outputs,
        fn(output) {
          output.address == spent_output.address && list.all(
            tokens,
            fn(token) { auth.contain_auth_token(output, token) },
          )
        },
      )
    }

  let is_remain =
    if list.is_empty(tokens) {
      assets.match_assets(spent_output.value, updated_output.value)
    } else {
      list.all(
        tokens,
        fn(token) {
          quantity_of(spent_output.value, token.policy_id, token.name) == quantity_of(
            updated_output.value,
            token.policy_id,
            token.name,
          )
        },
      )
    }

  if is_remain {
    updated_output
  } else {
    fail @"Invalid tokens amount"
  }
}

/// Require that the HostState UTxO is co-spent and re-created in the same transaction.
///
/// Why this exists:
/// In this architecture, `HostState` is the canonical commitment over IBC core state.
/// If another IBC state UTxO (client/connection/channel/module) can be updated without also
/// consuming and re-creating the HostState UTxO, then the on-chain state and the committed
/// root can diverge, breaking proofs and making the system unsafe.
///
/// What this enforces:
/// - Exactly one input contains the HostState NFT.
/// - Exactly one output contains the HostState NFT.
/// - The HostState NFT stays at the same address (single-token-thread continuity).
/// - Both the input and output carry inline datums (so scripts can reliably read HostState).
pub fn require_host_state_thread(
  inputs: List<Input>,
  outputs: List<Output>,
  host_state_nft_policy_id: PolicyId,
) -> (Input, Output) {
  expect [host_input] =
    list.filter(
      inputs,
      fn(input) {
        assets.has_nft(
          input.output.value,
          host_state_nft_policy_id,
          host_state_token_name,
        )
      },
    )

  expect [host_output] =
    list.filter(
      outputs,
      fn(output) {
        assets.has_nft(
          output.value,
          host_state_nft_policy_id,
          host_state_token_name,
        )
      },
    )

  // The HostState NFT must remain locked at a single address.
  expect host_output.address == host_input.output.address

  // Require inline datums so other validators can safely decode HostState.
  expect InlineDatum(_) = host_input.output.datum
  expect InlineDatum(_) = host_output.datum

  (host_input, host_output)
}

fn host_state_redeemer_matches(
  redeemer: host_state_redeemer.HostStateRedeemer,
  expected: ExpectedHostStateRedeemer,
) -> Bool {
  when expected is {
    ExpectUpdateClient ->
      when redeemer is {
        host_state_redeemer.UpdateClient { .. } -> True
        _ -> False
      }
    ExpectUpdateConnection ->
      when redeemer is {
        host_state_redeemer.UpdateConnection { .. } -> True
        _ -> False
      }
    ExpectUpdateChannel ->
      when redeemer is {
        host_state_redeemer.UpdateChannel { .. } -> True
        _ -> False
      }
    ExpectHandlePacket ->
      when redeemer is {
        host_state_redeemer.HandlePacket { .. } -> True
        _ -> False
      }
  }
}

/// Require a HostState co-spend with the redeemer branch expected by this state update.
pub fn require_host_state_redeemer(
  inputs: List<Input>,
  outputs: List<Output>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  host_state_nft_policy_id: PolicyId,
  expected: ExpectedHostStateRedeemer,
) -> (Input, Output) {
  let (host_input, host_output) =
    require_host_state_thread(inputs, outputs, host_state_nft_policy_id)

  expect Some(spent_host_state_redeemer) =
    pairs.get_first(redeemers, Spend(host_input.output_reference))
  expect host_redeemer: host_state_redeemer.HostStateRedeemer =
    spent_host_state_redeemer
  expect host_state_redeemer_matches(host_redeemer, expected)?

  (host_input, host_output)
}

pub fn compare_purpose(_key1: ScriptPurpose, _key2: ScriptPurpose) -> Ordering {
  Greater
}

pub fn extract_token_unit(unit: ByteArray) -> (ByteArray, ByteArray) {
  let len = bytearray.length(unit)

  if unit == "lovelace" {
    (ada_policy_id, ada_asset_name)
  } else if 28 <= len && len <= 60 {
    let policy_id = bytearray.take(unit, 28)
    let name = bytearray.slice(unit, 28, 59)

    (policy_id, name)
  } else {
    fail @"Could not extract token unit"
  }
}

pub fn compare_script_purpose(
  _key1: ScriptPurpose,
  _key2: ScriptPurpose,
) -> Ordering {
  Greater
}

pub fn extract_channel(
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_token: AuthToken,
) -> (ChannelDatum, SpendChannelRedeemer, Output) {
  expect [channel_input] =
    list.filter(
      inputs,
      fn(input) { input.output |> auth.contain_auth_token(channel_token) },
    )

  expect channel_datum: ChannelDatum = get_inline_datum(channel_input.output)

  expect Some(channel_details) =
    pairs.get_first(redeemers, Spend(channel_input.output_reference))
      |> option.map(
          fn(spend_channel_redeemer) {
            expect spend_channel_redeemer: SpendChannelRedeemer =
              spend_channel_redeemer

            (channel_datum, spend_channel_redeemer, channel_input.output)
          },
        )
  channel_details
}
