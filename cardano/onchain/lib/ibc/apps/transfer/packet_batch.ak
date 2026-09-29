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
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/verify
use ibc/core/ics_004/channel_datum.{ChannelDatum}
use ibc/core/ics_004/packet_lane_datum.{
  CommitPacket, CompletePacket, LaneUpdate, PacketLaneDatum,
}
use ibc/core/ics_004/packet_lane_state
use ibc/core/ics_004/packet_lanes
use ibc/core/ics_004/send_sequencer.{SendSequencerDatum}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/order.{Unordered}
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state.{Open}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/utils/string as string_utils
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

pub fn operation(transaction: Transaction, policy: PolicyId) -> BatchOperation {
  expect Some(raw) = pairs.get_first(transaction.redeemers, Mint(policy))
  expect op: BatchOperation = raw
  op
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
  expect datum.state.channel.state == Open
  expect datum.state.channel.ordering == Unordered
  expect datum.state.channel.version == "ics20-1"
  datum
}

fn asset_and_amount(
  data: FungibleTokenPacketData,
) -> (ByteArray, ByteArray, Int) {
  expect fungible_token_packet_data.validate_basic(data)
  expect Some(unit) = string_utils.hex_string_to_bytes(data.denom)
  let (policy, name) = validator_utils.extract_token_unit(unit)
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
  policy: PolicyId,
  channel_token: AuthToken,
  sequencer_token: AuthToken,
  lane_policy: PolicyId,
  client_policy: PolicyId,
  connection_policy: PolicyId,
  lane_count: Int,
  op: BatchOperation,
) -> Bool {
  expect SendBatch { sequencer_ref, intents, packets, lanes } = op
  expect unique_refs(intents)
  expect list.length(intents) == list.length(packets)
  expect unique_refs(list.map(lanes, fn(lane) { lane.input_ref }))
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
      None,
      None,
    )
  expect connection.state.state == connection_state.Open
  expect
    client_state.status(
      client.state.client_state,
      valid_to,
      client.state.consensus_states,
    ) == Active
  let latest_height = client_state.get_latest_height(client.state.client_state)
  expect Some(latest_timestamp) =
    client_state.get_timestamp_at_height(
      client.state.client_state,
      client.state.consensus_states,
      latest_height,
    )
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
  let minted =
    list.foldl(
      list.zip(intents, packets),
      dict.empty,
      fn(pair, minted) {
        let (ref, packet) = pair
        expect validate_local_packet(packet, channel)
        expect packet.timeout_timestamp > latest_timestamp
        expect packet.timeout_timestamp > valid_to
        let input = input_at(transaction, ref)
        expect intent: TransferIntent =
          validator_utils.get_inline_datum(input.output)
        expect intent.port_id == packet.source_port
        expect intent.channel_id == packet.source_channel
        expect bytearray.length(intent.owner) == 28
        expect Some(sender) =
          string_utils.hex_string_to_bytes(intent.data.sender)
        expect sender == intent.owner
        expect packet.timeout_timestamp == intent.timeout_timestamp
        expect
          fungible_token_packet_data.matches_bytes(intent.data, packet.data)
        let (asset_policy, asset_name, amount) = asset_and_amount(intent.data)
        expect asset_policy != policy
        // All intent funds go to escrow. The batcher supplies fees independently.
        let principal = assets.from_asset(asset_policy, asset_name, amount)
        expect assets.match_assets(input.output.value, principal)
        expect
          assets.lovelace_of(input.output.value) >= assets.lovelace_of(
            principal,
          )
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
        expect actual: LiquidityDatum = validator_utils.get_inline_datum(escrow)
        expect actual == datum
        expect liquidity.valid_value(escrow, datum, policy)
        expect
          assets.lovelace_of(escrow.value) >= assets.lovelace_of(
            input.output.value,
          )
        dict.insert(minted, token.name, 1)
      },
    )
  expect assets.tokens(transaction.mint, policy) == minted
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
        expect
          packet_lane_state.validate_transition(
            transaction,
            lane.input_ref,
            lane_policy,
            lane.updates,
          )
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
  op: BatchOperation,
) -> Bool {
  let (packet, proof_height, proof, lane, timeout) =
    when op is {
      Acknowledge { packet, proof_height, proof, lane } ->
        (packet, proof_height, proof, lane, False)
      Timeout { packet, proof_height, proof, lane, .. } ->
        (packet, proof_height, proof, lane, True)
      _ -> fail
    }
  let channel = channel_reference(transaction, channel_token)
  expect validate_local_packet(packet, channel)
  expect [connection_id] = channel.state.channel.connection_hops
  let valid_to =
    validator_utils.get_tx_valid_to(transaction.validity_range) * 1_000_000
  let valid_from =
    validator_utils.get_tx_valid_from(transaction.validity_range) * 1_000_000
  let (connection, client) =
    validator_utils.validate_referred_connection_and_client(
      transaction.reference_inputs,
      channel_token.name,
      client_policy,
      connection_policy,
      connection_id,
      valid_to,
      Some(proof_height),
      None,
    )
  expect connection.state.state == connection_state.Open
  expect
    client_state.status(
      client.state.client_state,
      valid_to,
      client.state.consensus_states,
    ) == Active
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
  expect
    if timeout {
      expect
        packet.timeout_timestamp > 0 && consensus.timestamp >= packet.timeout_timestamp
      client_state.verify_non_membership(
        client.state.client_state,
        consensus,
        proof_height,
        processed_time,
        processed_height,
        valid_from,
        client_datum.processed_height_from_time(valid_from),
        connection.state.delay_period,
        verify.get_block_delay(connection.state),
        proof,
        path,
      )
    } else {
      client_state.verify_membership(
        client.state.client_state,
        consensus,
        proof_height,
        processed_time,
        processed_height,
        valid_from,
        client_datum.processed_height_from_time(valid_from),
        connection.state.delay_period,
        verify.get_block_delay(connection.state),
        proof,
        path,
        crypto.sha2_256("{\"result\":\"AQ==\"}"),
      )
    }
  let input = input_at(transaction, lane.input_ref)
  expect datum: PacketLaneDatum = validator_utils.get_inline_datum(input.output)
  expect datum.lane_count == lane_count
  expect
    list.map(lane.updates, fn(update) { update.mutation }) == [
      CompletePacket { packet },
    ]
  expect
    packet_lane_state.validate_transition(
      transaction,
      lane.input_ref,
      lane_policy,
      lane.updates,
    )
  if timeout {
    expect Timeout { data, liquidity_refs, .. } = op
    expect unique_refs(liquidity_refs)
    expect fungible_token_packet_data.matches_bytes(data, packet.data)
    let (asset_policy, asset_name, amount) = asset_and_amount(data)
    let (released, burns) =
      list.foldl(
        liquidity_refs,
        (0, dict.singleton("timeout", 1)),
        fn(ref, acc) {
          let (total, burns) = acc
          let input = input_at(transaction, ref)
          expect escrow: LiquidityDatum =
            validator_utils.get_inline_datum(input.output)
          expect
            escrow.port_id == packet.source_port && escrow.channel_id == packet.source_channel
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
    expect Some(owner) = string_utils.hex_string_to_bytes(data.sender)
    expect bytearray.length(owner) == 28
    let refund: Data =
      PacketRefund {
        port_id: packet.source_port,
        channel_id: packet.source_channel,
        sequence: packet.sequence,
      }
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
  } else {
    assets.tokens(transaction.mint, policy) == dict.singleton("acknowledge", 1)
  }
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
  expect unique_refs(refs)
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
