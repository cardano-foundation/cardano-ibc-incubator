use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{VerificationKeyHash}
use aiken/interval.{Finite}
use aiken/option
use aiken/primitive/bytearray
use cardano/address.{Script, from_verification_key}
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
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, ModuleRegistration, host_state_token_name, is_active,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer as host_state_redeemer

pub type ExpectedHostStateRedeemer {
  ExpectUpdateClient
  ExpectUpdateConnection
  ExpectUpdateChannel
  ExpectHandlePacket
  ExpectPruneTerminalClient
  ExpectIncrementChannelCount
  ExpectDecrementChannelCount
  ExpectBeginConnectionRetirement
  ExpectBeginChannelAbandonment
  ExpectReclaimChannel { reclaim_to: VerificationKeyHash }
  ExpectReclaimConnection { reclaim_to: VerificationKeyHash }
  ExpectReclaimClient { reclaim_to: VerificationKeyHash }
}

type PosixTime =
  Int

/// Lifecycle transitions that start a safety delay use the transaction's
/// upper validity bound as their authenticated timestamp. Keeping the whole
/// interval short prevents an old lower bound from backdating that timestamp.
/// Ten minutes plus one slot boundary matches the longest transaction window
/// used by the builders while remaining negligible beside the seven-day delays.
pub const max_lifecycle_validity_width: Int = 601_000

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

/// Require the reclaimed UTxO's entire ADA balance to be paid to the cleanup
/// submitter. Fees therefore come from ordinary wallet inputs rather than from
/// protocol state, and the otherwise stranded minimum ADA becomes an explicit
/// permissionless cleanup bounty.
pub fn pays_reclamation_bounty(
  spent_output: Output,
  outputs: List<Output>,
  reclaim_to: VerificationKeyHash,
) -> Bool {
  let reclaim_address = from_verification_key(reclaim_to)
  let paid_lovelace =
    list.foldl(
      outputs,
      0,
      fn(output, total) {
        if output.address == reclaim_address {
          total + assets.lovelace_of(output.value)
        } else {
          total
        }
      },
    )

  paid_lovelace >= assets.lovelace_of(spent_output.value)
}

/// Require the terminal HostState's lovelace to be accounted for by one
/// ADA-only payout. In particular, a capability-token payout from a module root
/// being reclaimed in the same transaction cannot also satisfy this check.
pub fn pays_exact_ada_only_reclamation_bounty(
  spent_output: Output,
  outputs: List<Output>,
  reclaim_to: VerificationKeyHash,
) -> Bool {
  let reclaim_address = from_verification_key(reclaim_to)
  let expected_value =
    assets.from_lovelace(assets.lovelace_of(spent_output.value))

  expect [_] =
    list.filter(
      outputs,
      fn(output) {
        output.address == reclaim_address && output.value == expected_value
      },
    )
  True
}

/// Reclaim a settled registered module root during HostState sealing without
/// burning its capability tokens. The exact input value moves to one enterprise
/// output, and no output at the module script may retain either capability.
pub fn validate_terminal_module_root_payout(
  spent_output: Output,
  outputs: List<Output>,
  port_token: AuthToken,
  module_token: AuthToken,
  deployer: VerificationKeyHash,
) -> Bool {
  expect
    auth.contains_only_auth_tokens(spent_output, [port_token, module_token])
  trace @"terminal module reclaim: authenticated capability root"
  let reclaim_address = from_verification_key(deployer)
  expect [payout] =
    list.filter(
      outputs,
      fn(output) {
        output.address == reclaim_address && output.value == spent_output.value
      },
    )
  trace @"terminal module reclaim: found exact deployer payout"

  and {
    auth.contains_only_auth_tokens(payout, [port_token, module_token]),
    !list.any(
      outputs,
      fn(output) { output.address == spent_output.address && or {
          auth.contain_auth_token(output, port_token),
          auth.contain_auth_token(output, module_token),
        } },
    ),
  }
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

/// Return a finite, ordered lifecycle validity interval whose width is capped.
/// The lower bound must be inclusive because Cardano's `validFrom` is the
/// earliest instant at which the transition may take effect. The upper bound
/// is deliberately accepted with either inclusivity because Lucid represents
/// `validTo` as an exclusive bound.
pub fn get_bounded_lifecycle_validity(
  validity_range: ValidityRange,
) -> (PosixTime, PosixTime) {
  let valid_from = get_tx_valid_from(validity_range)
  let valid_to = get_tx_valid_to(validity_range)
  expect valid_to >= valid_from
  expect valid_to - valid_from <= max_lifecycle_validity_width
  (valid_from, valid_to)
}

/// Resolve a module witness through the exact port's immutable HostState registration and require its capability UTxO to be spent.
pub fn extract_module_redeemer(
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  port_minting_policy_id: PolicyId,
  port_id: ByteArray,
  host_state_nft_policy_id: PolicyId,
) -> IBCModuleRedeemer {
  let port_token =
    AuthToken {
      policy_id: port_minting_policy_id,
      name: port_keys.port_token_name(port_id),
    }

  let registration =
    registered_module_for_port(
      inputs,
      host_state_nft_policy_id,
      port_id,
      port_token,
    )

  expect Some(module_input) =
    find_registered_module_state_input(inputs, registration)

  expect Some(spent_module_redeemer) =
    pairs.get_first(redeemers, Spend(module_input.output_reference))
  expect ibc_module_redeemer: IBCModuleRedeemer = spent_module_redeemer

  ibc_module_redeemer
}

/// Find the registered application witness for a packet callback.
///
/// Root-state callbacks spend and preserve the exact registered capability
/// pair. Escrow-shard callbacks reference that root and spend exactly one UTxO
/// at the immutable script credential recorded by HostState.
pub fn extract_packet_module_redeemer(
  inputs: List<Input>,
  reference_inputs: List<Input>,
  outputs: List<Output>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  port_minting_policy_id: PolicyId,
  port_id: ByteArray,
  host_state_nft_policy_id: PolicyId,
) -> IBCModuleRedeemer {
  let port_token =
    AuthToken {
      policy_id: port_minting_policy_id,
      name: port_keys.port_token_name(port_id),
    }

  let registration =
    registered_module_for_port(
      inputs,
      host_state_nft_policy_id,
      port_id,
      port_token,
    )

  when find_registered_module_state_input(inputs, registration) is {
    Some(module_input) -> {
      expect [module_output] =
        list.filter(
          outputs,
          fn(output) {
            auth.contain_auth_token(output, registration.port_token)
          },
        )
      expect module_output.address == module_input.output.address
      expect registered_module_state_is_exact(module_output, registration)
      input_redeemer(redeemers, module_input)
    }
    None -> {
      expect Some(_module_reference_input) =
        find_registered_module_state_input(reference_inputs, registration)
      expect [module_spend_input] =
        list.filter(
          inputs,
          fn(input) {
            when input.output.address.payment_credential is {
              Script(script_hash) ->
                script_hash == registration.module_script_hash
              _ -> False
            }
          },
        )
      input_redeemer(redeemers, module_spend_input)
    }
  }
}

fn find_registered_module_state_input(
  inputs: List<Input>,
  registration: ModuleRegistration,
) -> Option<Input> {
  when
    list.filter(
      inputs,
      fn(input) {
        auth.contain_auth_token(input.output, registration.port_token)
      },
    )
  is {
    [] -> None
    [module_input] -> {
      expect registered_module_state_is_exact(module_input.output, registration)
      Some(module_input)
    }
    _ -> fail @"Multiple module state witnesses"
  }
}

fn registered_module_for_port(
  inputs: List<Input>,
  host_state_nft_policy_id: PolicyId,
  port_id: ByteArray,
  expected_port_token: AuthToken,
) -> ModuleRegistration {
  expect [host_state_input] =
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
  expect host_state_datum: HostStateDatum =
    get_inline_datum(host_state_input.output)
  expect Some(registration) =
    pairs.get_first(host_state_datum.state.bound_port, port_id)
  expect registration.port_token == expected_port_token
  registration
}

fn registered_module_state_is_exact(
  output: Output,
  registration: ModuleRegistration,
) -> Bool {
  expect Script(script_hash) = output.address.payment_credential
  and {
    script_hash == registration.module_script_hash,
    // Module datum contents belong to the registered application validator.
    auth.contains_only_auth_tokens(
      output,
      [registration.port_token, registration.module_token],
    ),
  }
}

fn input_redeemer(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  input: Input,
) -> IBCModuleRedeemer {
  expect Some(spent_module_redeemer) =
    pairs.get_first(redeemers, Spend(input.output_reference))
  expect ibc_module_redeemer: IBCModuleRedeemer = spent_module_redeemer

  ibc_module_redeemer
}

fn expected_client_token(
  referrer_token_name: ByteArray,
  client_minting_policy_id: PolicyId,
  client_id: ByteArray,
) -> AuthToken {
  let client_sequence = client_keys.parse_client_id_sequence(client_id)

  let client_token_name =
    auth.generate_token_name_from_another(
      referrer_token_name,
      client_keys.client_prefix,
      client_sequence,
    )
  AuthToken { policy_id: client_minting_policy_id, name: client_token_name }
}

fn expected_connection_token(
  referrer_token_name: ByteArray,
  connection_minting_policy_id: PolicyId,
  connection_id: ByteArray,
) -> AuthToken {
  let connection_sequence =
    connection_keys.parse_connection_id_sequence(connection_id)

  let connection_token_name =
    auth.generate_token_name_from_another(
      referrer_token_name,
      connection_keys.connection_prefix,
      connection_sequence,
    )
  AuthToken {
    policy_id: connection_minting_policy_id,
    name: connection_token_name,
  }
}

fn find_authenticated_input(
  inputs: List<Input>,
  token: AuthToken,
) -> Option<Input> {
  list.find(
    inputs,
    fn(input) { input.output |> auth.contain_auth_token(token) },
  )
}

pub fn validate_referred_client(
  reference_inputs: List<Input>,
  referrer_token_name: ByteArray,
  client_minting_policy_id: PolicyId,
  client_id: ByteArray,
) -> ClientDatum {
  let client_token =
    expected_client_token(
      referrer_token_name,
      client_minting_policy_id,
      client_id,
    )

  expect Some(client_input) =
    find_authenticated_input(reference_inputs, client_token)
  expect client_datum: ClientDatum = get_inline_datum(client_input.output)
  client_datum
}

pub fn validate_referred_connection(
  reference_inputs: List<Input>,
  referrer_token_name: ByteArray,
  connection_minting_policy_id: PolicyId,
  connection_id: ByteArray,
) -> ConnectionDatum {
  let connection_token =
    expected_connection_token(
      referrer_token_name,
      connection_minting_policy_id,
      connection_id,
    )

  expect Some(connection_input) =
    find_authenticated_input(reference_inputs, connection_token)
  expect connection_datum: ConnectionDatum =
    get_inline_datum(connection_input.output)
  connection_datum
}

/// Locate a channel's authenticated connection and client references together.
///
/// Before the connection datum reveals the client id, the scan records whether
/// an earlier input could carry the client policy. Once the id is known, the
/// exact derived client auth token is still required. The normal
/// connection-before-client layout is traversed once; if references are
/// reordered, lookup falls back to the complete list to preserve behavior.
pub fn validate_referred_connection_and_client(
  reference_inputs: List<Input>,
  referrer_token_name: ByteArray,
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  connection_id: ByteArray,
) -> (ConnectionDatum, ClientDatum) {
  let connection_token =
    expected_connection_token(
      referrer_token_name,
      connection_minting_policy_id,
      connection_id,
    )
  let (connection_input, remaining_inputs, client_may_precede_connection) =
    find_connection_with_remaining_inputs(
      reference_inputs,
      connection_token,
      client_minting_policy_id,
      False,
    )
  expect connection_datum: ConnectionDatum =
    get_inline_datum(connection_input.output)
  let client_token =
    expected_client_token(
      referrer_token_name,
      client_minting_policy_id,
      connection_datum.state.client_id,
    )

  let client_search_inputs =
    if client_may_precede_connection || !(connection_input.output.value
      |> tokens(client_minting_policy_id)
      |> dict.is_empty) {
      reference_inputs
    } else {
      remaining_inputs
    }
  expect Some(client_input) =
    find_authenticated_input(client_search_inputs, client_token)
  expect client_datum: ClientDatum = get_inline_datum(client_input.output)

  (connection_datum, client_datum)
}

fn find_connection_with_remaining_inputs(
  inputs: List<Input>,
  connection_token: AuthToken,
  client_minting_policy_id: PolicyId,
  client_may_precede_connection: Bool,
) -> (Input, List<Input>, Bool) {
  when inputs is {
    [] -> fail @"Missing authenticated connection reference input"
    [input, ..remaining_inputs] ->
      if auth.contain_auth_token(input.output, connection_token) {
        (input, remaining_inputs, client_may_precede_connection)
      } else {
        find_connection_with_remaining_inputs(
          remaining_inputs,
          connection_token,
          client_minting_policy_id,
          client_may_precede_connection || !(input.output.value
            |> tokens(client_minting_policy_id)
            |> dict.is_empty),
        )
      }
  }
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
    ExpectPruneTerminalClient ->
      when redeemer is {
        host_state_redeemer.PruneTerminalClient { .. } -> True
        _ -> False
      }
    ExpectIncrementChannelCount ->
      when redeemer is {
        host_state_redeemer.CreateChannel { .. } -> True
        _ -> False
      }
    ExpectDecrementChannelCount ->
      when redeemer is {
        host_state_redeemer.ReclaimChannel { .. } -> True
        _ -> False
      }
    ExpectBeginConnectionRetirement ->
      when redeemer is {
        host_state_redeemer.BeginConnectionRetirement -> True
        _ -> False
      }
    ExpectBeginChannelAbandonment ->
      when redeemer is {
        host_state_redeemer.BeginChannelAbandonment -> True
        _ -> False
      }
    ExpectReclaimChannel { reclaim_to } ->
      when redeemer is {
        host_state_redeemer.ReclaimChannel { reclaim_to: actual_reclaim_to, .. } ->
          actual_reclaim_to == reclaim_to
        _ -> False
      }
    ExpectReclaimConnection { reclaim_to } ->
      when redeemer is {
        host_state_redeemer.ReclaimConnection {
          reclaim_to: actual_reclaim_to,
          ..
        } -> actual_reclaim_to == reclaim_to
        _ -> False
      }
    ExpectReclaimClient { reclaim_to } ->
      when redeemer is {
        host_state_redeemer.ReclaimClient { reclaim_to: actual_reclaim_to, .. } ->
          actual_reclaim_to == reclaim_to
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

/// Require the authenticated HostState thread to reclaim the named registered
/// module. Terminal module-root cleanup is intentionally bounded to one module
/// per HostState transition before `SealShutdown`.
pub fn require_host_state_module_reclaim(
  inputs: List<Input>,
  outputs: List<Output>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  host_state_nft_policy_id: PolicyId,
) -> (Input, Output, ByteArray) {
  let (host_input, host_output) =
    require_host_state_thread(inputs, outputs, host_state_nft_policy_id)

  expect Some(spent_host_state_redeemer) =
    pairs.get_first(redeemers, Spend(host_input.output_reference))
  expect host_redeemer: host_state_redeemer.HostStateRedeemer =
    spent_host_state_redeemer
  expect host_state_redeemer.ReclaimModule { port_id } = host_redeemer

  (host_input, host_output, port_id)
}

pub fn get_host_state_datum(input: Input) -> HostStateDatum {
  expect host_state_datum: HostStateDatum = get_inline_datum(input.output)
  host_state_datum
}

pub fn require_active_host_state(input: Input) {
  let host_state_datum = get_host_state_datum(input)
  expect host_state_datum.shutdown |> is_active
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
