use aiken/builtin
use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/bytearray
use cardano/address.{from_script}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, Spend,
  Transaction,
}
use host_state_stt
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_upgrade_pb
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/core/ics_002_client_semantics/types/keys as client_keys
use ibc/core/ics_002_client_semantics/verify_proof_redeemer.{
  BatchVerifyMembership, VerifyMembershipParams, VerifyProofEnvelope,
  VerifyProofRedeemer,
}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as connection_counterparty
use ibc/core/ics_003_connection_semantics/types/keys as connection_keys
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_004/channel_datum.{
  ChannelDatum, ChannelDatumState, ChannelUpgradeState, PendingUpgrade,
} as channel_datum
use ibc/core/ics_004/channel_redeemer.{
  AckUpgrade, CancelUpgrade, ChanUpgrade, ChannelUpgradeRedeemer,
  ChannelUpgradeStep, ConfirmUpgrade, FlushUpgrade, InitUpgrade, OpenUpgrade,
  RecvPacket, SpendChannelRedeemer, TimeoutUpgrade, TryUpgrade,
}
use ibc/core/ics_004/channel_upgrade as rules
use ibc/core/ics_004/packet_config.{PacketConfig, config_token_name}
use ibc/core/ics_004/packet_lane_datum.{PacketLaneDatum}
use ibc/core/ics_004/packet_lanes
use ibc/core/ics_004/send_sequencer.{SendSequencerDatum}
use ibc/core/ics_004/types/channel.{Channel} as channel_type
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Ordered, Unordered}
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_004/types/state.{
  ChannelState, Closed, FlushComplete, Flushing, Open,
}
use ibc/core/ics_004/types/upgrade.{
  ErrorReceipt, Upgrade, UpgradeFields, UpgradeTimeout,
}
use ibc/core/ics_023_vector_commitments/merkle
use ibc/core/ics_024_host_requirements/channel_keys
use ibc/core/ics_025_handler_interface/host_state.{HostState, HostStateDatum}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  HandlePacket, HostStateRedeemer, UpgradeChannel,
}
use ibc/testing/sparse_tree
use ibc/utils/validator_utils
use spending_channel
use spending_channel/chan_upgrade
use spending_channel/chan_upgrade_finish
use spending_channel/chan_upgrade_handshake
use spending_channel/spending_channel_fixture.{MockData, setup}

// Composed transactions for each upgrade step. They run the upgrade
// operation, the channel validator and the HostState validator together.

const packet_config_policy = "mock packet config policy"

const lane_policy = "mock packet lane policy"

const lane_count = 2

const deployer = "mock deployer key hash"

/// Injective's connection that pairs with the replacement Cardano connection.
const counterparty_replacement = "connection-1"

const replacement_id = "connection-135"

const proof_height = Height { revision_number: 1, revision_height: 13 }

const period = 86_400_000

fn fields() -> UpgradeFields {
  UpgradeFields {
    ordering: Unordered,
    connection_hops: [replacement_id],
    version: "ics20-1",
  }
}

fn counterparty_fields() -> UpgradeFields {
  UpgradeFields { ..fields(), connection_hops: [counterparty_replacement] }
}

fn channel(state: ChannelState, sequence: Int) -> Channel {
  Channel {
    state,
    ordering: Unordered,
    counterparty: ChannelCounterparty {
      port_id: "transfer",
      channel_id: "channel-7",
    },
    connection_hops: [setup().connection_id],
    version: "ics20-1",
    upgrade_sequence: sequence,
  }
}

fn upgrade_state(
  pending: Option<PendingUpgrade>,
  error_receipt: Option<ErrorReceipt>,
) -> ChannelUpgradeState {
  ChannelUpgradeState { pending, error_receipt, recv_start_sequence: 0 }
}

fn datum(channel: Channel, upgrade: ChannelUpgradeState) -> ChannelDatum {
  let upgrade: Data = upgrade
  ChannelDatum {
    state: ChannelDatumState {
      channel,
      next_sequence_send: 1,
      next_sequence_recv: 1,
      next_sequence_ack: 1,
      packet_commitment: [],
      packet_receipt: [],
      packet_acknowledgement: [],
      minimum_receive_proof_height: height_mod.zero_height(),
      maximum_receive_proof_height: height_mod.zero_height(),
      upgrade,
    },
    port_id: "transfer",
    token: setup().channel_token,
  }
}

fn initial_pending() -> PendingUpgrade {
  PendingUpgrade {
    upgrade: Upgrade {
      fields: fields(),
      timeout: rules.no_timeout(),
      next_sequence_send: 0,
    },
    timeout_period: period,
    counterparty_upgrade: None,
    flushed_lanes: 0,
  }
}

fn valid_to() -> Int {
  let mock = setup()
  validator_utils.get_tx_valid_to(mock.validity_range)
}

/// The pending upgrade after this end started flushing in a test transaction.
fn flushing_pending() -> PendingUpgrade {
  PendingUpgrade {
    ..initial_pending(),
    upgrade: Upgrade {
      ..initial_pending().upgrade,
      timeout: UpgradeTimeout {
        height: height_mod.zero_height(),
        timestamp: ( valid_to() + period ) * 1_000_000,
      },
      next_sequence_send: 5,
    },
  }
}

fn counterparty_upgrade() -> Upgrade {
  Upgrade {
    fields: counterparty_fields(),
    timeout: UpgradeTimeout {
      height: height_mod.zero_height(),
      timestamp: 2_000_000_000_000_000_000,
    },
    next_sequence_send: 9,
  }
}

// Reference inputs ==========================================================

fn reference(index: Int, value: assets.Value, data: Data) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"0000000000000000000000000000000000000000000000000000000000000077",
      output_index: index,
    },
    output: Output {
      address: from_script("mock reference script"),
      value,
      datum: InlineDatum(data),
      reference_script: None,
    },
  }
}

fn replacement_client(frozen: Bool, expired: Bool) -> Input {
  let mock = setup()
  expect client: ClientDatum =
    validator_utils.get_inline_datum(mock.client_input.output)
  let token =
    AuthToken {
      policy_id: mock.client_minting_policy_id,
      name: auth.generate_token_name(
        mock.base_token,
        client_keys.client_prefix,
        "1",
      ),
    }
  let client =
    ClientDatum {
      ..client,
      token,
      state: ClientDatumState {
        ..client.state,
        client_state: ClientState {
          ..client.state.client_state,
          frozen_height: if frozen {
            Height { revision_number: 0, revision_height: 1 }
          } else {
            height_mod.zero_height()
          },
          trusting_period: if expired {
            0
          } else {
            client.state.client_state.trusting_period
          },
        },
      },
    }
  Input {
    output_reference: OutputReference {
      ..mock.client_input.output_reference,
      output_index: 9,
    },
    output: Output {
      ..mock.client_input.output,
      value: assets.from_asset(token.policy_id, token.name, 1),
      datum: InlineDatum(client),
    },
  }
}

fn replacement_health(step: Step, frozen: Bool, expired: Bool) -> Step {
  Step {
    ..step,
    references: list.map(
      step.references,
      fn(input) {
        if input.output_reference.output_index == 9 {
          replacement_client(frozen, expired)
        } else {
          input
        }
      },
    ),
  }
}

fn replacement_connection(state: connection_state.State) -> Input {
  let mock = setup()
  expect current: ConnectionDatum =
    validator_utils.get_inline_datum(mock.connection_input.output)
  let token =
    AuthToken {
      policy_id: mock.connection_minting_policy_id,
      name: auth.generate_token_name(
        mock.base_token,
        connection_keys.connection_prefix,
        connection_keys.parse_connection_id_sequence(replacement_id),
      ),
    }
  let connection =
    ConnectionDatum {
      state: ConnectionEnd {
        ..current.state,
        client_id: "07-tendermint-1",
        state,
        counterparty: Counterparty {
          ..current.state.counterparty,
          connection_id: counterparty_replacement,
        },
      },
      token,
    }
  reference(1, assets.from_asset(token.policy_id, token.name, 1), connection)
}

fn config() -> Input {
  config_for(lane_count)
}

fn config_for(lane_count: Int) -> Input {
  reference(
    2,
    assets.from_asset(packet_config_policy, config_token_name, 1),
    PacketConfig {
      state_policy: lane_policy,
      batch_policy: "mock batch policy",
      guard_hash: "mock guard",
      lane_count,
      trace_registry_hash: "mock trace registry",
      host_policy: setup().host_state_nft_policy_id,
    },
  )
}

fn sequencer() -> Input {
  let mock = setup()
  reference(
    3,
    assets.from_asset(
      lane_policy,
      packet_lanes.sequencer_token_name("transfer", mock.channel_id),
      1,
    ),
    SendSequencerDatum {
      port_id: "transfer",
      channel_id: mock.channel_id,
      version: 4,
      next_sequence_send: 5,
    },
  )
}

fn lane(lane: Int, commitments: Pairs<Int, ByteArray>) -> Input {
  lane_of(lane_count, lane, commitments)
}

fn lane_of(
  lane_count: Int,
  lane: Int,
  commitments: Pairs<Int, ByteArray>,
) -> Input {
  let mock = setup()
  reference(
    10 + lane,
    assets.from_asset(
      lane_policy,
      packet_lanes.lane_token_name(
        "transfer",
        mock.channel_id,
        lane,
        lane_count,
      ),
      1,
    ),
    PacketLaneDatum {
      port_id: "transfer",
      channel_id: mock.channel_id,
      lane,
      lane_count,
      version: 1,
      root: #"00",
      commitments,
      receipts: [],
      acknowledgements: [],
      minimum_receive_proof_height: height_mod.zero_height(),
      maximum_receive_proof_height: height_mod.zero_height(),
      balances: [],
    },
  )
}

fn handshake_references() -> List<Input> {
  let mock = setup()
  [
    mock.connection_input,
    mock.client_input,
    replacement_connection(connection_state.Open),
    replacement_client(False, False),
    config(),
    sequencer(),
  ]
}

// Proofs ====================================================================

fn membership(proof: Int, key: ByteArray, value: ByteArray) {
  let mock = setup()
  expect client: ClientDatum =
    validator_utils.get_inline_datum(mock.client_input.output)
  expect Some(consensus) =
    pairs.get_first(client.state.consensus_states, proof_height)
  let consensus: Data = consensus
  VerifyMembershipParams {
    cs: client.state.client_state,
    cons_state: consensus,
    height: proof_height,
    processed_time: 0,
    processed_height: 0,
    delay_time_period: 0,
    delay_block_period: 0,
    proof: builtin.i_data(proof),
    path: merkle.apply_prefix(merkle_prefix(), merkle.new_merkle_path([key])),
    value,
  }
}

fn merkle_prefix() {
  let mock = setup()
  expect connection: ConnectionDatum =
    validator_utils.get_inline_datum(mock.connection_input.output)
  connection.state.counterparty.prefix
}

fn single(params: VerifyMembershipParams) -> VerifyProofRedeemer {
  rules.single(params)
}

fn counterparty_channel(
  state: ChannelState,
  hop: ByteArray,
  sequence: Int,
) -> ByteArray {
  let mock = setup()
  channel_pb.marshal_for_channel(
    channel_type.convert_to_channel_proto(
      Channel {
        state,
        ordering: Unordered,
        counterparty: ChannelCounterparty {
          port_id: "transfer",
          channel_id: mock.channel_id,
        },
        connection_hops: [hop],
        version: "ics20-1",
        upgrade_sequence: sequence,
      },
    ),
  ).2nd
}

/// Injective's connection that pairs with the current Cardano connection.
fn counterparty_current() -> ByteArray {
  let mock = setup()
  expect connection: ConnectionDatum =
    validator_utils.get_inline_datum(mock.connection_input.output)
  connection.state.counterparty.connection_id
}

fn channel_and_upgrade(
  state: ChannelState,
  sequence: Int,
  upgrade: Upgrade,
) -> VerifyProofRedeemer {
  BatchVerifyMembership(
    [
      membership(
        1,
        channel_keys.channel_path("transfer", "channel-7"),
        counterparty_channel(state, counterparty_current(), sequence),
      ),
      membership(
        2,
        channel_keys.channel_upgrade_path("transfer", "channel-7"),
        channel_upgrade_pb.marshal_upgrade(upgrade),
      ),
    ],
  )
}

// Transactions ==============================================================

type Step {
  before: ChannelDatum,
  after: ChannelDatum,
  step: ChannelUpgradeStep,
  references: List<Input>,
  signatories: List<ByteArray>,
  proof: Option<VerifyProofRedeemer>,
}

fn entries(state: ChannelDatumState) -> Pairs<ByteArray, ByteArray> {
  let mock = setup()
  let upgrade = channel_datum.upgrade_state(state)
  let channel_entry =
    Pair(
      channel_keys.channel_path("transfer", mock.channel_id),
      cbor.serialise(state.channel),
    )
  let upgrade_entry =
    when upgrade.pending is {
      Some(pending) ->
        [
          Pair(
            channel_keys.channel_upgrade_path("transfer", mock.channel_id),
            cbor.serialise(pending.upgrade),
          ),
        ]
      None -> []
    }
  let receipt_entry =
    when upgrade.error_receipt is {
      Some(receipt) ->
        [
          Pair(
            channel_keys.channel_upgrade_error_path("transfer", mock.channel_id),
            cbor.serialise(receipt),
          ),
        ]
      None -> []
    }
  [channel_entry, ..list.concat(upgrade_entry, receipt_entry)]
}

fn set_entry(
  entries: Pairs<ByteArray, ByteArray>,
  key: ByteArray,
  value: Option<ByteArray>,
) -> Pairs<ByteArray, ByteArray> {
  let others = pairs.delete_all(entries, key)
  when value is {
    Some(value) -> [Pair(key, value), ..others]
    None -> others
  }
}

/// Witnesses for updating each changed key in order, as the Gateway builds them.
fn witnesses(
  before: ChannelDatumState,
  after: ChannelDatumState,
) -> (List<ByteArray>, List<ByteArray>, List<ByteArray>) {
  let mock = setup()
  let ordered =
    [
      channel_keys.channel_path("transfer", mock.channel_id),
      channel_keys.channel_upgrade_path("transfer", mock.channel_id),
      channel_keys.channel_upgrade_error_path("transfer", mock.channel_id),
    ]
  let old = entries(before)
  let new = entries(after)
  let (_, result) =
    list.foldl(
      ordered,
      (old, []),
      fn(key, state) {
        let (current, acc) = state
        let old_value = pairs.get_first(current, key)
        let new_value = pairs.get_first(new, key)
        if old_value == new_value {
          (current, list.concat(acc, [[]]))
        } else {
          (
            set_entry(current, key, new_value),
            list.concat(acc, [sparse_tree.siblings(current, key)]),
          )
        }
      },
    )
  expect [channel_siblings, upgrade_siblings, error_receipt_siblings] = result
  (channel_siblings, upgrade_siblings, error_receipt_siblings)
}

fn redeemer(step: Step) -> ChannelUpgradeRedeemer {
  let (channel_siblings, upgrade_siblings, error_receipt_siblings) =
    witnesses(step.before.state, step.after.state)
  ChannelUpgradeRedeemer {
    step: step.step,
    channel_siblings,
    upgrade_siblings,
    error_receipt_siblings,
  }
}

fn operation_policy(step: ChannelUpgradeStep) -> ByteArray {
  let mock = setup()
  when step is {
    TryUpgrade { .. } | AckUpgrade { .. } | ConfirmUpgrade { .. } ->
      mock.chan_upgrade_handshake_policy_id
    OpenUpgrade { .. } | TimeoutUpgrade { .. } | CancelUpgrade { .. } ->
      mock.chan_upgrade_finish_policy_id
    _ -> mock.chan_upgrade_policy_id
  }
}

fn host(root: ByteArray, version: Int) -> Output {
  let mock = setup()
  expect original: HostStateDatum =
    validator_utils.get_inline_datum(mock.host_state_input.output)
  Output {
    ..mock.host_state_input.output,
    datum: InlineDatum(
      HostStateDatum {
        ..original,
        state: HostState { ..original.state, ibc_state_root: root, version },
      },
    ),
  }
}

fn transaction(
  step: Step,
  upgrade_redeemer: ChannelUpgradeRedeemer,
) -> Transaction {
  let mock = setup()
  let channel_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 4,
      },
      output: Output {
        address: from_script("mock spend channel script hash"),
        value: assets.from_asset(
          mock.channel_token.policy_id,
          mock.channel_token.name,
          1,
        ),
        datum: InlineDatum(step.before),
        reference_script: None,
      },
    }
  let host_input =
    Input {
      ..mock.host_state_input,
      output: host(sparse_tree.root(entries(step.before.state)), 1),
    }
  let policy = operation_policy(step.step)
  let channel_data: Redeemer = ChanUpgrade(upgrade_redeemer)
  let host_data: Redeemer = UpgradeChannel
  let token_data: Redeemer = mock.channel_token
  let (proof_redeemers, proof_mint) =
    when step.proof is {
      Some(proof) -> {
        let envelope: Redeemer =
          VerifyProofEnvelope { proof, history_witness: None }
        (
          [Pair(Mint(mock.verify_proof_policy_id), envelope)],
          assets.from_asset(mock.verify_proof_policy_id, "", 1),
        )
      }
      None -> ([], assets.zero)
    }
  Transaction {
    ..transaction.placeholder,
    inputs: [channel_input, host_input],
    reference_inputs: step.references,
    outputs: [
      Output { ..channel_input.output, datum: InlineDatum(step.after) },
      host(sparse_tree.root(entries(step.after.state)), 2),
    ],
    redeemers: [
      Pair(Spend(channel_input.output_reference), channel_data),
      Pair(Spend(host_input.output_reference), host_data),
      Pair(Mint(policy), token_data),
      ..proof_redeemers
    ],
    validity_range: mock.validity_range,
    extra_signatories: step.signatories,
    mint: assets.merge(assets.from_asset(policy, "", 1), proof_mint),
  }
}

fn run_operation(step: Step, tx: Transaction) -> Bool {
  let mock = setup()
  let policy = operation_policy(step.step)
  when step.step is {
    TryUpgrade { .. } | AckUpgrade { .. } | ConfirmUpgrade { .. } ->
      chan_upgrade_handshake.chan_upgrade_handshake.mint(
        mock.client_minting_policy_id,
        mock.connection_minting_policy_id,
        mock.verify_proof_policy_id,
        mock.host_state_nft_policy_id,
        packet_config_policy,
        mock.channel_token,
        policy,
        tx,
      )
    OpenUpgrade { .. } | TimeoutUpgrade { .. } | CancelUpgrade { .. } ->
      chan_upgrade_finish.chan_upgrade_finish.mint(
        mock.client_minting_policy_id,
        mock.connection_minting_policy_id,
        mock.verify_proof_policy_id,
        mock.host_state_nft_policy_id,
        packet_config_policy,
        mock.channel_token,
        policy,
        tx,
      )
    _ ->
      chan_upgrade.chan_upgrade.mint(
        mock.client_minting_policy_id,
        mock.connection_minting_policy_id,
        mock.verify_proof_policy_id,
        mock.host_state_nft_policy_id,
        packet_config_policy,
        mock.channel_token,
        policy,
        tx,
      )
  }
}

fn run_channel(step: Step, tx: Transaction, redeemer: Data) -> Bool {
  let mock = setup()
  expect [channel_input, ..] = tx.inputs
  expect redeemer: SpendChannelRedeemer = redeemer
  spending_channel.spend_channel.spend(
    packet_config_policy,
    mock.chan_open_ack_policy_id,
    mock.chan_open_confirm_policy_id,
    mock.chan_close_init_policy_id,
    mock.chan_close_confirm_policy_id,
    mock.recv_packet_policy_id,
    mock.send_packet_policy_id,
    mock.timeout_packet_policy_id,
    mock.acknowledge_packet_policy_id,
    mock.prune_packet_history_policy_id,
    mock.chan_upgrade_policy_id,
    mock.chan_upgrade_handshake_policy_id,
    mock.chan_upgrade_finish_policy_id,
    mock.host_state_nft_policy_id,
    Some(step.before),
    redeemer,
    channel_input.output_reference,
    tx,
  )
}

fn run_host(tx: Transaction, redeemer: HostStateRedeemer) -> Bool {
  let mock = setup()
  expect [_, host_input] = tx.inputs
  host_state_stt.host_state_stt.spend(
    mock.host_state_nft_policy_id,
    "unused client script",
    "unused connection script",
    "mock spend channel script hash",
    mock.client_minting_policy_id,
    mock.connection_minting_policy_id,
    mock.channel_minting_policy_id,
    "",
    None,
    redeemer,
    host_input.output_reference,
    tx,
  )
}

/// The upgrade operation, the channel validator and HostState all accept it.
fn accepted(step: Step) -> Bool {
  run_step(step, True)
}

/// Builds the step's transaction without validating it. Budget reports
/// subtract this from `accepted` to measure the three validators alone.
fn fixture_only(step: Step) -> Bool {
  run_step(step, False)
}

fn run_step(step: Step, validate: Bool) -> Bool {
  let upgrade_redeemer = redeemer(step)
  let tx = transaction(step, upgrade_redeemer)
  expect bytearray.length(cbor.serialise(tx)) > 0
  if validate {
    and {
      run_operation(step, tx)?,
      run_channel(step, tx, ChanUpgrade(upgrade_redeemer))?,
      run_host(tx, UpgradeChannel)?,
    }
  } else {
    True
  }
}

fn operation_accepts(step: Step) -> Bool {
  let upgrade_redeemer = redeemer(step)
  run_operation(step, transaction(step, upgrade_redeemer))
}

// INIT ======================================================================

fn init_step() -> Step {
  let mock = setup()
  Step {
    before: datum(channel(Open, 0), upgrade_state(None, None)),
    after: datum(channel(Open, 1), upgrade_state(Some(initial_pending()), None)),
    step: InitUpgrade { fields: fields(), timeout_period: period },
    references: [
      mock.connection_input,
      mock.client_input,
      replacement_connection(connection_state.Open),
      replacement_client(False, False),
    ],
    signatories: [deployer],
    proof: None,
  }
}

test init_proposes_a_replacement_connection() {
  accepted(init_step())
}

test init_rejects_a_frozen_replacement_client() fail {
  operation_accepts(replacement_health(init_step(), True, False))
}

test init_rejects_an_expired_replacement_client() fail {
  operation_accepts(replacement_health(init_step(), False, True))
}

test init_requires_the_deployment_authority() fail {
  operation_accepts(Step { ..init_step(), signatories: [] })
}

test init_rejects_a_closed_replacement_connection() fail {
  let mock = setup()
  operation_accepts(
    Step {
      ..init_step(),
      references: [
        mock.connection_input,
        replacement_connection(connection_state.Init),
      ],
    },
  )
}

test init_rejects_changed_ordering() fail {
  let ordered = UpgradeFields { ..fields(), ordering: Ordered }
  operation_accepts(
    Step {
      ..init_step(),
      step: InitUpgrade { fields: ordered, timeout_period: period },
      after: datum(
        channel(Open, 1),
        upgrade_state(
          Some(
            PendingUpgrade {
              ..initial_pending(),
              upgrade: Upgrade { ..initial_pending().upgrade, fields: ordered },
            },
          ),
          None,
        ),
      ),
    },
  )
}

test init_rejects_the_current_connection() fail {
  let mock = setup()
  let same = UpgradeFields { ..fields(), connection_hops: [mock.connection_id] }
  operation_accepts(
    Step {
      ..init_step(),
      step: InitUpgrade { fields: same, timeout_period: period },
      after: datum(
        channel(Open, 1),
        upgrade_state(
          Some(
            PendingUpgrade {
              ..initial_pending(),
              upgrade: Upgrade { ..initial_pending().upgrade, fields: same },
            },
          ),
          None,
        ),
      ),
    },
  )
}

test init_rejects_a_short_timeout_period() fail {
  operation_accepts(
    Step {
      ..init_step(),
      step: InitUpgrade { fields: fields(), timeout_period: 60_000 },
      after: datum(
        channel(Open, 1),
        upgrade_state(
          Some(PendingUpgrade { ..initial_pending(), timeout_period: 60_000 }),
          None,
        ),
      ),
    },
  )
}

test init_must_increment_the_sequence() fail {
  operation_accepts(
    Step {
      ..init_step(),
      after: datum(
        channel(Open, 0),
        upgrade_state(Some(initial_pending()), None),
      ),
    },
  )
}

test reinit_invalidates_the_previous_proposal() {
  let mock = setup()
  accepted(
    Step {
      before: datum(
        channel(Open, 1),
        upgrade_state(Some(initial_pending()), None),
      ),
      after: datum(
        channel(Open, 2),
        upgrade_state(
          Some(initial_pending()),
          Some(ErrorReceipt { sequence: 1, message: rules.invalid_upgrade }),
        ),
      ),
      step: InitUpgrade { fields: fields(), timeout_period: period },
      references: [
        mock.connection_input,
        mock.client_input,
        replacement_connection(connection_state.Open),
        replacement_client(False, False),
      ],
      signatories: [deployer],
      proof: None,
    },
  )
}

// TRY =======================================================================

fn try_step(counterparty_sequence: Int) -> Step {
  Step {
    before: datum(
      channel(Open, 1),
      upgrade_state(Some(initial_pending()), None),
    ),
    after: datum(
      channel(Flushing, counterparty_sequence),
      upgrade_state(Some(flushing_pending()), None),
    ),
    step: TryUpgrade {
      counterparty_upgrade_fields: counterparty_fields(),
      counterparty_upgrade_sequence: counterparty_sequence,
      proof_channel: builtin.i_data(1),
      proof_upgrade: builtin.i_data(2),
      proof_height,
    },
    references: handshake_references(),
    signatories: [],
    proof: Some(
      channel_and_upgrade(
        Open,
        counterparty_sequence,
        Upgrade {
          fields: counterparty_fields(),
          timeout: rules.no_timeout(),
          next_sequence_send: 0,
        },
      ),
    ),
  }
}

test try_answers_a_crossing_proposal_and_starts_flushing() {
  accepted(try_step(1))
}

test try_fast_forwards_to_a_higher_counterparty_sequence() {
  accepted(try_step(3))
}

test try_rejects_a_lower_counterparty_sequence() fail {
  operation_accepts(
    Step {
      ..try_step(1),
      before: datum(
        channel(Open, 2),
        upgrade_state(Some(initial_pending()), None),
      ),
    },
  )
}

test try_requires_this_ends_own_proposal() fail {
  operation_accepts(
    Step {
      ..try_step(1),
      before: datum(channel(Open, 0), upgrade_state(None, None)),
    },
  )
}

test try_rejects_a_counterparty_hop_on_another_connection() fail {
  let wrong =
    UpgradeFields { ..counterparty_fields(), connection_hops: ["connection-9"] }
  operation_accepts(
    Step {
      ..try_step(1),
      step: TryUpgrade {
        counterparty_upgrade_fields: wrong,
        counterparty_upgrade_sequence: 1,
        proof_channel: builtin.i_data(1),
        proof_upgrade: builtin.i_data(2),
        proof_height,
      },
      proof: Some(
        channel_and_upgrade(
          Open,
          1,
          Upgrade {
            fields: wrong,
            timeout: rules.no_timeout(),
            next_sequence_send: 0,
          },
        ),
      ),
    },
  )
}

test try_must_record_the_sequencer_boundary() fail {
  operation_accepts(
    Step {
      ..try_step(1),
      after: datum(
        channel(Flushing, 1),
        upgrade_state(
          Some(
            PendingUpgrade {
              ..flushing_pending(),
              upgrade: Upgrade {
                ..flushing_pending().upgrade,
                next_sequence_send: 6,
              },
            },
          ),
          None,
        ),
      ),
    },
  )
}

test try_rejects_a_proof_of_another_value() fail {
  operation_accepts(
    Step {
      ..try_step(1),
      proof: Some(
        channel_and_upgrade(
          Open,
          2,
          Upgrade {
            fields: counterparty_fields(),
            timeout: rules.no_timeout(),
            next_sequence_send: 0,
          },
        ),
      ),
    },
  )
}

// ACK =======================================================================

fn ack_step() -> Step {
  Step {
    before: datum(
      channel(Open, 1),
      upgrade_state(Some(initial_pending()), None),
    ),
    after: datum(
      channel(Flushing, 1),
      upgrade_state(
        Some(
          PendingUpgrade {
            ..flushing_pending(),
            counterparty_upgrade: Some(counterparty_upgrade()),
          },
        ),
        None,
      ),
    ),
    step: AckUpgrade {
      counterparty_upgrade: counterparty_upgrade(),
      proof_channel: builtin.i_data(1),
      proof_upgrade: builtin.i_data(2),
      proof_height,
    },
    references: handshake_references(),
    signatories: [],
    proof: Some(channel_and_upgrade(Flushing, 1, counterparty_upgrade())),
  }
}

test ack_starts_flushing_and_records_the_counterparty_upgrade() {
  accepted(ack_step())
}

test ack_rejects_an_elapsed_counterparty_timeout() fail {
  let elapsed =
    Upgrade {
      ..counterparty_upgrade(),
      timeout: UpgradeTimeout {
        height: height_mod.zero_height(),
        timestamp: valid_to() * 1_000_000,
      },
    }
  operation_accepts(
    Step {
      ..ack_step(),
      step: AckUpgrade {
        counterparty_upgrade: elapsed,
        proof_channel: builtin.i_data(1),
        proof_upgrade: builtin.i_data(2),
        proof_height,
      },
      after: datum(
        channel(Flushing, 1),
        upgrade_state(
          Some(
            PendingUpgrade {
              ..flushing_pending(),
              counterparty_upgrade: Some(elapsed),
            },
          ),
          None,
        ),
      ),
      proof: Some(channel_and_upgrade(Flushing, 1, elapsed)),
    },
  )
}

test ack_rejects_a_counterparty_that_is_not_flushing() fail {
  operation_accepts(
    Step {
      ..ack_step(),
      proof: Some(channel_and_upgrade(Open, 1, counterparty_upgrade())),
    },
  )
}

// CONFIRM ===================================================================

fn confirm_step(flushed_lanes: Int, after_state: ChannelState) -> Step {
  let before_pending = PendingUpgrade { ..flushing_pending(), flushed_lanes }
  Step {
    before: datum(
      channel(Flushing, 1),
      upgrade_state(Some(before_pending), None),
    ),
    after: datum(
      channel(after_state, 1),
      upgrade_state(
        Some(
          PendingUpgrade {
            ..before_pending,
            counterparty_upgrade: Some(counterparty_upgrade()),
          },
        ),
        None,
      ),
    ),
    step: ConfirmUpgrade {
      counterparty_channel_state: FlushComplete,
      counterparty_upgrade: counterparty_upgrade(),
      proof_channel: builtin.i_data(1),
      proof_upgrade: builtin.i_data(2),
      proof_height,
    },
    references: handshake_references(),
    signatories: [],
    proof: Some(channel_and_upgrade(FlushComplete, 1, counterparty_upgrade())),
  }
}

test confirm_records_the_counterparty_upgrade_while_flushing() {
  accepted(confirm_step(1, Flushing))
}

test confirm_completes_a_certified_flush() {
  accepted(confirm_step(lane_count, FlushComplete))
}

test confirm_does_not_complete_an_uncertified_flush() fail {
  operation_accepts(confirm_step(1, FlushComplete))
}

// FLUSH =====================================================================

fn flush_step(
  lanes: Int,
  references: List<Input>,
  counterparty: Option<Upgrade>,
  after_state: ChannelState,
) -> Step {
  let mock = setup()
  let before_pending =
    PendingUpgrade { ..flushing_pending(), counterparty_upgrade: counterparty }
  Step {
    before: datum(
      channel(Flushing, 1),
      upgrade_state(Some(before_pending), None),
    ),
    after: datum(
      channel(after_state, 1),
      upgrade_state(
        Some(PendingUpgrade { ..before_pending, flushed_lanes: lanes }),
        None,
      ),
    ),
    step: FlushUpgrade { lanes },
    references: [
      mock.connection_input,
      mock.client_input,
      replacement_connection(connection_state.Open),
      replacement_client(False, False),
      config(),
      ..references
    ],
    signatories: [],
    proof: None,
  }
}

test flush_completes_when_every_lane_is_empty() {
  accepted(
    flush_step(
      2,
      [lane(0, []), lane(1, [])],
      Some(counterparty_upgrade()),
      FlushComplete,
    ),
  )
}

fn flush_at_deadline(offset: Int) -> Bool {
  let counterparty =
    Upgrade {
      ..counterparty_upgrade(),
      timeout: UpgradeTimeout {
        height: height_mod.zero_height(),
        timestamp: ( valid_to() + offset ) * 1_000_000,
      },
    }
  operation_accepts(
    flush_step(2, [lane(0, []), lane(1, [])], Some(counterparty), FlushComplete),
  )
}

test flush_completes_immediately_before_counterparty_deadline() {
  flush_at_deadline(1)
}

test flush_rejects_exact_counterparty_deadline() fail {
  flush_at_deadline(0)
}

test flush_rejects_after_counterparty_deadline() fail {
  flush_at_deadline(-1)
}

test final_flush_rejects_a_replacement_that_froze_after_preparation() fail {
  expect accepted(init_step())
  operation_accepts(
    replacement_health(
      flush_step(
        2,
        [lane(0, []), lane(1, [])],
        Some(counterparty_upgrade()),
        FlushComplete,
      ),
      True,
      False,
    ),
  )
}

test final_flush_rejects_a_replacement_that_expired_after_preparation() fail {
  expect accepted(init_step())
  operation_accepts(
    replacement_health(
      flush_step(
        2,
        [lane(0, []), lane(1, [])],
        Some(counterparty_upgrade()),
        FlushComplete,
      ),
      False,
      True,
    ),
  )
}

test flush_records_progress_one_lane_at_a_time() {
  accepted(flush_step(1, [lane(0, [])], Some(counterparty_upgrade()), Flushing))
}

test flush_waits_for_the_counterparty_upgrade() {
  accepted(flush_step(2, [lane(0, []), lane(1, [])], None, Flushing))
}

test flush_rejects_a_lane_with_a_packet_in_flight() fail {
  operation_accepts(
    flush_step(
      2,
      [lane(0, []), lane(1, [Pair(3, #"01")])],
      Some(counterparty_upgrade()),
      FlushComplete,
    ),
  )
}

test flush_rejects_a_missing_lane() fail {
  operation_accepts(
    flush_step(2, [lane(0, [])], Some(counterparty_upgrade()), FlushComplete),
  )
}

// OPEN ======================================================================

fn open_step(counterparty_sequence: Int) -> Step {
  let mock = setup()
  let pending =
    PendingUpgrade {
      ..flushing_pending(),
      counterparty_upgrade: Some(counterparty_upgrade()),
      flushed_lanes: lane_count,
    }
  Step {
    before: datum(channel(FlushComplete, 1), upgrade_state(Some(pending), None)),
    after: datum(
      Channel { ..channel(Open, 1), connection_hops: [replacement_id] },
      ChannelUpgradeState {
        pending: None,
        error_receipt: None,
        recv_start_sequence: 9,
      },
    ),
    step: OpenUpgrade {
      counterparty_upgrade_sequence: counterparty_sequence,
      proof_channel: builtin.i_data(1),
      proof_height,
    },
    references: [
      mock.connection_input,
      mock.client_input,
      replacement_connection(connection_state.Open),
      replacement_client(False, False),
    ],
    signatories: [],
    proof: Some(
      single(
        membership(
          1,
          channel_keys.channel_path("transfer", "channel-7"),
          counterparty_channel(
            Open,
            counterparty_replacement,
            counterparty_sequence,
          ),
        ),
      ),
    ),
  }
}

test open_moves_the_channel_to_the_replacement_connection() {
  accepted(open_step(1))
}

test open_finishes_a_partially_completed_handover_after_replacement_expiry() {
  accepted(replacement_health(open_step(1), False, True))
}

test open_finishes_a_partially_completed_handover_after_replacement_freeze() {
  accepted(replacement_health(open_step(1), True, False))
}

test open_remains_possible_after_the_recorded_deadline() {
  let step = open_step(1)
  let before_upgrade = channel_datum.upgrade_state(step.before.state)
  expect Some(pending) = before_upgrade.pending
  expect Some(counterparty) = pending.counterparty_upgrade
  let before =
    ChannelDatum {
      ..step.before,
      state: ChannelDatumState {
        ..step.before.state,
        upgrade: ChannelUpgradeState {
          ..before_upgrade,
          pending: Some(
            PendingUpgrade {
              ..pending,
              counterparty_upgrade: Some(
                Upgrade {
                  ..counterparty,
                  timeout: UpgradeTimeout {
                    height: height_mod.zero_height(),
                    timestamp: valid_to() * 1_000_000,
                  },
                },
              ),
            },
          ),
        },
      },
    }
  accepted(Step { ..step, before })
}

test open_accepts_a_counterparty_that_proposed_again() {
  accepted(open_step(2))
}

test open_requires_the_counterparty_to_be_open_on_its_replacement() fail {
  operation_accepts(
    Step {
      ..open_step(1),
      proof: Some(
        single(
          membership(
            1,
            channel_keys.channel_path("transfer", "channel-7"),
            counterparty_channel(FlushComplete, counterparty_current(), 1),
          ),
        ),
      ),
    },
  )
}

test open_rejects_a_counterparty_on_its_old_connection() fail {
  operation_accepts(
    Step {
      ..open_step(1),
      proof: Some(
        single(
          membership(
            1,
            channel_keys.channel_path("transfer", "channel-7"),
            counterparty_channel(Open, counterparty_current(), 1),
          ),
        ),
      ),
    },
  )
}

test open_requires_the_receive_boundary() fail {
  operation_accepts(
    Step {
      ..open_step(1),
      after: datum(
        Channel { ..channel(Open, 1), connection_hops: [replacement_id] },
        upgrade_state(None, None),
      ),
    },
  )
}

// TIMEOUT ===================================================================

fn timeout_step(counterparty: Channel) -> Step {
  let mock = setup()
  // The proof height's consensus timestamp.
  let pending =
    PendingUpgrade {
      ..flushing_pending(),
      upgrade: Upgrade {
        ..flushing_pending().upgrade,
        timeout: UpgradeTimeout {
          height: height_mod.zero_height(),
          timestamp: 1_577_923_295_000_000_000,
        },
      },
    }
  Step {
    before: datum(channel(Flushing, 1), upgrade_state(Some(pending), None)),
    after: datum(
      channel(Open, 1),
      upgrade_state(
        None,
        Some(ErrorReceipt { sequence: 1, message: rules.upgrade_timeout }),
      ),
    ),
    step: TimeoutUpgrade {
      counterparty_channel: counterparty,
      proof_channel: builtin.i_data(1),
      proof_height,
    },
    references: [
      mock.connection_input,
      mock.client_input,
      replacement_connection(connection_state.Open),
      replacement_client(False, False),
    ],
    signatories: [],
    proof: Some(
      single(
        membership(
          1,
          channel_keys.channel_path("transfer", "channel-7"),
          channel_pb.marshal_for_channel(
            channel_type.convert_to_channel_proto(counterparty),
          ).2nd,
        ),
      ),
    ),
  }
}

fn counterparty_end(state: ChannelState, hop: ByteArray, sequence: Int) {
  let mock = setup()
  Channel {
    state,
    ordering: Unordered,
    counterparty: ChannelCounterparty {
      port_id: "transfer",
      channel_id: mock.channel_id,
    },
    connection_hops: [hop],
    version: "ics20-1",
    upgrade_sequence: sequence,
  }
}

test timeout_restores_the_channel_after_the_counterparty_deadline() {
  accepted(timeout_step(counterparty_end(Flushing, counterparty_current(), 1)))
}

test timeout_rejects_a_counterparty_that_already_opened() fail {
  operation_accepts(
    timeout_step(counterparty_end(Open, counterparty_replacement, 1)),
  )
}

test timeout_accepts_a_counterparty_restored_to_its_old_connection() {
  accepted(timeout_step(counterparty_end(Open, counterparty_current(), 1)))
}

test timeout_rejects_a_flushcomplete_counterparty() fail {
  operation_accepts(
    timeout_step(counterparty_end(FlushComplete, counterparty_current(), 1)),
  )
}

test timeout_waits_for_the_deadline() fail {
  let f = timeout_step(counterparty_end(Flushing, counterparty_current(), 1))
  let pending =
    PendingUpgrade {
      ..flushing_pending(),
      upgrade: Upgrade {
        ..flushing_pending().upgrade,
        timeout: UpgradeTimeout {
          height: height_mod.zero_height(),
          timestamp: 1_577_923_295_000_000_001,
        },
      },
    }
  operation_accepts(
    Step {
      ..f,
      before: datum(channel(Flushing, 1), upgrade_state(Some(pending), None)),
    },
  )
}

// CANCEL ====================================================================

fn cancel_step(state: ChannelState) -> Step {
  let mock = setup()
  Step {
    before: datum(
      channel(state, 1),
      upgrade_state(Some(flushing_pending()), None),
    ),
    after: datum(
      channel(Open, 1),
      upgrade_state(
        None,
        Some(ErrorReceipt { sequence: 1, message: rules.invalid_upgrade }),
      ),
    ),
    step: CancelUpgrade {
      error_receipt: None,
      proof_error_receipt: builtin.i_data(0),
      proof_height,
    },
    references: [mock.connection_input],
    signatories: [deployer],
    proof: None,
  }
}

test authority_cancels_while_flushing() {
  accepted(cancel_step(Flushing))
}

test cancel_without_a_receipt_requires_the_authority() fail {
  operation_accepts(Step { ..cancel_step(Flushing), signatories: [] })
}

test authority_cannot_cancel_after_flushing_completed() fail {
  operation_accepts(cancel_step(FlushComplete))
}

test cancel_with_a_counterparty_receipt_follows_its_sequence() {
  let mock = setup()
  let receipt =
    ErrorReceipt {
      sequence: 3,
      message: "ABCI code: 31: restored channel to pre-upgrade state",
    }
  accepted(
    Step {
      ..cancel_step(Flushing),
      after: datum(
        channel(Open, 3),
        upgrade_state(
          None,
          Some(ErrorReceipt { sequence: 3, message: rules.invalid_upgrade }),
        ),
      ),
      step: CancelUpgrade {
        error_receipt: Some(receipt),
        proof_error_receipt: builtin.i_data(1),
        proof_height,
      },
      references: [mock.connection_input, mock.client_input],
      signatories: [],
      proof: Some(
        single(
          membership(
            1,
            channel_keys.channel_upgrade_error_path("transfer", "channel-7"),
            channel_upgrade_pb.marshal_error_receipt(receipt),
          ),
        ),
      ),
    },
  )
}

test cancel_rejects_a_stale_counterparty_receipt() fail {
  let mock = setup()
  let receipt = ErrorReceipt { sequence: 0, message: "stale" }
  operation_accepts(
    Step {
      ..cancel_step(Flushing),
      after: datum(
        channel(Open, 0),
        upgrade_state(
          None,
          Some(ErrorReceipt { sequence: 0, message: rules.invalid_upgrade }),
        ),
      ),
      step: CancelUpgrade {
        error_receipt: Some(receipt),
        proof_error_receipt: builtin.i_data(1),
        proof_height,
      },
      references: [mock.connection_input, mock.client_input],
      signatories: [],
      proof: Some(
        single(
          membership(
            1,
            channel_keys.channel_upgrade_error_path("transfer", "channel-7"),
            channel_upgrade_pb.marshal_error_receipt(receipt),
          ),
        ),
      ),
    },
  )
}

test error_receipts_only_move_forward() fail {
  let previous = ErrorReceipt { sequence: 1, message: rules.invalid_upgrade }
  operation_accepts(
    Step {
      ..cancel_step(Flushing),
      before: datum(
        channel(Flushing, 1),
        upgrade_state(Some(flushing_pending()), Some(previous)),
      ),
    },
  )
}

// Transaction boundaries ====================================================

test an_upgrade_cannot_spend_other_script_inputs() fail {
  let mock = setup()
  let step = cancel_step(Flushing)
  let upgrade_redeemer = redeemer(step)
  let tx = transaction(step, upgrade_redeemer)
  run_operation(
    step,
    Transaction { ..tx, inputs: list.concat(tx.inputs, [mock.module_input]) },
  )
}

test an_upgrade_cannot_mint_other_assets() fail {
  let step = cancel_step(Flushing)
  let upgrade_redeemer = redeemer(step)
  let tx = transaction(step, upgrade_redeemer)
  run_operation(
    step,
    Transaction {
      ..tx,
      mint: assets.add(tx.mint, "mock voucher policy", "voucher", 1),
    },
  )
}

test an_upgrade_must_commit_its_records() fail {
  let step = init_step()
  let upgrade_redeemer =
    ChannelUpgradeRedeemer { ..redeemer(step), upgrade_siblings: [] }
  run_operation(step, transaction(step, upgrade_redeemer))
}

test the_channel_requires_the_operation_for_the_step() fail {
  let mock = setup()
  // A TRY spend with only the INIT and FLUSH operation's marker.
  let step = try_step(1)
  let upgrade_redeemer = redeemer(step)
  let tx = transaction(step, upgrade_redeemer)
  let redeemers =
    pairs.delete_all(tx.redeemers, Mint(mock.chan_upgrade_handshake_policy_id))
  let token: Redeemer = mock.channel_token
  run_channel(
    step,
    Transaction {
      ..tx,
      redeemers: [Pair(Mint(mock.chan_upgrade_policy_id), token), ..redeemers],
      mint: assets.from_asset(mock.chan_upgrade_policy_id, "", 1),
    },
    ChanUpgrade(upgrade_redeemer),
  )
}

test host_state_requires_an_upgrade_spend_of_the_channel() fail {
  let step = init_step()
  let upgrade_redeemer = redeemer(step)
  let tx = transaction(step, upgrade_redeemer)
  expect [channel_input, ..] = tx.inputs
  let packet: Redeemer =
    RecvPacket {
      packet: Packet {
        sequence: 1,
        source_port: "transfer",
        source_channel: "channel-7",
        destination_port: "transfer",
        destination_channel: "channel-0",
        data: "",
        timeout_height: height_mod.zero_height(),
        timeout_timestamp: 0,
      },
      proof_commitment: builtin.i_data(0),
      proof_height,
    }
  run_host(
    Transaction {
      ..tx,
      redeemers: pairs.map(
        tx.redeemers,
        fn(purpose, data) {
          if purpose == Spend(channel_input.output_reference) {
            packet
          } else {
            data
          }
        },
      ),
    },
    UpgradeChannel,
  )
}

// Receive rules =============================================================

fn receive_state(
  state: ChannelState,
  counterparty: Option<Upgrade>,
  recv_start_sequence: Int,
) -> ChannelDatumState {
  let pending =
    when state is {
      Open -> None
      _ ->
        Some(
          PendingUpgrade {
            ..flushing_pending(),
            counterparty_upgrade: counterparty,
          },
        )
    }
  let upgrade: Data =
    ChannelUpgradeState { pending, error_receipt: None, recv_start_sequence }
  ChannelDatumState {
    ..datum(channel(state, 1), upgrade_state(None, None)).state,
    upgrade,
  }
}

fn can_receive_state(state: ChannelDatumState, sequence: Int) -> Bool {
  channel_datum.can_receive(state.channel.state, state.upgrade, sequence)
}

test flushing_channels_receive_only_below_the_counterparty_boundary() {
  let state = receive_state(Flushing, Some(counterparty_upgrade()), 0)
  and {
    can_receive_state(state, 8),
    !can_receive_state(state, 9),
  }
}

test flushing_channels_receive_before_the_counterparty_upgrade_is_known() {
  can_receive_state(receive_state(Flushing, None, 0), 100)
}

test upgraded_channels_reject_packets_settled_before_opening() {
  let state = receive_state(Open, None, 9)
  and {
    !can_receive_state(state, 8),
    can_receive_state(state, 9),
  }
}

test closed_channels_do_not_receive() {
  !can_receive_state(receive_state(Closed, None, 0), 1)
}

test host_state_redeemer_index_is_stable() {
  let raw: Data = UpgradeChannel
  let previous: Data =
    HandlePacket {
      channel_siblings: [],
      next_sequence_send_siblings: [],
      next_sequence_recv_siblings: [],
      next_sequence_ack_siblings: [],
      packet_commitment_siblings: [],
      packet_receipt_siblings: [],
      packet_acknowledgement_siblings: [],
    }
  and {
    builtin.fst_pair(builtin.un_constr_data(raw)) == 14,
    builtin.fst_pair(builtin.un_constr_data(previous)) == 7,
  }
}

// The bytes are the Gateway's encodings, pinned in
// cardano/gateway/src/shared/types/redeemer-encoding-regression.spec.ts.
fn gateway_redeemer(step: ChannelUpgradeStep, siblings: List<ByteArray>) {
  let upgrade: Data =
    ChannelUpgradeRedeemer {
      step,
      channel_siblings: siblings,
      upgrade_siblings: [],
      error_receipt_siblings: [],
    }
  let redeemer: SpendChannelRedeemer = ChanUpgrade(upgrade)
  let redeemer: Data = redeemer
  Some(redeemer)
}

fn gateway_fields() {
  UpgradeFields {
    ordering: Unordered,
    connection_hops: ["connection-1"],
    version: "ics20-1",
  }
}

test gateway_init_upgrade_redeemer_matches() {
  cbor.deserialise(
    #"d9050481d87984d87982d87983d87a80814c636f6e6e656374696f6e2d314769637332302d311a0036ee808141aa8080",
  ) == gateway_redeemer(
    InitUpgrade { fields: gateway_fields(), timeout_period: 3_600_000 },
    [#"aa"],
  )
}

test gateway_timeout_upgrade_redeemer_matches() {
  cbor.deserialise(
    #"d9050481d87984d87e83d87986d87e80d87a80d87982487472616e73666572496368616e6e656c2d30814c636f6e6e656374696f6e2d394769637332302d3102d8798180d87982010d808080",
  ) == gateway_redeemer(
    TimeoutUpgrade {
      counterparty_channel: Channel {
        state: Flushing,
        ordering: Unordered,
        counterparty: ChannelCounterparty {
          port_id: "transfer",
          channel_id: "channel-0",
        },
        connection_hops: ["connection-9"],
        version: "ics20-1",
        upgrade_sequence: 2,
      },
      proof_channel: merkle.MerkleProof { proofs: [] },
      proof_height: Height { revision_number: 1, revision_height: 13 },
    },
    [],
  )
}

test gateway_flush_upgrade_redeemer_matches() {
  cbor.deserialise(#"d9050481d87984d905008104808080") == gateway_redeemer(
    FlushUpgrade { lanes: 4 },
    [],
  )
}

test gateway_upgrade_channel_host_redeemer_matches() {
  let redeemer: Data = UpgradeChannel
  cbor.deserialise(#"d9050780") == Some(redeemer)
}

// Fixture baselines for the budget report, one per accepted step above.
test init_fixture_setup_baseline() {
  fixture_only(init_step())
}

test try_fixture_setup_baseline() {
  fixture_only(try_step(1))
}

test ack_fixture_setup_baseline() {
  fixture_only(ack_step())
}

test confirm_fixture_setup_baseline() {
  fixture_only(confirm_step(lane_count, FlushComplete))
}

test open_fixture_setup_baseline() {
  fixture_only(open_step(1))
}

test flush_fixture_setup_baseline() {
  fixture_only(deployment_flush_step())
}

test timeout_fixture_setup_baseline() {
  fixture_only(
    timeout_step(counterparty_end(Flushing, counterparty_current(), 1)),
  )
}

test cancel_fixture_setup_baseline() {
  fixture_only(cancel_step(Flushing))
}

/// FLUSH at the Gateway's per-transaction limit of a 16-lane deployment.
fn deployment_flush_step() -> Step {
  let mock = setup()
  let step =
    flush_step(
      8,
      list.map(list.range(0, 7), fn(index) { lane_of(16, index, []) }),
      Some(counterparty_upgrade()),
      Flushing,
    )
  Step {
    ..step,
    references: [
      mock.connection_input,
      config_for(16),
      ..list.map(list.range(0, 7), fn(index) { lane_of(16, index, []) })
    ],
  }
}

test flush_certifies_eight_lanes_of_a_deployment() {
  accepted(deployment_flush_step())
}
