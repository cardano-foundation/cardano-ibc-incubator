use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto
use aiken/primitive/bytearray
use aiken/primitive/int
use cardano/address.{Script, from_verification_key}
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, Mint, OutputReference, Transaction}
use ibc/apps/transfer/liquidity.{LiquidityDatum}
use ibc/apps/transfer/mint_voucher_redeemer.{PacketBatch}
use ibc/apps/transfer/types/coin as transfer_coin
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/apps/transfer/voucher_asset_name
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/consensus_history.{Witness}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/core/ics_002_client_semantics/client_view
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_002_client_semantics/verify_proof_redeemer.{
  BatchVerifyMembershipAndNonMembership, VerifyMembership,
  VerifyMembershipParams, VerifyNonMembership, VerifyNonMembershipParams,
  VerifyProofRedeemer,
}
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/verify
use ibc/core/ics_004/channel_datum.{ChannelDatum}
use ibc/core/ics_004/packet_lane_datum.{
  CommitPacket, CompletePacket, LaneUpdate, PacketLaneDatum, PrunePacket,
  ReceivePacket,
}
use ibc/core/ics_004/packet_lanes
use ibc/core/ics_004/send_sequencer.{SendSequencerDatum}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/order.{Unordered}
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state.{Closed, Open}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use ibc/core/ics_024_host_requirements/channel_keys as channel_paths
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/encoding/hex
use ibc/utils/validator_utils

pub type TransferIntent {
  port_id: ByteArray,
  channel_id: ByteArray,
  owner: ByteArray,
  data: FungibleTokenPacketData,
  timeout_timestamp: Int,
}

pub type LaneInputUpdate {
  input_ref: OutputReference,
  updates: List<LaneUpdate>,
}

pub type BatchOperation {
  SendBatch {
    sequencer_ref: OutputReference,
    intents: List<OutputReference>,
    packets: List<Packet>,
    lanes: List<LaneInputUpdate>,
  }
  Acknowledge {
    packet: Packet,
    proof_height: Height,
    proof: MerkleProof,
    lane: LaneInputUpdate,
  }
  Timeout {
    packet: Packet,
    data: FungibleTokenPacketData,
    proof_height: Height,
    proof: MerkleProof,
    lane: LaneInputUpdate,
    liquidity_refs: List<OutputReference>,
  }
  RetireEmpty { liquidity_refs: List<OutputReference> }
  Consolidate {
    liquidity_refs: List<OutputReference>,
    survivor_ref: OutputReference,
  }
  Receive {
    packet: Packet,
    data: FungibleTokenPacketData,
    proof_height: Height,
    proof: MerkleProof,
    lane: LaneInputUpdate,
    liquidity_refs: List<OutputReference>,
  }
  Reject {
    packet: Packet,
    data: FungibleTokenPacketData,
    err: ByteArray,
    proof_height: Height,
    proof: MerkleProof,
    lane: LaneInputUpdate,
    liquidity_refs: List<OutputReference>,
  }
  Prune {
    sequence: Int,
    proof_height: Height,
    proof: MerkleProof,
    lane: LaneInputUpdate,
  }
  TimeoutOnClose {
    packet: Packet,
    data: FungibleTokenPacketData,
    proof_height: Height,
    proof: MerkleProof,
    lane: LaneInputUpdate,
    liquidity_refs: List<OutputReference>,
    proof_close: MerkleProof,
  }
}

pub type AuthorizedOperation {
  channel_token: AuthToken,
  operation: BatchOperation,
  history_witness: Option<Witness>,
}

pub type PacketRefund {
  port_id: ByteArray,
  channel_id: ByteArray,
  sequence: Int,
}

pub fn input_at(transaction: Transaction, ref: OutputReference) -> Input {
  expect Some(input) = transaction.find_input(transaction.inputs, ref)
  input
}

pub fn authorization(
  transaction: Transaction,
  policy: PolicyId,
) -> AuthorizedOperation {
  expect Some(raw) = pairs.get_first(transaction.redeemers, Mint(policy))
  expect authorized: AuthorizedOperation = raw
  authorized
}

pub fn operation(transaction: Transaction, policy: PolicyId) -> BatchOperation {
  authorization(transaction, policy).operation
}

fn history_witness(transaction: Transaction, policy: PolicyId) -> Option<Data> {
  expect Some(raw) = pairs.get_first(transaction.redeemers, Mint(policy))
  expect authorized: AuthorizedOperation = raw
  when authorized.history_witness is {
    None -> None
    Some(witness) -> {
      let raw: Data = witness
      Some(raw)
    }
  }
}

// Issuance pins this NFT to the lane guard. Spending it runs the exact state
// transition there, while the operation validates the requested mutations.
fn authenticate_lane(
  transaction: Transaction,
  ref: OutputReference,
  policy: PolicyId,
) -> Bool {
  let input = input_at(transaction, ref)
  expect datum: PacketLaneDatum = validator_utils.get_inline_datum(input.output)
  auth.contain_auth_token(
    input.output,
    AuthToken {
      policy_id: policy,
      name: packet_lanes.lane_token_name(
        datum.port_id,
        datum.channel_id,
        datum.lane,
        datum.lane_count,
      ),
    },
  )
}

fn require_proof(
  transaction: Transaction,
  policy: PolicyId,
  expected: VerifyProofRedeemer,
) -> Bool {
  expect
    validator_utils.require_exact_marker_mint(transaction.mint, policy, "", 1)
  validator_utils.proof_matches(
    validator_utils.verify_proof_envelope(transaction.redeemers, policy).proof,
    expected,
  )
}

fn unique_refs(refs: List<OutputReference>) -> Bool {
  and {
    refs != [],
    list.length(refs) <= send_sequencer.max_send_batch_size,
    list.length(list.unique(refs)) == list.length(refs),
  }
}

fn channel_reference(transaction: Transaction, token: AuthToken) -> ChannelDatum {
  expect [input] =
    list.filter(
      transaction.reference_inputs,
      fn(input) { auth.contain_auth_token(input.output, token) },
    )
  expect datum: ChannelDatum = validator_utils.get_inline_datum(input.output)
  expect datum.token == token
  expect datum.port_id == "transfer"
  expect
    datum.state.channel.state == Open || datum.state.channel.state == Closed
  expect datum.state.channel.ordering == Unordered
  expect datum.state.channel.version == "ics20-1"
  datum
}

fn asset_and_amount(
  data: FungibleTokenPacketData,
  voucher_policy: PolicyId,
) -> (ByteArray, ByteArray, Int) {
  expect fungible_token_packet_data.validate_basic(data)
  let (policy, name) =
    when hex.decode(data.denom) is {
      Some(unit) -> validator_utils.extract_token_unit(unit)
      None ->
        (voucher_policy, voucher_asset_name.voucher_user_token_name(data.denom))
    }
  expect Some(amount) = int.from_utf8(data.amount)
  (policy, name, amount)
}

fn validate_local_packet(packet: Packet, channel: ChannelDatum) -> Bool {
  let channel_id =
    channel_keys.format_channel_identifier(
      auth.extract_token_sequence(channel.token.name),
    )
  and {
    packet_mod.validate_basic(packet),
    packet.source_port == channel.port_id,
    packet.source_channel == channel_id,
    packet.destination_port == channel.state.channel.counterparty.port_id,
    packet.destination_channel == channel.state.channel.counterparty.channel_id,
    height_mod.is_zero(packet.timeout_height),
  }
}

pub fn validate_send(
  transaction: Transaction,
  _policy: PolicyId,
  channel_token: AuthToken,
  sequencer_token: AuthToken,
  lane_policy: PolicyId,
  client_policy: PolicyId,
  connection_policy: PolicyId,
  lane_count: Int,
  _voucher_policy: PolicyId,
  op: BatchOperation,
) -> Bool {
  expect SendBatch { sequencer_ref, intents, packets, lanes } = op
  expect unique_refs(intents)
  expect list.length(intents) == list.length(packets)
  expect unique_refs(list.map(lanes, fn(lane) { lane.input_ref }))
  let channel = channel_reference(transaction, channel_token)
  expect channel.state.channel.state == Open
  expect [connection_id] = channel.state.channel.connection_hops
  let valid_to =
    validator_utils.get_tx_valid_to(transaction.validity_range) * 1_000_000
  let connection =
    validator_utils.validate_referred_connection(
      transaction.reference_inputs,
      channel_token.name,
      connection_policy,
      connection_id,
    )
  let client =
    validator_utils.validate_referred_client(
      transaction.reference_inputs,
      channel_token.name,
      client_policy,
      connection.state.client_id,
      valid_to,
      None,
      None,
    )
  expect connection.state.state == connection_state.Open
  expect client.status == Active
  let latest_height = client.latest_height
  expect Some(latest_timestamp) =
    client_view.timestamp_at_height(client, latest_height)
  let sequencer_input = input_at(transaction, sequencer_ref)
  expect auth.contain_auth_token(sequencer_input.output, sequencer_token)
  expect
    assets.quantity_of(
      transaction.mint,
      sequencer_token.policy_id,
      sequencer_token.name,
    ) == 0
  expect old: SendSequencerDatum =
    validator_utils.get_inline_datum(sequencer_input.output)
  expect old.port_id == channel.port_id
  expect
    sequencer_token.name == packet_lanes.sequencer_token_name(
      old.port_id,
      old.channel_id,
    )
  let output =
    validator_utils.find_unique_continuation_output(
      sequencer_input.output,
      transaction.outputs,
      sequencer_token,
    )
  expect new: SendSequencerDatum = validator_utils.get_inline_datum(output)
  expect new == send_sequencer.advance(old, packets)
  expect
    list.all(
      packets,
      fn(packet) {
        validate_local_packet(packet, channel) && packet.timeout_timestamp > latest_timestamp && packet.timeout_timestamp > valid_to
      },
    )
  let assigned =
    list.map(
      packets,
      fn(packet) {
        packet_lanes.packet_lane(
          packet.source_port,
          packet.source_channel,
          packet.sequence,
          lane_count,
        )
      },
    )
      |> list.unique
  expect list.length(lanes) == list.length(assigned)
  let touched =
    list.map(
      lanes,
      fn(lane) {
        let input = input_at(transaction, lane.input_ref)
        expect datum: PacketLaneDatum =
          validator_utils.get_inline_datum(input.output)
        expect datum.lane_count == lane_count
        let expected =
          list.filter(
            packets,
            fn(packet) {
              packet_lanes.packet_lane(
                packet.source_port,
                packet.source_channel,
                packet.sequence,
                lane_count,
              ) == datum.lane
            },
          )
            |> list.map(fn(packet) { CommitPacket { packet } })
        expect
          list.map(lane.updates, fn(update) { update.mutation }) == expected
        expect authenticate_lane(transaction, lane.input_ref, lane_policy)
        datum.lane
      },
    )
  list.sort(touched, int.compare) == list.sort(assigned, int.compare)
}

pub fn validate_settlement(
  transaction: Transaction,
  policy: PolicyId,
  channel_token: AuthToken,
  lane_policy: PolicyId,
  client_policy: PolicyId,
  connection_policy: PolicyId,
  lane_count: Int,
  _voucher_policy: PolicyId,
  op: BatchOperation,
  verify_policy: PolicyId,
) -> Bool {
  let (packet, proof_height, proof, lane, timeout) =
    when op is {
      Acknowledge { packet, proof_height, proof, lane } ->
        (packet, proof_height, proof, lane, False)
      Timeout { packet, proof_height, proof, lane, .. } |
      TimeoutOnClose { packet, proof_height, proof, lane, .. } ->
        (packet, proof_height, proof, lane, True)
      Reject { packet, proof_height, proof, lane, .. } ->
        (packet, proof_height, proof, lane, False)
      _ -> fail
    }
  let channel = channel_reference(transaction, channel_token)
  expect validate_local_packet(packet, channel)
  expect [connection_id] = channel.state.channel.connection_hops
  let valid_to =
    validator_utils.get_tx_valid_to(transaction.validity_range) * 1_000_000
  let (connection, client) =
    validator_utils.validate_referred_connection_and_client(
      transaction.reference_inputs,
      channel_token.name,
      client_policy,
      connection_policy,
      connection_id,
      valid_to,
      Some(proof_height),
      history_witness(transaction, policy),
    )
  expect connection.state.state == connection_state.Open
  expect client.status == Active
  expect Some(consensus) =
    pairs.get_first(client.state.consensus_states, proof_height)
  expect Some(processed_time) =
    pairs.get_first(client.state.processed_times, proof_height)
  expect Some(processed_height) =
    pairs.get_first(client.state.processed_heights, proof_height)
  let key =
    if timeout {
      packet_keys.packet_receipt_path(
        packet.destination_port,
        packet.destination_channel,
        packet.sequence,
      )
    } else {
      packet_keys.packet_acknowledgement_path(
        packet.destination_port,
        packet.destination_channel,
        packet.sequence,
      )
    }
  let path =
    merkle.apply_prefix(
      connection.state.counterparty.prefix,
      merkle.new_merkle_path([key]),
    )
  let absence =
    VerifyNonMembershipParams {
      cs: client.state.client_state,
      cons_state: consensus,
      height: proof_height,
      processed_time,
      processed_height,
      delay_time_period: connection.state.delay_period,
      delay_block_period: verify.get_block_delay(connection.state),
      proof,
      path,
    }
  let expected_proof =
    if timeout {
      when op is {
        TimeoutOnClose { proof_close, .. } -> {
          let expected_channel =
            Channel {
              state: Closed,
              ordering: Unordered,
              counterparty: ChannelCounterparty {
                port_id: packet.source_port,
                channel_id: packet.source_channel,
              },
              connection_hops: [connection.state.counterparty.connection_id],
              version: channel.state.channel.version,
            }
          let membership =
            VerifyMembershipParams {
              cs: client.state.client_state,
              cons_state: consensus,
              height: proof_height,
              processed_time,
              processed_height,
              delay_time_period: 0,
              delay_block_period: 0,
              proof: proof_close,
              path: merkle.apply_prefix(
                connection.state.counterparty.prefix,
                merkle.new_merkle_path(
                  [
                    channel_paths.channel_path(
                      packet.destination_port,
                      packet.destination_channel,
                    ),
                  ],
                ),
              ),
              value: channel_pb.marshal_for_channel(
                channel.convert_to_channel_proto(expected_channel),
              ).2nd,
            }
          BatchVerifyMembershipAndNonMembership {
            memberships: [membership],
            non_memberships: [absence],
          }
        }
        _ -> {
          expect Some(timestamp) =
            client_view.timestamp_at_height(client, proof_height)
          expect
            packet.timeout_timestamp > 0 && timestamp >= packet.timeout_timestamp
          VerifyNonMembership {
            cs: absence.cs,
            cons_state: absence.cons_state,
            height: absence.height,
            processed_time,
            processed_height,
            delay_time_period: absence.delay_time_period,
            delay_block_period: absence.delay_block_period,
            proof,
            path,
          }
        }
      }
    } else {
      VerifyMembership {
        cs: absence.cs,
        cons_state: absence.cons_state,
        height: absence.height,
        processed_time,
        processed_height,
        delay_time_period: absence.delay_time_period,
        delay_block_period: absence.delay_block_period,
        proof,
        path,
        value: crypto.sha2_256(
          when op is {
            Reject { err, .. } -> {
              expect bytearray.length(err) > 0
              bytearray.concat("{\"error\":\"", err) |> bytearray.concat("\"}")
            }
            _ -> "{\"result\":\"AQ==\"}"
          },
        ),
      }
    }
  expect require_proof(transaction, verify_policy, expected_proof)
  let input = input_at(transaction, lane.input_ref)
  expect datum: PacketLaneDatum = validator_utils.get_inline_datum(input.output)
  expect datum.lane_count == lane_count
  expect
    list.map(lane.updates, fn(update) { update.mutation }) == [
      CompletePacket { packet },
    ]
  expect authenticate_lane(transaction, lane.input_ref, lane_policy)
  True
}

fn validate_release(
  transaction: Transaction,
  policy: PolicyId,
  port: ByteArray,
  channel: ByteArray,
  sequence: Int,
  data: FungibleTokenPacketData,
  recipient: ByteArray,
  refs: List<OutputReference>,
  voucher_policy: PolicyId,
  marker: ByteArray,
) -> Bool {
  expect
    refs != [] && list.length(refs) <= 5 && list.length(list.unique(refs)) == list.length(
      refs,
    )
  let (asset_policy, asset_name, amount) =
    asset_and_amount(data, voucher_policy)
  let (released, burns) =
    list.foldl(
      refs,
      (0, dict.singleton(marker, 1)),
      fn(ref, acc) {
        let (total, burns) = acc
        let input = input_at(transaction, ref)
        expect escrow: LiquidityDatum =
          validator_utils.get_inline_datum(input.output)
        expect escrow.port_id == port && escrow.channel_id == channel
        expect
          escrow.denom == data.denom && escrow.asset_policy == asset_policy && escrow.asset_name == asset_name
        let token = liquidity.identity(escrow, policy)
        if assets.quantity_of(transaction.mint, policy, token.name) == -1 {
          (
            total + liquidity.retired_amount(input, transaction, policy),
            dict.insert(burns, token.name, -1),
          )
        } else {
          expect assets.quantity_of(transaction.mint, policy, token.name) == 0
          (
            total + liquidity.released_amount(
              input,
              transaction.outputs,
              policy,
            ),
            burns,
          )
        }
      },
    )
  expect released == amount
  expect assets.tokens(transaction.mint, policy) == burns
  expect Some(owner) = hex.decode(recipient)
  expect bytearray.length(owner) == 28
  let refund: Data =
    PacketRefund { port_id: port, channel_id: channel, sequence }
  expect [payment] =
    list.filter(
      transaction.outputs,
      fn(output) {
        output.address == from_verification_key(owner) && output.datum == transaction.InlineDatum(
          refund,
        )
      },
    )
  assets.quantity_of(payment.value, asset_policy, asset_name) >= amount
}

pub fn validate_receive(
  transaction: Transaction,
  policy: PolicyId,
  channel_token: AuthToken,
  lane_policy: PolicyId,
  client_policy: PolicyId,
  connection_policy: PolicyId,
  lane_count: Int,
  _voucher_policy: PolicyId,
  op: BatchOperation,
  verify_policy: PolicyId,
) -> Bool {
  expect Receive { packet, proof_height, proof, lane, .. } = op
  let channel = channel_reference(transaction, channel_token)
  expect channel.state.channel.state == Open
  let local_channel =
    channel_keys.format_channel_identifier(
      auth.extract_token_sequence(channel.token.name),
    )
  expect packet_mod.validate_basic(packet)
  expect
    packet.destination_port == channel.port_id && packet.destination_channel == local_channel
  expect packet.source_port == channel.state.channel.counterparty.port_id
  expect packet.source_channel == channel.state.channel.counterparty.channel_id
  expect height_mod.is_zero(packet.timeout_height)
  let valid_to =
    validator_utils.get_tx_valid_to(transaction.validity_range) * 1_000_000
  expect packet.timeout_timestamp == 0 || packet.timeout_timestamp > valid_to
  expect [connection_id] = channel.state.channel.connection_hops
  let (connection, client) =
    validator_utils.validate_referred_connection_and_client(
      transaction.reference_inputs,
      channel_token.name,
      client_policy,
      connection_policy,
      connection_id,
      valid_to,
      Some(proof_height),
      history_witness(transaction, policy),
    )
  expect connection.state.state == connection_state.Open
  expect client.status == Active
  expect Some(consensus) =
    pairs.get_first(client.state.consensus_states, proof_height)
  expect Some(processed_time) =
    pairs.get_first(client.state.processed_times, proof_height)
  expect Some(processed_height) =
    pairs.get_first(client.state.processed_heights, proof_height)
  let key =
    packet_keys.packet_commitment_path(
      packet.source_port,
      packet.source_channel,
      packet.sequence,
    )
  expect
    require_proof(
      transaction,
      verify_policy,
      VerifyMembership {
        cs: client.state.client_state,
        cons_state: consensus,
        height: proof_height,
        processed_time,
        processed_height,
        delay_time_period: connection.state.delay_period,
        delay_block_period: verify.get_block_delay(connection.state),
        proof,
        path: merkle.apply_prefix(
          connection.state.counterparty.prefix,
          merkle.new_merkle_path([key]),
        ),
        value: packet_mod.commit_packet(packet),
      },
    )
  let input = input_at(transaction, lane.input_ref)
  expect datum: PacketLaneDatum = validator_utils.get_inline_datum(input.output)
  expect datum.lane_count == lane_count
  expect
    list.map(lane.updates, fn(update) { update.mutation }) == [
      ReceivePacket {
        packet,
        acknowledgement: crypto.sha2_256("{\"result\":\"AQ==\"}"),
        proof_height,
      },
    ]
  expect authenticate_lane(transaction, lane.input_ref, lane_policy)
  True
}

pub fn validate_retirement(
  transaction: Transaction,
  policy: PolicyId,
  op: BatchOperation,
) -> Bool {
  let (refs, survivor) =
    when op is {
      RetireEmpty { liquidity_refs } -> (liquidity_refs, None)
      Consolidate { liquidity_refs, survivor_ref } ->
        (liquidity_refs, Some(survivor_ref))
      _ -> fail
    }
  expect
    refs != [] && list.length(refs) <= 5 && list.length(list.unique(refs)) == list.length(
      refs,
    )
  let inputs = list.map(refs, fn(ref) { input_at(transaction, ref) })
  when survivor is {
    Some(ref) -> {
      expect liquidity.consolidate(inputs, transaction, policy, ref)
    }
    None -> {
      expect
        list.all(
          inputs,
          fn(input) {
            liquidity.retired_amount(input, transaction, policy) == 0
          },
        )
    }
  }
  let burns =
    list.foldl(
      inputs,
      dict.empty,
      fn(input, burns) {
        if Some(input.output_reference) == survivor {
          burns
        } else {
          expect datum: LiquidityDatum =
            validator_utils.get_inline_datum(input.output)
          dict.insert(burns, liquidity.identity(datum, policy).name, -1)
        }
      },
    )
  assets.tokens(transaction.mint, policy) == burns
}

fn validate_voucher_payment(
  transaction: Transaction,
  policy: PolicyId,
  voucher_policy: PolicyId,
  port: ByteArray,
  channel: ByteArray,
  sequence: Int,
  denom: ByteArray,
  amount_text: ByteArray,
  recipient: ByteArray,
  marker: ByteArray,
) -> Bool {
  expect Some(raw) =
    pairs.get_first(transaction.redeemers, Mint(voucher_policy))
  expect PacketBatch = raw
  expect Some(amount) = int.from_utf8(amount_text)
  expect amount > 0
  let name = voucher_asset_name.voucher_user_token_name(denom)
  expect assets.quantity_of(transaction.mint, voucher_policy, name) == amount
  expect assets.tokens(transaction.mint, policy) == dict.singleton(marker, 1)
  expect Some(owner) = hex.decode(recipient)
  expect bytearray.length(owner) == 28
  let refund: Data =
    PacketRefund { port_id: port, channel_id: channel, sequence }
  expect [payment] =
    list.filter(
      transaction.outputs,
      fn(output) {
        output.address == from_verification_key(owner) && output.datum == transaction.InlineDatum(
          refund,
        )
      },
    )
  assets.quantity_of(payment.value, voucher_policy, name) == amount
}

pub fn validate_prune(
  transaction: Transaction,
  policy: PolicyId,
  channel_token: AuthToken,
  lane_policy: PolicyId,
  client_policy: PolicyId,
  connection_policy: PolicyId,
  lane_count: Int,
  op: BatchOperation,
  verify_policy: PolicyId,
) -> Bool {
  expect Prune { sequence, proof_height, proof, lane } = op
  let channel = channel_reference(transaction, channel_token)
  expect [connection_id] = channel.state.channel.connection_hops
  let valid_to =
    validator_utils.get_tx_valid_to(transaction.validity_range) * 1_000_000
  let (connection, client) =
    validator_utils.validate_referred_connection_and_client(
      transaction.reference_inputs,
      channel_token.name,
      client_policy,
      connection_policy,
      connection_id,
      valid_to,
      Some(proof_height),
      history_witness(transaction, policy),
    )
  expect connection.state.state == connection_state.Open
  expect client.status == Active
  expect Some(consensus) =
    pairs.get_first(client.state.consensus_states, proof_height)
  expect Some(processed_time) =
    pairs.get_first(client.state.processed_times, proof_height)
  expect Some(processed_height) =
    pairs.get_first(client.state.processed_heights, proof_height)
  let path =
    merkle.apply_prefix(
      connection.state.counterparty.prefix,
      merkle.new_merkle_path(
        [
          packet_keys.packet_commitment_path(
            channel.state.channel.counterparty.port_id,
            channel.state.channel.counterparty.channel_id,
            sequence,
          ),
        ],
      ),
    )
  expect
    require_proof(
      transaction,
      verify_policy,
      VerifyNonMembership {
        cs: client.state.client_state,
        cons_state: consensus,
        height: proof_height,
        processed_time,
        processed_height,
        delay_time_period: connection.state.delay_period,
        delay_block_period: verify.get_block_delay(connection.state),
        proof,
        path,
      },
    )
  let input = input_at(transaction, lane.input_ref)
  expect datum: PacketLaneDatum = validator_utils.get_inline_datum(input.output)
  expect datum.port_id == channel.port_id
  expect
    datum.channel_id == channel_keys.format_channel_identifier(
      auth.extract_token_sequence(channel.token.name),
    )
  expect datum.lane_count == lane_count
  expect
    list.map(lane.updates, fn(update) { update.mutation }) == [
      PrunePacket { sequence, proof_height },
    ]
  expect authenticate_lane(transaction, lane.input_ref, lane_policy)
  assets.tokens(transaction.mint, policy) == dict.singleton("prune", 1)
}

// The router requires this policy alongside the operation policy, so funds and
// packet state are checked atomically without duplicating monetary code.
pub fn validate_send_funds(
  transaction: Transaction,
  policy: PolicyId,
  voucher_policy: PolicyId,
  op: BatchOperation,
) -> Bool {
  expect SendBatch { intents, packets, .. } = op
  let minted =
    list.foldl(
      list.zip(intents, packets),
      dict.empty,
      fn(pair, minted) {
        let (ref, packet) = pair
        let input = input_at(transaction, ref)
        expect intent: TransferIntent =
          validator_utils.get_inline_datum(input.output)
        expect intent.port_id == packet.source_port
        expect intent.channel_id == packet.source_channel
        expect bytearray.length(intent.owner) == 28
        expect Some(sender) = hex.decode(intent.data.sender)
        expect sender == intent.owner
        expect packet.timeout_timestamp == intent.timeout_timestamp
        expect
          fungible_token_packet_data.matches_bytes(intent.data, packet.data)
        let (asset_policy, asset_name, amount) =
          asset_and_amount(intent.data, voucher_policy)
        expect asset_policy != policy
        // All intent funds go to escrow. The batcher supplies fees independently.
        let principal = assets.from_asset(asset_policy, asset_name, amount)
        expect assets.match_assets(input.output.value, principal)
        expect
          assets.lovelace_of(input.output.value) >= assets.lovelace_of(
            principal,
          )
        if !transfer_coin.sender_chain_is_source(
          intent.port_id,
          intent.channel_id,
          intent.data.denom,
        ) {
          expect asset_policy == voucher_policy
          expect Some(raw) =
            pairs.get_first(transaction.redeemers, Mint(voucher_policy))
          expect PacketBatch = raw
          // A burn consumes the user's asset and returns all of their ADA reserve.
          expect [payment] =
            list.filter(
              transaction.outputs,
              fn(output) {
                output.address == from_verification_key(intent.owner) && output.datum == transaction.InlineDatum(
                  ref,
                )
              },
            )
          expect
            assets.lovelace_of(payment.value) >= assets.lovelace_of(
              input.output.value,
            )
          dict.insert(minted, "send", 1)
        } else {
          let datum =
            LiquidityDatum {
              port_id: intent.port_id,
              channel_id: intent.channel_id,
              denom: intent.data.denom,
              asset_policy,
              asset_name,
              deposit: ref,
              amount,
              reserve_owner: from_verification_key(intent.owner),
            }
          let token = liquidity.identity(datum, policy)
          expect [escrow] =
            list.filter(
              transaction.outputs,
              fn(output) { auth.contain_auth_token(output, token) },
            )
          expect escrow.address.payment_credential == Script(policy)
          expect actual: LiquidityDatum =
            validator_utils.get_inline_datum(escrow)
          expect actual == datum
          expect liquidity.valid_value(escrow, datum, policy)
          expect
            assets.lovelace_of(escrow.value) >= assets.lovelace_of(
              input.output.value,
            )
          dict.insert(minted, token.name, 1)
        }
      },
    )
  assets.tokens(transaction.mint, policy) == minted
}

pub fn validate_funds(
  transaction: Transaction,
  policy: PolicyId,
  voucher_policy: PolicyId,
  op: BatchOperation,
) -> Bool {
  when op is {
    Receive { packet, data, liquidity_refs, .. } -> {
      expect fungible_token_packet_data.matches_bytes(data, packet.data)
      if transfer_coin.receiver_chain_is_source(
        packet.source_port,
        packet.source_channel,
        data.denom,
      ) {
        let prefix =
          transfer_coin.get_denom_prefix(
            packet.source_port,
            packet.source_channel,
          )
        let local_data =
          FungibleTokenPacketData {
            ..data,
            denom: bytearray.drop(data.denom, bytearray.length(prefix)),
          }
        validate_release(
          transaction,
          policy,
          packet.destination_port,
          packet.destination_channel,
          packet.sequence,
          local_data,
          data.receiver,
          liquidity_refs,
          voucher_policy,
          "receive",
        )
      } else {
        expect liquidity_refs == []
        let denom =
          bytearray.concat(
            transfer_coin.get_denom_prefix(
              packet.destination_port,
              packet.destination_channel,
            ),
            data.denom,
          )
        validate_voucher_payment(
          transaction,
          policy,
          voucher_policy,
          packet.destination_port,
          packet.destination_channel,
          packet.sequence,
          denom,
          data.amount,
          data.receiver,
          "receive",
        )
      }
    }
    Acknowledge { .. } ->
      assets.tokens(transaction.mint, policy) == dict.singleton(
        "acknowledge",
        1,
      )
    Timeout { packet, .. } |
    TimeoutOnClose { packet, .. } |
    Reject { packet, .. } -> {
      let timeout =
        when op is {
          Reject { .. } -> False
          _ -> True
        }
      when op is {
        Timeout { data, liquidity_refs, .. } |
        TimeoutOnClose { data, liquidity_refs, .. } |
        Reject { data, liquidity_refs, .. } -> {
          expect fungible_token_packet_data.matches_bytes(data, packet.data)
          let marker =
            if timeout {
              "timeout"
            } else {
              "reject"
            }
          if transfer_coin.sender_chain_is_source(
            packet.source_port,
            packet.source_channel,
            data.denom,
          ) {
            validate_release(
              transaction,
              policy,
              packet.source_port,
              packet.source_channel,
              packet.sequence,
              data,
              data.sender,
              liquidity_refs,
              voucher_policy,
              marker,
            )
          } else {
            expect liquidity_refs == []
            validate_voucher_payment(
              transaction,
              policy,
              voucher_policy,
              packet.source_port,
              packet.source_channel,
              packet.sequence,
              data.denom,
              data.amount,
              data.sender,
              marker,
            )
          }
        }
        _ ->
          assets.tokens(transaction.mint, policy) == dict.singleton(
            "acknowledge",
            1,
          )
      }
    }
    _ -> False
  }
}
