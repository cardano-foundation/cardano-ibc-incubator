use aiken/builtin
use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/bytearray
use aiken/primitive/int
use cardano/address.{from_verification_key}
use cardano/assets.{PolicyId, Value, quantity_of, tokens}
use cardano/transaction.{
  Input, Mint, Output, OutputReference, Redeemer, ScriptPurpose, Transaction,
}
use ibc/apps/transfer/channel_callback as transfer_channel_callback
use ibc/apps/transfer/escrow as transfer_escrow
use ibc/apps/transfer/escrow.{TransferModuleSpend}
use ibc/apps/transfer/ibc_module as transfer_ibc_module
use ibc/apps/transfer/refund as transfer_refund
use ibc/apps/transfer/transfer_module_redeemer.{
  OtherTransferOp, ReclaimEscrowShard, Transfer, TransferModuleRedeemer,
}
use ibc/apps/transfer/types/coin as transfer_coin
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/apps/transfer/value_delta as transfer_value_delta
use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{ChannelDatum}
use ibc/core/ics_004/channel_redeemer.{
  AcknowledgePacket, RecvPacket, SendPacket, TimeoutPacket,
}
use ibc/core/ics_004/types/acknowledgement as acknowledgement_mod
use ibc/core/ics_004/types/acknowledgement_response.{AcknowledgementError}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_004/types/packet as packet_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, IBCModuleCallback, IBCModuleOperator, IBCModulePacketData,
  IBCModuleRedeemer, ModuleDataV1, ModuleOperatorV1, OnAcknowledgementPacket,
  OnChanCloseConfirm, OnChanCloseInit, OnChanOpenAck, OnChanOpenConfirm,
  OnChanOpenInit, OnChanOpenTry, OnChanReclaim, OnHostStateSeal, OnRecvPacket,
  OnSendPacket, OnTimeoutPacket, Operator,
}
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

validator spend_transfer_module(
  port_token: AuthToken,
  module_token: AuthToken,
  port_id: ByteArray,
  transfer_escrow_shard_policy_id: PolicyId,
  channel_minting_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
  host_state_nft_policy_id: PolicyId,
  lifecycle_marker_policy_id: PolicyId,
) {
  spend(
    _datum: Option<Data>,
    redeemer: IBCModuleRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    when redeemer is {
      Callback(OnHostStateSeal) ->
        validate_transfer_lifecycle_invocation(
          transaction,
          spent_output_ref,
          lifecycle_marker_policy_id,
          port_id,
          port_token,
          module_token,
          True,
        )
      Callback(OnChanReclaim { .. }) ->
        validate_transfer_lifecycle_invocation(
          transaction,
          spent_output_ref,
          lifecycle_marker_policy_id,
          port_id,
          port_token,
          module_token,
          False,
        )
      _ -> {
        let Transaction { inputs, outputs, redeemers, .. } = transaction

        // A voucher policy can be reused accidentally, so bind any voucher
        // action in this transaction to this exact module root before
        // dispatching the callback or operator branch.
        expect
          voucher_action_absent_or_targets_module(
            redeemers,
            voucher_minting_policy_id,
            module_token,
          )

        // Transfer state transitions must be committed through HostState.
        let (host_state_input, _) =
          validator_utils.require_host_state_thread(
            inputs,
            outputs,
            host_state_nft_policy_id,
          )
        expect Some(spent_input) =
          transaction.find_input(inputs, spent_output_ref)
        let spent_output = spent_input.output
        // Classify whether this spend is root state or a packet escrow shard.
        let spend =
          transfer_escrow.classify_transfer_module_spend(
            spent_output,
            transaction.outputs,
            port_token,
            module_token,
            transfer_escrow_shard_policy_id,
          )

        // Channel auth tokens are minted by `mint_channel_stt` using the HostState NFT
        // as the base token. The transfer module must derive the *same* token name when
        // locating the channel UTxO in the transaction.
        let host_state_nft =
          AuthToken {
            policy_id: host_state_nft_policy_id,
            name: host_state_token_name,
          }

        when redeemer is {
          Callback(cb) ->
            module_callback(
              cb,
              host_state_nft,
              spent_input,
              transaction,
              spend,
              host_state_input,
              port_id,
              port_token,
              transfer_escrow_shard_policy_id,
              channel_minting_policy_id,
              voucher_minting_policy_id,
            )
          Operator(op) ->
            module_operator(
              decode_transfer_operator(op),
              host_state_nft,
              spent_input,
              transaction,
              spend,
              host_state_input,
              port_token,
              transfer_escrow_shard_policy_id,
              channel_minting_policy_id,
              voucher_minting_policy_id,
            )
        }
      }
    }
  }

  else(_) {
    fail
  }
}

fn module_callback(
  cb: IBCModuleCallback,
  host_state_nft: AuthToken,
  spent_input: Input,
  transaction: Transaction,
  spend: TransferModuleSpend,
  host_state_input: Input,
  port_id: ByteArray,
  port_token: AuthToken,
  shard_policy_id: PolicyId,
  channel_minting_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
) -> Bool {
  let Transaction { outputs, redeemers, inputs, mint, .. } = transaction

  when cb is {
    OnSendPacket { channel_id, packet_data, packet_commitment, data } -> {
      let transfer_data = decode_transfer_packet_data(data)
      expect
        exact_send_callback_matches(
          transaction,
          host_state_nft,
          channel_minting_policy_id,
          channel_id,
          packet_data,
          packet_commitment,
        )

      module_operator(
        Transfer { channel_id, data: transfer_data },
        host_state_nft,
        spent_input,
        transaction,
        spend,
        host_state_input,
        port_token,
        shard_policy_id,
        channel_minting_policy_id,
        voucher_minting_policy_id,
      )
    }

    OnChanOpenInit { channel_id } -> {
      let updated_output = transfer_escrow.expect_module_state(spend)
      let output_channel =
        transfer_channel_callback.validate_channel_open_init(
          redeemers,
          channel_minting_policy_id,
          host_state_nft,
          outputs,
          port_id,
          channel_id,
        )
      and {
        transfer_value_delta.validate_output_amount(
          spent_input,
          updated_output,
          assets.zero,
        )?,
        transfer_ibc_module.validate_on_chan_open_init(
          output_channel.ordering,
          output_channel.connection_hops,
          port_id,
          channel_id,
          output_channel.counterparty,
          output_channel.version,
        )?,
      }
    }

    OnChanOpenTry { channel_id } -> {
      let updated_output = transfer_escrow.expect_module_state(spend)
      expect Some((output_channel, counterparty_version)) =
        transfer_channel_callback.validate_channel_open_try(
          redeemers,
          channel_minting_policy_id,
          host_state_nft,
          outputs,
          port_id,
          channel_id,
        )
      and {
        transfer_value_delta.validate_output_amount(
          spent_input,
          updated_output,
          assets.zero,
        )?,
        transfer_ibc_module.validate_on_chan_open_try(
          output_channel.ordering,
          output_channel.connection_hops,
          port_id,
          channel_id,
          output_channel.counterparty,
          output_channel.version,
          counterparty_version,
        )?,
      }
    }

    OnChanOpenAck { channel_id } -> {
      let updated_output = transfer_escrow.expect_module_state(spend)
      expect Some((output_channel, counterparty_version)) =
        transfer_channel_callback.validate_chan_open_ack(
          inputs,
          redeemers,
          channel_minting_policy_id,
          host_state_nft,
          outputs,
          port_id,
          channel_id,
        )

      and {
        transfer_value_delta.validate_output_amount(
          spent_input,
          updated_output,
          assets.zero,
        )?,
        transfer_ibc_module.validate_on_chan_open_ack(
          port_id,
          channel_id,
          output_channel.counterparty.channel_id,
          counterparty_version,
        )?,
      }
    }

    OnChanOpenConfirm { channel_id } -> {
      let updated_output = transfer_escrow.expect_module_state(spend)
      expect Some(_) =
        transfer_channel_callback.validate_chan_open_confirm(
          inputs,
          redeemers,
          channel_minting_policy_id,
          host_state_nft,
          outputs,
          port_id,
          channel_id,
        )
      and {
        transfer_value_delta.validate_output_amount(
          spent_input,
          updated_output,
          assets.zero,
        )?,
        transfer_ibc_module.validate_on_chan_open_confirm(port_id, channel_id)?,
      }
    }

    OnChanCloseInit { .. } | OnChanCloseConfirm { .. } ->
      validate_unchanged_module_root(spent_input, spend)
    OnChanReclaim { .. } | OnHostStateSeal -> False
    OnRecvPacket { channel_id, packet_data, acknowledgement, data } -> {
      trace @"spend_transfer_module: Callback.OnRecvPacket branch"

      expect transfer_ibc_module.validate_on_chan_recv_packet(acknowledgement)
      trace @"spend_transfer_module: acknowledgement is valid"

      let data = decode_transfer_packet_data(data)
      expect fungible_token_packet_data.validate_basic(data)
      trace @"spend_transfer_module: redeemer data is valid"

      expect Some(channel_redeemer) =
        transfer_channel_callback.extract_channel_redeemer(
          inputs,
          redeemers,
          channel_minting_policy_id,
          host_state_nft,
          channel_id,
        )
      expect RecvPacket { packet, .. } = channel_redeemer
      trace @"spend_transfer_module: channel redeemer is valid"

      expect packet_data == packet.data
      expect fungible_token_packet_data.get_bytes(data) == packet.data
      trace @"spend_transfer_module: FungibleTokenPacketData is unmarshal valid"

      if transfer_coin.receiver_chain_is_source(
        packet.source_port,
        packet.source_channel,
        data.denom,
      ) {
        // Receiving on the source chain means the packet is returning escrowed
        // native value, not creating a voucher representation.
        expect !voucher_policy_is_used(mint, voucher_minting_policy_id)

        let voucher_prefix_len =
          transfer_coin.get_denom_prefix(
            packet.source_port,
            packet.source_channel,
          )
            |> bytearray.length()
        let unprefixed_denom =
          bytearray.length(data.denom) - 1
            |> bytearray.slice(data.denom, voucher_prefix_len, _)

        expect Some(escrowed_token_unit) =
          string_utils.hex_string_to_bytes(unprefixed_denom)
        trace @"spend_transfer_module: demon convert to token unit valid"

        let (escrowed_token_policy_id, escrowed_token_name) =
          validator_utils.extract_token_unit(escrowed_token_unit)
        trace @"spend_transfer_module: extract escrowed token valid"

        expect Some(transfer_amount) = int.from_utf8(data.amount)
        trace @"spend_transfer_module: transfer amount is valid"

        let expected_escrow_value_difference =
          assets.from_asset(
            escrowed_token_policy_id,
            escrowed_token_name,
            transfer_amount,
          )
            |> assets.negate()

        // Negative shard deltas retain an empty registered shard when depleted.
        let valid_transfer_amount =
          transfer_escrow.validate_module_escrow_transition(
            spent_input,
            spend,
            inputs,
            outputs,
            transfer_escrow.transfer_escrow_datum(channel_id, unprefixed_denom),
            shard_policy_id,
            mint,
            0 - transfer_amount,
            expected_escrow_value_difference,
            escrowed_token_unit,
          )

        expect Some(receiver_public_key_hash) =
          string_utils.hex_string_to_bytes(data.receiver)
        let receiver_address = from_verification_key(receiver_public_key_hash)

        trace @"spend_transfer_module: start channel logic for transfer module"
        expect channel_keys.is_valid_channel_id(channel_id)

        let channel_sequence =
          channel_keys.parse_channel_id_sequence(channel_id)

        let channel_token_name =
          auth.generate_token_name(
            host_state_nft,
            channel_keys.channel_prefix,
            channel_sequence,
          )

        let channel_token =
          AuthToken {
            policy_id: channel_minting_policy_id,
            name: channel_token_name,
          }

        trace @"spend_transfer_module: locating channel inputs and outputs"
        expect Some(_) =
          list.find(
            inputs,
            fn(input) { input.output |> auth.contain_auth_token(channel_token) },
          )

        expect Some(channel_output) =
          list.find(
            outputs,
            fn(output) { auth.contain_auth_token(output, channel_token) },
          )

        expect updated_channel_datum: ChannelDatum =
          validator_utils.get_inline_datum(channel_output)

        trace @"spend_transfer_module: extracted datums from channel inputs and outputs"

        let channel_id_from_sequence =
          channel_keys.format_channel_identifier(channel_sequence)

        // The mandatory RecvPacket marker validates the complete channel
        // successor, including the acknowledgement and receive proof heights.
        // This callback independently owns the transfer-value effects and the
        // exact channel-token binding, so repeating that datum transition here
        // would add no protocol-level protection.
        expect Some(payout_output) =
          list.find(
            transaction.outputs,
            fn(output) { output.address == receiver_address },
          )

        let derived_channel_sequence =
          auth.extract_token_sequence(updated_channel_datum.token.name)

        and {
          valid_transfer_amount?,
          (channel_id_from_sequence == channel_id)?,
          (derived_channel_sequence == channel_sequence)?,
          (quantity_of(
            payout_output.value,
            escrowed_token_policy_id,
            escrowed_token_name,
          ) >= transfer_amount)?,
        }
      } else {
        // Non-source receive mints vouchers.
        trace @"mint_voucher: tx mint voucher token"

        // The voucher policy owns the exact module-supply transition. Its
        // policy id and packet redeemer are still bound here, so the policy is
        // necessarily executed for this non-zero mint.
        expect transfer_escrow.ModuleState { .. } = spend
        voucher_policy_is_used(mint, voucher_minting_policy_id)
      }
    }
    OnTimeoutPacket { channel_id, packet_data, data } -> {
      trace @"spend_transfer_module: Callback.OnTimeoutPacket branch"

      expect Some(channel_redeemer) =
        transfer_channel_callback.extract_channel_redeemer(
          inputs,
          redeemers,
          channel_minting_policy_id,
          host_state_nft,
          channel_id,
        )
      expect TimeoutPacket { packet, .. } = channel_redeemer
      trace @"spend_transfer_module: channel redeemer is valid"

      expect packet_data == packet.data
      let data = decode_transfer_packet_data(data)
      // Timeout refunds the sender-side packet effect.
      let valid_refund_packet =
        transfer_refund.validate_refund_packet_token(
          voucher_minting_policy_id,
          inputs,
          outputs,
          spent_input,
          spend,
          shard_policy_id,
          mint,
          data,
          packet,
        )

      and {
        valid_refund_packet?,
        (fungible_token_packet_data.get_bytes(data) == packet.data)?,
      }
    }
    OnAcknowledgementPacket { channel_id, packet_data, acknowledgement, data } -> {
      trace @"spend_transfer_module: Callback.OnAcknowledgementPacket branch"

      expect Some(channel_redeemer) =
        transfer_channel_callback.extract_channel_redeemer(
          inputs,
          redeemers,
          channel_minting_policy_id,
          host_state_nft,
          channel_id,
        )
      expect AcknowledgePacket { packet, acknowledgement: channel_ack, .. } =
        channel_redeemer
      trace @"spend_transfer_module: channel redeemer is valid"

      expect packet_data == packet.data
      let tf_data = decode_transfer_packet_data(data)
      when acknowledgement.response is {
        AcknowledgementError { .. } -> and {
            // Only error acknowledgements trigger transfer refunds.
            fungible_token_packet_data.get_bytes(tf_data) == packet.data,
            acknowledgement_mod.marshal_json(acknowledgement) == channel_ack,
            transfer_refund.validate_refund_packet_token(
              voucher_minting_policy_id,
              inputs,
              outputs,
              spent_input,
              spend,
              shard_policy_id,
              mint,
              tf_data,
              packet,
            ),
          }
        _ -> {
          let updated_output = transfer_escrow.expect_module_state(spend)
          // Ack success leaves transfer supply unchanged.
          and {
            transfer_value_delta.validate_output_amount(
              spent_input,
              updated_output,
              assets.zero,
            )?,
            (fungible_token_packet_data.get_bytes(tf_data) == packet.data)?,
            (acknowledgement_mod.marshal_json(acknowledgement) == channel_ack)?,
          }
        }
      }
    }
  }
}

fn validate_unchanged_module_root(
  spent_input: Input,
  spend: TransferModuleSpend,
) -> Bool {
  let updated_output = transfer_escrow.expect_module_state(spend)
  transfer_value_delta.validate_output_amount(
    spent_input,
    updated_output,
    assets.zero,
  )
}

fn exact_send_callback_matches(
  transaction: Transaction,
  host_state_nft: AuthToken,
  channel_minting_policy_id: PolicyId,
  channel_id: ByteArray,
  packet_data: ByteArray,
  packet_commitment: ByteArray,
) -> Bool {
  let Transaction { inputs, redeemers, .. } = transaction
  expect Some(channel_redeemer) =
    transfer_channel_callback.extract_channel_redeemer(
      inputs,
      redeemers,
      channel_minting_policy_id,
      host_state_nft,
      channel_id,
    )
  expect SendPacket { packet } = channel_redeemer

  and {
    packet_data == packet.data,
    packet_commitment == packet_mod.commit_packet(packet),
  }
}

fn module_operator(
  op: TransferModuleRedeemer,
  host_state_nft: AuthToken,
  spent_input: Input,
  transaction: Transaction,
  spend: TransferModuleSpend,
  host_state_input: Input,
  port_token: AuthToken,
  shard_policy_id: PolicyId,
  channel_minting_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
) -> Bool {
  let Transaction { redeemers, inputs, mint, .. } = transaction

  when op is {
    Transfer { channel_id, data } -> {
      trace @"spend_transfer_module: Operator.Transfer branch"

      expect fungible_token_packet_data.validate_basic(data)
      trace @"spend_transfer_module: redeemer data is valid"

      expect Some(channel_redeemer) =
        transfer_channel_callback.extract_channel_redeemer(
          inputs,
          redeemers,
          channel_minting_policy_id,
          host_state_nft,
          channel_id,
        )
      expect SendPacket { packet } = channel_redeemer
      trace @"spend_transfer_module: channel redeemer is valid"

      expect fungible_token_packet_data.get_bytes(data) == packet.data
      trace @"spend_transfer_module: FungibleTokenPacketData is unmarshal valid"

      if transfer_coin.sender_chain_is_source(
        packet.source_port,
        packet.source_channel,
        data.denom,
      ) {
        // During shutdown, users may still burn vouchers or settle/refund
        // in-flight packets, but new source-chain escrow deposits are blocked.
        expect _ = validator_utils.require_active_host_state(host_state_input)

        // Sending from the source chain locks native value in escrow.
        expect !voucher_policy_is_used(mint, voucher_minting_policy_id)
        trace @"spend_transfer_module: tx not mint voucher token"

        expect Some(escrowed_token_unit) =
          string_utils.hex_string_to_bytes(data.denom)
        trace @"spend_transfer_module: demon convert to token unit valid"

        let (escrowed_token_policy_id, escrowed_token_name) =
          validator_utils.extract_token_unit(escrowed_token_unit)
        trace @"spend_transfer_module: extract escrowed token valid"

        expect Some(transfer_amount) = int.from_utf8(data.amount)
        trace @"spend_transfer_module: transfer amount is valid"

        let expected_escrow_value_difference =
          assets.from_asset(
            escrowed_token_policy_id,
            escrowed_token_name,
            transfer_amount,
          )

        // Positive shard delta creates or updates escrow.
        let valid_transfer_amount =
          transfer_escrow.validate_module_escrow_transition(
            spent_input,
            spend,
            inputs,
            transaction.outputs,
            transfer_escrow.transfer_escrow_datum(channel_id, data.denom),
            shard_policy_id,
            mint,
            transfer_amount,
            expected_escrow_value_difference,
            escrowed_token_unit,
          )

        valid_transfer_amount
      } else {
        // Sending from a sink chain destroys the voucher representation.
        // The voucher policy checks the matching negative supply delta on the
        // module root while this validator binds that policy to the packet.
        expect transfer_escrow.ModuleState { .. } = spend
        voucher_policy_is_used(mint, voucher_minting_policy_id)
      }
    }

    ReclaimEscrowShard { channel_id, denom } -> {
      expect Some(raw_shard_redeemer) =
        pairs.get_first(redeemers, Mint(shard_policy_id))
      let Pair(_, shard_fields) = builtin.un_constr_data(raw_shard_redeemer)
      expect Some(raw_target_port_token) = list.last(shard_fields)
      // The companion shard policy validates the closed-channel witness, zero
      // logical principal, registry/count transition, token burn, and value
      // absorption. Bind each spending invocation to that exact policy action.
      let authorized = and {
          raw_target_port_token == auth_token_data(port_token),
          !(mint |> tokens(shard_policy_id) |> dict.is_empty),
        }
      when spend is {
        transfer_escrow.ModuleState { .. } -> authorized
        transfer_escrow.EscrowShard { datum, .. } -> and {
            authorized,
            datum.channel_id == channel_id,
            datum.denom == denom,
          }
      }
    }

    OtherTransferOp -> False
  }
}

// Transfer decodes opaque V1 envelopes only at its boundary so ICS-005 core never depends on transfer types.
fn decode_transfer_packet_data(
  module_data: IBCModulePacketData,
) -> FungibleTokenPacketData {
  expect ModuleDataV1(data) = module_data
  expect transfer_data: FungibleTokenPacketData = data
  transfer_data
}

fn decode_transfer_operator(
  module_operator: IBCModuleOperator,
) -> TransferModuleRedeemer {
  expect ModuleOperatorV1(data) = module_operator
  expect transfer_operator: TransferModuleRedeemer = data
  transfer_operator
}

fn voucher_policy_is_used(mint: Value, policy_id: PolicyId) -> Bool {
  !(mint |> tokens(policy_id) |> dict.is_empty)
}

fn voucher_action_absent_or_targets_module(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  policy_id: PolicyId,
  module_token: AuthToken,
) -> Bool {
  when pairs.get_first(redeemers, Mint(policy_id)) is {
    None -> True
    Some(raw_redeemer) -> {
      let Pair(_, fields) = builtin.un_constr_data(raw_redeemer)
      expect Some(raw_target) = list.last(fields)
      raw_target == auth_token_data(module_token)
    }
  }
}

fn validate_transfer_lifecycle_invocation(
  transaction: Transaction,
  spent_output_ref: OutputReference,
  policy_id: PolicyId,
  port_id: ByteArray,
  port_token: AuthToken,
  module_token: AuthToken,
  terminal: Bool,
) -> Bool {
  let Transaction { inputs, .. } = transaction
  expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
  and {
    auth.contain_auth_token(spent_input.output, module_token),
    validate_lifecycle_marker(
      transaction,
      policy_id,
      port_id,
      port_token,
      module_token,
      terminal,
    ),
  }
}

fn validate_lifecycle_marker(
  transaction: Transaction,
  policy_id: PolicyId,
  port_id: ByteArray,
  port_token: AuthToken,
  module_token: AuthToken,
  terminal: Bool,
) -> Bool {
  let Transaction { mint, redeemers, .. } = transaction
  expect Some(raw_redeemer) = pairs.get_first(redeemers, Mint(policy_id))
  let expected_redeemer =
    builtin.constr_data(
      if terminal {
        2
      } else {
        1
      },
      [
        builtin.b_data(port_id),
        auth_token_data(port_token),
        auth_token_data(module_token),
      ],
    )
  and {
    raw_redeemer == expected_redeemer,
    !(mint |> tokens(policy_id) |> dict.is_empty),
  }
}

fn auth_token_data(token: AuthToken) -> Data {
  builtin.constr_data(
    0,
    [builtin.b_data(token.policy_id), builtin.b_data(token.name)],
  )
}
