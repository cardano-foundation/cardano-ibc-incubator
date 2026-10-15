use aiken/builtin
use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto
use aiken/primitive/bytearray
use cardano/address.{VerificationKey}
use cardano/assets.{PolicyId}
use cardano/transaction.{Output, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/core/ics_002_client_semantics/client_view.{ClientView}
use ibc/core/ics_002_client_semantics/registry
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_002_client_semantics/verify_proof_redeemer.{
  VerifyMembership, VerifyMembershipParams, VerifyProofRedeemer,
}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/verify
use ibc/core/ics_004/channel_datum.{
  ChannelDatum, ChannelDatumState, ChannelUpgradeState, PendingUpgrade,
}
use ibc/core/ics_004/channel_redeemer.{ChanUpgrade}
use ibc/core/ics_004/packet_config.{PacketConfig, config_token_name}
use ibc/core/ics_004/types/channel.{Channel} as channel_type
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/order.{Order}
use ibc/core/ics_004/types/state.{ChannelState, FlushComplete, Flushing, Open}
use ibc/core/ics_004/types/upgrade.{
  ErrorReceipt, Upgrade, UpgradeFields, UpgradeTimeout,
}
use ibc/core/ics_023_vector_commitments/merkle
use ibc/core/ics_024_host_requirements/channel_keys as channel_paths
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/utils/validator_utils

// Shared rules of the transfer-channel upgrade operations, which move a
// channel to a replacement connection and keep its ordering, version, ports
// and channel identifiers. The operations follow ibc-go v8.7.0 except:
// - TRY only answers a crossing proposal. The deployment authority always
//   chooses this end's replacement connection, never a relayer.
// - Steps that ibc-go answers with an error receipt fail instead. CANCEL and
//   TIMEOUT restore the channel.
// - OPEN requires the counterparty to be open already. ibc-go v8.7.0 cannot
//   tell that a counterparty opened when the connection IDs differ, so it
//   could time out after this end opened.
// - Flushing completes when every packet lane is certified empty, by FLUSH
//   steps that need no proof.

/// The step data of `ChannelUpgradeStep`, decoded by the operation that
/// handles it. Each record has the fields of the constructor of that name.
pub type InitStep {
  fields: UpgradeFields,
  timeout_period: Int,
}

pub type TryStep {
  counterparty_upgrade_fields: UpgradeFields,
  counterparty_upgrade_sequence: Int,
  proof_channel: Data,
  proof_upgrade: Data,
  proof_height: Height,
}

pub type AckStep {
  counterparty_upgrade: Upgrade,
  proof_channel: Data,
  proof_upgrade: Data,
  proof_height: Height,
}

pub type ConfirmStep {
  counterparty_channel_state: ChannelState,
  counterparty_upgrade: Upgrade,
  proof_channel: Data,
  proof_upgrade: Data,
  proof_height: Height,
}

pub type OpenStep {
  counterparty_upgrade_sequence: Int,
  proof_channel: Data,
  proof_height: Height,
}

pub type TimeoutStep {
  counterparty_channel: Channel,
  proof_channel: Data,
  proof_height: Height,
}

pub type CancelStep {
  error_receipt: Option<ErrorReceipt>,
  proof_error_receipt: Data,
  proof_height: Height,
}

pub type FlushStep {
  lanes: Int,
}

/// `ChannelUpgradeRedeemer` with the step left undecoded.
type Envelope {
  step: Data,
  channel_siblings: List<ByteArray>,
  upgrade_siblings: List<ByteArray>,
  error_receipt_siblings: List<ByteArray>,
}

pub type Params {
  client_registry: Data,
  connection_policy: PolicyId,
  verify_proof_policy: PolicyId,
  host_state_nft_policy: PolicyId,
  packet_config_policy: PolicyId,
}

pub type Context {
  transaction: Transaction,
  params: Params,
  datum: ChannelDatum,
  channel_id: ByteArray,
  upgrade: ChannelUpgradeState,
  host_root: ByteArray,
  deployer: ByteArray,
}

/// Upgrade timeouts must cover flushing, proof delays and relaying.
pub const min_timeout_period = 3_600_000

pub const max_timeout_period = 2_592_000_000

pub const invalid_upgrade =
  "ABCI code: 28: restored channel to pre-upgrade state"

pub const upgrade_timeout =
  "ABCI code: 34: restored channel to pre-upgrade state"

/// Validate the step this operation handles. `transition` returns the
/// successor datum and the proof policy the step used.
pub fn validate(
  params: Params,
  channel_token: AuthToken,
  policy_id: PolicyId,
  transaction: Transaction,
  transition: fn(Context, Int, Data) -> (ChannelDatum, Option<PolicyId>),
) -> Bool {
  let Transaction { inputs, outputs, mint, redeemers, .. } = transaction
  expect validator_utils.require_exact_marker_mint(mint, policy_id, "", 1)
  let (datum, spend_redeemer, spent_output) =
    validator_utils.extract_channel(inputs, redeemers, channel_token)
  expect ChanUpgrade(raw) = spend_redeemer
  expect envelope: Envelope = raw
  expect updated: ChannelDatum =
    validator_utils.get_inline_datum(
      validator_utils.find_unique_continuation_output(
        spent_output,
        outputs,
        datum.token,
      ),
    )
  expect datum.token == channel_token
  expect datum.port_id == "transfer"

  let (host_input, host_output) =
    validator_utils.require_host_state_thread(
      inputs,
      outputs,
      params.host_state_nft_policy,
    )
  let (host_root, deployer) = host_fields(host_input.output)
  let (new_host_root, _) = host_fields(host_output)

  // The transaction spends only the channel, HostState and key-locked
  // inputs, so it cannot move escrow, vouchers or other IBC state.
  expect
    list.all(
      inputs,
      fn(input) {
        when input.output.address.payment_credential is {
          VerificationKey(_) -> True
          _ ->
            input == host_input || auth.contain_auth_token(
              input.output,
              channel_token,
            )
        }
      },
    )

  let context =
    Context {
      transaction,
      params,
      datum,
      channel_id: channel_keys.format_channel_identifier(
        auth.extract_token_sequence(datum.token.name),
      ),
      upgrade: channel_datum.upgrade_state(datum.state),
      host_root,
      deployer,
    }
  let step = builtin.un_constr_data(envelope.step)
  let (expected, proof_policy) =
    transition(
      context,
      builtin.fst_pair(step),
      builtin.constr_data(0, builtin.snd_pair(step)),
    )
  let allowed_mints =
    when proof_policy is {
      Some(policy) -> [policy_id, policy]
      None -> [policy_id]
    }
  and {
    expected == updated,
    list.all(assets.policies(mint), fn(p) { list.has(allowed_mints, p) }),
    expected_root(context, updated, envelope) == new_host_root,
  }
}

/// The IBC root and deployer of a HostState output, read by position from
/// `HostStateDatum { state: HostState { version, ibc_state_root, .. }, nft_policy, deployer, .. }`.
fn host_fields(output: Output) -> (ByteArray, ByteArray) {
  expect [state,
    _,
    deployer, ..] =
    builtin.snd_pair(
      builtin.un_constr_data(validator_utils.get_inline_datum(output)),
    )
  expect [_, root, ..] = builtin.snd_pair(builtin.un_constr_data(state))
  (builtin.un_b_data(root), builtin.un_b_data(deployer))
}

pub fn successor(
  context: Context,
  channel: Channel,
  upgrade: ChannelUpgradeState,
) -> ChannelDatum {
  let upgrade: Data = upgrade
  ChannelDatum {
    ..context.datum,
    state: ChannelDatumState { ..context.datum.state, channel, upgrade },
  }
}

pub fn authorized(context: Context) -> Bool {
  list.has(context.transaction.extra_signatories, context.deployer)
}

pub fn valid_to(context: Context) -> Int {
  validator_utils.get_tx_valid_to(context.transaction.validity_range)
}

pub fn no_timeout() -> UpgradeTimeout {
  UpgradeTimeout { height: height_mod.zero_height(), timestamp: 0 }
}

pub fn single_hop(hops: List<ByteArray>) -> ByteArray {
  expect [hop] = hops
  hop
}

pub fn referred_connection(
  context: Context,
  connection_id: ByteArray,
) -> ConnectionEnd {
  let ConnectionDatum { state, .. } =
    validator_utils.validate_referred_connection(
      context.transaction.reference_inputs,
      context.datum.token.name,
      context.params.connection_policy,
      connection_id,
    )
  state
}

fn open_connection(context: Context, hops: List<ByteArray>) -> ConnectionEnd {
  let connection = referred_connection(context, single_hop(hops))
  expect connection.state == connection_state.Open
  connection
}

/// Proofs use the channel's connection until the upgrade opens.
pub fn current_connection(context: Context) -> ConnectionEnd {
  open_connection(context, context.datum.state.channel.connection_hops)
}

pub fn replacement_connection(
  context: Context,
  fields: UpgradeFields,
) -> ConnectionEnd {
  open_connection(context, fields.connection_hops)
}

/// Preparation and the first entry to FLUSHCOMPLETE require a usable
/// replacement client. Its latest checkpoint is in the authenticated datum.
/// OPEN must remain possible after the counterparty has already switched.
pub fn require_replacement_ready(
  context: Context,
  connection: ConnectionEnd,
) -> Bool {
  let client =
    validator_utils.validate_referred_client(
      context.transaction.reference_inputs,
      context.datum.token.name,
      context.params.client_registry,
      connection.client_id,
      valid_to(context) * 1_000_000,
      None,
      None,
    )
  client.status == Active
}

/// The counterparty proposes the same parameters on the counterparty of this
/// end's replacement connection.
pub fn compatible(
  own: UpgradeFields,
  counterparty: UpgradeFields,
  replacement: ConnectionEnd,
) -> Bool {
  and {
    own.ordering == counterparty.ordering,
    own.version == counterparty.version,
    counterparty.connection_hops == [replacement.counterparty.connection_id],
  }
}

pub fn proof_client(
  context: Context,
  connection: ConnectionEnd,
  proof_height: Height,
) -> (ClientView, PolicyId) {
  let registration =
    registry.for_client(context.params.client_registry, connection.client_id)
  let policy =
    validator_utils.registered_proof_policy(
      registration,
      context.params.verify_proof_policy,
    )
  let client =
    validator_utils.validate_registered_client(
      context.transaction.reference_inputs,
      context.datum.token.name,
      registration,
      connection.client_id,
      valid_to(context) * 1_000_000,
      Some(proof_height),
      validator_utils.verify_proof_envelope(
        context.transaction.redeemers,
        policy,
      ).history_witness,
    )
  expect client.status == Active
  (client, policy)
}

pub fn membership(
  client: ClientView,
  connection: ConnectionEnd,
  proof_height: Height,
  proof: Data,
  key: ByteArray,
  value: ByteArray,
) -> VerifyMembershipParams {
  let state = client.state
  expect Some(cons_state) =
    pairs.get_first(state.consensus_states, proof_height)
  expect Some(processed_time) =
    pairs.get_first(state.processed_times, proof_height)
  expect Some(processed_height) =
    pairs.get_first(state.processed_heights, proof_height)
  VerifyMembershipParams {
    cs: state.client_state,
    cons_state,
    height: proof_height,
    processed_time,
    processed_height,
    delay_time_period: connection.delay_period,
    delay_block_period: verify.get_block_delay(connection),
    proof,
    path: merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path([key]),
    ),
    value,
  }
}

pub fn single(params: VerifyMembershipParams) -> VerifyProofRedeemer {
  VerifyMembership {
    cs: params.cs,
    cons_state: params.cons_state,
    height: params.height,
    processed_time: params.processed_time,
    processed_height: params.processed_height,
    delay_time_period: params.delay_time_period,
    delay_block_period: params.delay_block_period,
    proof: params.proof,
    path: params.path,
    value: params.value,
  }
}

pub fn require_proof(
  context: Context,
  policy: PolicyId,
  expected: VerifyProofRedeemer,
) -> Bool {
  expect
    validator_utils.require_exact_marker_mint(
      context.transaction.mint,
      policy,
      "",
      1,
    )
  validator_utils.proof_matches(
    validator_utils.verify_proof_envelope(context.transaction.redeemers, policy).proof,
    expected,
  )
}

pub fn counterparty_channel_path(context: Context) -> ByteArray {
  let counterparty = context.datum.state.channel.counterparty
  channel_paths.channel_path(counterparty.port_id, counterparty.channel_id)
}

pub fn counterparty_upgrade_path(context: Context) -> ByteArray {
  let counterparty = context.datum.state.channel.counterparty
  channel_paths.channel_upgrade_path(
    counterparty.port_id,
    counterparty.channel_id,
  )
}

pub fn counterparty_error_receipt_path(context: Context) -> ByteArray {
  let counterparty = context.datum.state.channel.counterparty
  channel_paths.channel_upgrade_error_path(
    counterparty.port_id,
    counterparty.channel_id,
  )
}

/// A counterparty channel end as ibc-go commits it.
pub fn channel_value(channel: Channel) -> ByteArray {
  channel_pb.marshal_for_channel(channel_type.convert_to_channel_proto(channel)).2nd
}

/// The counterparty end of this channel with the given parameters.
pub fn counterparty_channel(
  context: Context,
  state: ChannelState,
  ordering: Order,
  version: ByteArray,
  connection_hop: ByteArray,
  upgrade_sequence: Int,
) -> Channel {
  Channel {
    state,
    ordering,
    counterparty: ChannelCounterparty {
      port_id: context.datum.port_id,
      channel_id: context.channel_id,
    },
    connection_hops: [connection_hop],
    version,
    upgrade_sequence,
  }
}

pub fn packet_config(context: Context) -> PacketConfig {
  packet_config.reference(
    context.transaction,
    AuthToken {
      policy_id: context.params.packet_config_policy,
      name: config_token_name,
    },
  )
}

// The upgraded channel's identifiers are canonical, so the lane and sequencer
// token names are derived without re-validating them. See packet_lanes.
fn framed(value: ByteArray) -> ByteArray {
  bytearray.concat(
    bytearray.from_int_big_endian(bytearray.length(value), 4),
    value,
  )
}

fn channel_identity(context: Context) -> ByteArray {
  bytearray.concat(framed(context.datum.port_id), framed(context.channel_id))
}

pub fn lane_drained(context: Context, config: PacketConfig, lane: Int) -> Bool {
  let name =
    "cardano-ibc/packet-lane-token/v1"
      |> bytearray.concat(#[0])
      |> bytearray.concat(channel_identity(context))
      |> bytearray.concat(bytearray.from_int_big_endian(lane, 4))
      |> crypto.sha2_256
  expect Some(input) =
    list.find(
      context.transaction.reference_inputs,
      fn(input) {
        assets.has_nft(input.output.value, config.state_policy, name)
      },
    )
  // PacketLaneDatum { port_id, channel_id, lane, lane_count, version, root, commitments, .. }
  expect [_,
    _,
    lane_index,
    lane_count,
    _,
    _,
    commitments, ..] =
    builtin.snd_pair(
      builtin.un_constr_data(validator_utils.get_inline_datum(input.output)),
    )
  and {
    builtin.un_i_data(lane_index) == lane,
    builtin.un_i_data(lane_count) == config.lane_count,
    builtin.un_map_data(commitments) == [],
  }
}

/// Flushing fixes the upgrade timeout and the next sequence this end sends.
/// Sends need an open channel, so the sequencer reference makes this boundary
/// exact: a send and this transition cannot both use the same state.
pub fn start_flushing(
  context: Context,
  config: PacketConfig,
  pending: PendingUpgrade,
) -> PendingUpgrade {
  // A transfer channel can upgrade only after its packet lanes were issued.
  let sequencer =
    "cardano-ibc/send-sequencer-token/v1"
      |> bytearray.concat(#[0])
      |> bytearray.concat(channel_identity(context))
      |> crypto.sha2_256
  expect Some(input) =
    list.find(
      context.transaction.reference_inputs,
      fn(input) {
        assets.has_nft(input.output.value, config.state_policy, sequencer)
      },
    )
  // SendSequencerDatum { port_id, channel_id, version, next_sequence_send }
  expect [_,
    _,
    _,
    next_sequence_send] =
    builtin.snd_pair(
      builtin.un_constr_data(validator_utils.get_inline_datum(input.output)),
    )
  let next_sequence_send = builtin.un_i_data(next_sequence_send)
  PendingUpgrade {
    ..pending,
    upgrade: Upgrade {
      ..pending.upgrade,
      timeout: UpgradeTimeout {
        height: height_mod.zero_height(),
        timestamp: ( valid_to(context) + pending.timeout_period ) * 1_000_000,
      },
      next_sequence_send,
    },
  }
}

pub fn next_error_receipt(
  upgrade: ChannelUpgradeState,
  sequence: Int,
  message: ByteArray,
) -> Option<ErrorReceipt> {
  // Receipts only move forward, as in ibc-go.
  expect
    when upgrade.error_receipt is {
      Some(previous) -> previous.sequence < sequence
      None -> True
    }
  Some(ErrorReceipt { sequence, message })
}

/// Restore the channel's pre-upgrade parameters and record why.
pub fn restore(
  context: Context,
  sequence: Int,
  message: ByteArray,
) -> ChannelDatum {
  // CLOSED is terminal even when close-confirm retained a pending proposal.
  let state = context.datum.state.channel.state
  expect state == Open || state == Flushing || state == FlushComplete
  successor(
    context,
    Channel {
      ..context.datum.state.channel,
      state: Open,
      upgrade_sequence: sequence,
    },
    ChannelUpgradeState {
      ..context.upgrade,
      pending: None,
      error_receipt: next_error_receipt(context.upgrade, sequence, message),
    },
  )
}

/// The HostState root with this step's channel end, upgrade and error-receipt
/// updates. Unchanged values take no witness.
fn expected_root(
  context: Context,
  updated: ChannelDatum,
  envelope: Envelope,
) -> ByteArray {
  let before = context.upgrade
  let after = channel_datum.upgrade_state(updated.state)
  let port_id = context.datum.port_id
  let channel_id = context.channel_id
  context.host_root
    |> changed(
        channel_paths.channel_path(port_id, channel_id),
        cbor.serialise(context.datum.state.channel),
        cbor.serialise(updated.state.channel),
        envelope.channel_siblings,
      )
    |> changed(
        channel_paths.channel_upgrade_path(port_id, channel_id),
        upgrade_value(before),
        upgrade_value(after),
        envelope.upgrade_siblings,
      )
    |> changed(
        channel_paths.channel_upgrade_error_path(port_id, channel_id),
        error_receipt_value(before),
        error_receipt_value(after),
        envelope.error_receipt_siblings,
      )
}

fn changed(
  root: ByteArray,
  key: ByteArray,
  old_value: ByteArray,
  new_value: ByteArray,
  siblings: List<ByteArray>,
) -> ByteArray {
  if old_value == new_value {
    expect siblings == []
    root
  } else {
    ibc_state_commitment.apply_update(root, key, old_value, new_value, siblings)
  }
}

// An absent record commits the empty value.
fn upgrade_value(upgrade: ChannelUpgradeState) -> ByteArray {
  when upgrade.pending is {
    Some(pending) -> cbor.serialise(pending.upgrade)
    None -> ""
  }
}

fn error_receipt_value(upgrade: ChannelUpgradeState) -> ByteArray {
  when upgrade.error_receipt is {
    Some(receipt) -> cbor.serialise(receipt)
    None -> ""
  }
}
