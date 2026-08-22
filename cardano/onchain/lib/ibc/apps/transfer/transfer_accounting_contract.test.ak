use aiken/collection/list
use aiken/fuzz
use aiken/primitive/bytearray
use cardano/address.{Address, from_script, from_verification_key}
use cardano/assets.{
  Value, ada_asset_name, ada_policy_id, add, from_asset, quantity_of,
}
use cardano/transaction.{
  InlineDatum, Input, Mint, NoDatum, Output, OutputReference, Redeemer,
  ScriptPurpose,
}
use ibc/apps/transfer/escrow as transfer_escrow
use ibc/apps/transfer/escrow.{EscrowShard}
use ibc/apps/transfer/mint_voucher_redeemer.{
  BurnVoucher, MintVoucher, MintVoucherRedeemer, RefundVoucher,
}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/types/escrow_datum.{TransferEscrowDatum}
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/apps/transfer/value_delta
use ibc/apps/transfer/voucher_asset_name
use ibc/apps/transfer/voucher_flow
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_004/types/acknowledgement as acknowledgement_mod
use ibc/core/ics_004/types/packet.{Packet}
use ibc/testing/fuzz_dsl
use ibc/utils/string as string_utils

const channel_id = "channel-0"

const source_port = "transfer"

const source_channel = "channel-0"

const destination_port = "transfer"

const destination_channel = "channel-9"

const native_policy_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const native_token_name = "coin"

const shard_policy_id = "mock transfer escrow shard policy id"

const voucher_policy_id = "mock voucher minting policy id"

const amount = 20

fn module_token() -> AuthToken {
  AuthToken { policy_id: "module-policy", name: "module-token" }
}

const valid_cardano_receiver =
  #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

fn native_denom() -> ByteArray {
  "61616161"
    |> bytearray.concat("61616161")
    |> bytearray.concat("61616161")
    |> bytearray.concat("61616161")
    |> bytearray.concat("61616161")
    |> bytearray.concat("61616161")
    |> bytearray.concat("61616161")
    |> bytearray.concat("636f696e")
}

fn sink_voucher_denom() -> ByteArray {
  "transfer/channel-9/uatom"
}

fn module_output(value: Value) -> Output {
  Output {
    address: from_script("transfer-module"),
    value,
    datum: NoDatum,
    reference_script: None,
  }
}

fn module_input() -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"0101010101010101010101010101010101010101010101010101010101010101",
      output_index: 0,
    },
    output: module_output(from_asset("module-policy", "module-token", 1)),
  }
}

fn escrow_datum(
  channel_id: ByteArray,
  denom: ByteArray,
  escrowed_amount: Int,
) -> TransferEscrowDatum {
  TransferEscrowDatum { channel_id, denom, escrowed_amount }
}

fn escrow_output(
  channel_id: ByteArray,
  denom: ByteArray,
  quantity: Int,
) -> Output {
  escrow_output_with_principal(channel_id, denom, quantity, quantity)
}

fn escrow_output_with_principal(
  channel_id: ByteArray,
  denom: ByteArray,
  quantity: Int,
  escrowed_amount: Int,
) -> Output {
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(channel_id, denom)
  Output {
    address: from_script("transfer-module"),
    value: from_asset(native_policy_id, native_token_name, quantity)
      |> add(shard_policy_id, shard_token_name, 1),
    datum: InlineDatum(escrow_datum(channel_id, denom, escrowed_amount)),
    reference_script: None,
  }
}

fn escrow_input(
  output_index: Int,
  channel_id: ByteArray,
  denom: ByteArray,
  quantity: Int,
) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"0202020202020202020202020202020202020202020202020202020202020202",
      output_index,
    },
    output: escrow_output(channel_id, denom, quantity),
  }
}

fn native_value(quantity: Int) -> Value {
  from_asset(native_policy_id, native_token_name, quantity)
}

fn empty_mint() -> Value {
  from_asset("", "", 0)
}

fn receiver_address(receiver: ByteArray) -> Option<Address> {
  when string_utils.hex_string_to_bytes(receiver) is {
    Some(public_key_hash) -> Some(from_verification_key(public_key_hash))
    None -> None
  }
}

fn payout_output(receiver: ByteArray, quantity: Int) -> Output {
  expect Some(address) = receiver_address(receiver)
  Output {
    address,
    value: native_value(quantity),
    datum: NoDatum,
    reference_script: None,
  }
}

fn receiver_delta(
  inputs: List<Input>,
  outputs: List<Output>,
  receiver: ByteArray,
) -> Option<Int> {
  when receiver_address(receiver) is {
    Some(address) -> {
      let before =
        list.reduce(
          inputs,
          0,
          fn(acc, input) {
            if input.output.address == address {
              acc + quantity_of(
                input.output.value,
                native_policy_id,
                native_token_name,
              )
            } else {
              acc
            }
          },
        )
      let after =
        list.reduce(
          outputs,
          0,
          fn(acc, output) {
            if output.address == address {
              acc + quantity_of(
                output.value,
                native_policy_id,
                native_token_name,
              )
            } else {
              acc
            }
          },
        )

      Some(after - before)
    }
    None -> None
  }
}

fn packet(
  denom: ByteArray,
  sender: ByteArray,
  receiver: ByteArray,
  source_channel: ByteArray,
  destination_channel: ByteArray,
) -> (FungibleTokenPacketData, Packet) {
  let data =
    FungibleTokenPacketData { denom, amount: "20", sender, receiver, memo: "" }
  let packet =
    Packet {
      sequence: 1,
      source_port,
      source_channel,
      destination_port,
      destination_channel,
      data: fungible_token_packet_data.get_bytes(data),
      timeout_height: height_mod.zero_height(),
      timeout_timestamp: 1111,
    }

  (data, packet)
}

fn native_escrow_contract(
  input_quantity: Int,
  output_quantity: Int,
  delta: Int,
  expected_channel_id: ByteArray,
  actual_channel_id: ByteArray,
) -> Bool {
  let denom = native_denom()
  let input = escrow_input(1, actual_channel_id, denom, input_quantity)
  let output = escrow_output(actual_channel_id, denom, output_quantity)
  let expected_datum = escrow_datum(expected_channel_id, denom, input_quantity)
  transfer_escrow.validate_module_escrow_transition(
    input,
    EscrowShard {
      datum: escrow_datum(actual_channel_id, denom, input_quantity),
      updated_output: Some(output),
    },
    [input],
    [output],
    expected_datum,
    shard_policy_id,
    empty_mint(),
    delta,
    native_value(delta),
    native_policy_id |> bytearray.concat(native_token_name),
  )
}

fn native_escrow_principal_contract(
  input_quantity: Int,
  input_principal: Int,
  output_quantity: Int,
  output_principal: Int,
  delta: Int,
) -> Bool {
  let denom = native_denom()
  let input_output =
    escrow_output_with_principal(
      channel_id,
      denom,
      input_quantity,
      input_principal,
    )
  let input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"0303030303030303030303030303030303030303030303030303030303030303",
        output_index: 0,
      },
      output: input_output,
    }
  let output =
    escrow_output_with_principal(
      channel_id,
      denom,
      output_quantity,
      output_principal,
    )
  transfer_escrow.validate_module_escrow_transition(
    input,
    EscrowShard {
      datum: escrow_datum(channel_id, denom, input_principal),
      updated_output: Some(output),
    },
    [input],
    [output],
    escrow_datum(channel_id, denom, input_principal),
    shard_policy_id,
    empty_mint(),
    delta,
    native_value(delta),
    native_policy_id |> bytearray.concat(native_token_name),
  )
}

fn ada_escrow_output(physical_lovelace: Int, escrowed_amount: Int) -> Output {
  let denom = "6c6f76656c616365"
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(channel_id, denom)
  Output {
    address: from_script("transfer-module"),
    value: from_asset(ada_policy_id, ada_asset_name, physical_lovelace)
      |> add(shard_policy_id, shard_token_name, 1),
    datum: InlineDatum(escrow_datum(channel_id, denom, escrowed_amount)),
    reference_script: None,
  }
}

fn ada_escrow_principal_contract(
  input_lovelace: Int,
  input_principal: Int,
  output_lovelace: Int,
  output_principal: Int,
  delta: Int,
) -> Bool {
  let denom = "6c6f76656c616365"
  let input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"0404040404040404040404040404040404040404040404040404040404040404",
        output_index: 0,
      },
      output: ada_escrow_output(input_lovelace, input_principal),
    }
  let output = ada_escrow_output(output_lovelace, output_principal)
  transfer_escrow.validate_module_escrow_transition(
    input,
    EscrowShard {
      datum: escrow_datum(channel_id, denom, input_principal),
      updated_output: Some(output),
    },
    [input],
    [output],
    escrow_datum(channel_id, denom, input_principal),
    shard_policy_id,
    empty_mint(),
    delta,
    from_asset(ada_policy_id, ada_asset_name, delta),
    "lovelace",
  )
}

fn create_native_escrow_contract(
  physical_quantity: Int,
  logical_principal: Int,
) -> Bool {
  let denom = native_denom()
  let input = module_input()
  let updated_module_output = Output { ..input.output, datum: InlineDatum(1) }
  let created_output =
    escrow_output_with_principal(
      channel_id,
      denom,
      physical_quantity,
      logical_principal,
    )
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(channel_id, denom)
  transfer_escrow.validate_module_escrow_transition(
    input,
    transfer_escrow.ModuleState {
      updated_output: updated_module_output,
      datum_changed: True,
    },
    [input],
    [updated_module_output, created_output],
    escrow_datum(channel_id, denom, 0),
    shard_policy_id,
    from_asset(shard_policy_id, shard_token_name, 1),
    amount,
    native_value(amount),
    native_policy_id |> bytearray.concat(native_token_name),
  )
}

fn create_ada_escrow_contract(
  physical_lovelace: Int,
  logical_principal: Int,
) -> Bool {
  let denom = "6c6f76656c616365"
  let input = module_input()
  let updated_module_output = Output { ..input.output, datum: InlineDatum(1) }
  let created_output = ada_escrow_output(physical_lovelace, logical_principal)
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(channel_id, denom)
  transfer_escrow.validate_module_escrow_transition(
    input,
    transfer_escrow.ModuleState {
      updated_output: updated_module_output,
      datum_changed: True,
    },
    [input],
    [updated_module_output, created_output],
    escrow_datum(channel_id, denom, 0),
    shard_policy_id,
    from_asset(shard_policy_id, shard_token_name, 1),
    amount,
    from_asset(ada_policy_id, ada_asset_name, amount),
    "lovelace",
  )
}

fn native_unescrow_contract(
  receiver: ByteArray,
  escrow_quantity: Int,
  remaining_escrow_quantity: Int,
  payout_quantity: Int,
) -> Bool {
  let denom = native_denom()
  let input = escrow_input(1, channel_id, denom, escrow_quantity)
  let output = escrow_output(channel_id, denom, remaining_escrow_quantity)
  let outputs = [output, payout_output(receiver, payout_quantity)]

  expect Some(delta) = receiver_delta([input], outputs, receiver)

  and {
    transfer_escrow.validate_module_escrow_transition(
      input,
      EscrowShard {
        datum: escrow_datum(channel_id, denom, escrow_quantity),
        updated_output: Some(output),
      },
      [input],
      outputs,
      escrow_datum(channel_id, denom, escrow_quantity),
      shard_policy_id,
      empty_mint(),
      0 - amount,
      native_value(amount) |> assets.negate(),
      native_policy_id |> bytearray.concat(native_token_name),
    )?,
    delta == payout_quantity,
    delta == amount,
  }
}

fn voucher_token_name(denom: ByteArray) -> ByteArray {
  voucher_asset_name.voucher_user_token_name(denom)
}

fn exact_voucher_mint(mint: Value, denom: ByteArray, quantity: Int) -> Bool {
  let expected =
    from_asset(voucher_policy_id, voucher_token_name(denom), quantity)
  assets.match_assets(mint, expected)
}

fn voucher_redeemers(redeemer: Redeemer) -> List<Pair<ScriptPurpose, Redeemer>> {
  [Pair(Mint(voucher_policy_id), redeemer)]
}

fn voucher_send_contract(
  mint: Value,
  data: FungibleTokenPacketData,
  packet: Packet,
) -> Bool {
  let redeemer: Redeemer =
    BurnVoucher {
      packet_source_port: packet.source_port,
      packet_source_channel: packet.source_channel,
      data,
      module_token: module_token(),
    }
  let input = module_input()

  and {
    voucher_flow.validate_burn_voucher_packet(
      voucher_redeemers(redeemer),
      voucher_policy_id,
      packet,
    )?,
    exact_voucher_mint(mint, data.denom, 0 - amount)?,
    value_delta.validate_output_amount(input, input.output, assets.zero)?,
  }
}

fn voucher_refund_contract(
  mint: Value,
  data: FungibleTokenPacketData,
  packet: Packet,
) -> Bool {
  let ack = acknowledgement_mod.new_error_acknowledgement("refund")
  let redeemer: Redeemer =
    RefundVoucher {
      packet_source_port: packet.source_port,
      packet_source_channel: packet.source_channel,
      data,
      acknowledgement: Some(ack),
      module_token: module_token(),
    }
  let input = module_input()

  and {
    value_delta.validate_output_amount(input, input.output, assets.zero)?,
    exact_voucher_mint(mint, data.denom, amount)?,
    refund_redeemer_matches(redeemer, packet),
  }
}

fn refund_redeemer_matches(redeemer: Redeemer, packet: Packet) -> Bool {
  expect mint_voucher_redeemer: MintVoucherRedeemer = redeemer
  expect RefundVoucher { packet_source_port, packet_source_channel, .. } =
    mint_voucher_redeemer

  and {
    packet_source_port == packet.source_port,
    packet_source_channel == packet.source_channel,
  }
}

fn recv_sink_contract(
  mint: Value,
  data: FungibleTokenPacketData,
  packet: Packet,
) -> Bool {
  let redeemer: Redeemer =
    MintVoucher {
      packet_source_port: packet.source_port,
      packet_source_channel: packet.source_channel,
      packet_dest_port: packet.destination_port,
      packet_dest_channel: packet.destination_channel,
      data,
      module_token: module_token(),
    }
  let input = module_input()

  and {
    voucher_flow.validate_mint_voucher_packet(
      voucher_redeemers(redeemer),
      voucher_policy_id,
      packet,
    )?,
    exact_voucher_mint(mint, data.denom, amount)?,
    value_delta.validate_output_amount(input, input.output, assets.zero)?,
  }
}

test prop_transfer_native_send_escrow_increases_exactly(_seed via fuzz.int()) {
  // These accounting checks exercise pure transfer helpers. Full validator-level
  // transition coverage lives in validators/spending_transfer_module.test.ak.
  fuzz.label(@"regression.unit.transfer.native_send.escrow_increases_exactly")

  fuzz_dsl.valid_check(
    "transfer",
    "native_send",
    "native_escrow_contract",
    native_escrow_contract(100, 120, amount, channel_id, channel_id),
  )
    |> fuzz_dsl.assert_valid
}

test transfer_creation_sets_exact_native_logical_principal() {
  create_native_escrow_contract(amount, amount)
}

test transfer_creation_rejects_wrong_native_logical_principal() fail {
  create_native_escrow_contract(amount, amount - 1)
}

test transfer_creation_accepts_ada_min_utxo_reserve_above_principal() {
  create_ada_escrow_contract(2_000_000, amount)
}

test transfer_creation_rejects_ada_below_logical_principal() fail {
  create_ada_escrow_contract(amount - 1, amount)
}

test transfer_creation_rejects_wrong_ada_logical_principal() fail {
  create_ada_escrow_contract(2_000_000, amount - 1)
}

test prop_transfer_native_timeout_refunds_exactly(_seed via fuzz.int()) {
  fuzz.label(@"regression.unit.transfer.native_timeout.refund_exactly")

  fuzz_dsl.valid_check(
    "transfer",
    "native_timeout",
    "native_unescrow_contract",
    native_unescrow_contract(valid_cardano_receiver, 100, 80, amount),
  )
    |> fuzz_dsl.assert_valid
}

test prop_transfer_native_ack_has_no_refund(_seed via fuzz.int()) {
  fuzz.label(@"regression.unit.transfer.native_ack.no_refund")

  let input = module_input()
  let outputs = [input.output]

  fuzz_dsl.valid_check("transfer", "native_ack", "native_ack_no_refund", and {
      value_delta.validate_output_amount(input, input.output, assets.zero)?,
      receiver_delta([input], outputs, valid_cardano_receiver) == Some(0),
      voucher_flow.require_no_voucher_mint([], voucher_policy_id),
    })
    |> fuzz_dsl.assert_valid
}

test prop_transfer_voucher_send_burns_exactly(_seed via fuzz.int()) {
  fuzz.label(@"regression.unit.transfer.voucher_send.burns_exactly")

  let (data, packet) =
    packet(
      sink_voucher_denom(),
      valid_cardano_receiver,
      "cosmos1receiver",
      source_channel,
      destination_channel,
    )
  let mint =
    from_asset(voucher_policy_id, voucher_token_name(data.denom), 0 - amount)

  fuzz_dsl.valid_check(
    "transfer",
    "voucher_send",
    "voucher_send_contract",
    voucher_send_contract(mint, data, packet),
  )
    |> fuzz_dsl.assert_valid
}

test prop_transfer_voucher_error_ack_remints_exactly(_seed via fuzz.int()) {
  fuzz.label(@"regression.unit.transfer.voucher_error_ack.remints_exactly")

  let (data, packet) =
    packet(
      sink_voucher_denom(),
      valid_cardano_receiver,
      "cosmos1receiver",
      source_channel,
      destination_channel,
    )
  let mint =
    from_asset(voucher_policy_id, voucher_token_name(data.denom), amount)

  fuzz_dsl.valid_check(
    "transfer",
    "voucher_error_ack",
    "voucher_refund_contract",
    voucher_refund_contract(mint, data, packet),
  )
    |> fuzz_dsl.assert_valid
}

test prop_transfer_recv_source_unescrows_exactly(_seed via fuzz.int()) {
  fuzz.label(@"regression.unit.transfer.recv_source.unescrows_exactly")

  fuzz_dsl.valid_check(
    "transfer",
    "recv_source",
    "native_unescrow_contract",
    native_unescrow_contract(valid_cardano_receiver, 100, 80, amount),
  )
    |> fuzz_dsl.assert_valid
}

test prop_transfer_recv_sink_mints_voucher_exactly(_seed via fuzz.int()) {
  fuzz.label(@"regression.unit.transfer.recv_sink.mints_voucher_exactly")

  let (data, packet) =
    packet(
      sink_voucher_denom(),
      "cosmos1sender",
      valid_cardano_receiver,
      source_channel,
      destination_channel,
    )
  let mint =
    from_asset(voucher_policy_id, voucher_token_name(data.denom), amount)

  fuzz_dsl.valid_check(
    "transfer",
    "recv_sink",
    "recv_sink_contract",
    recv_sink_contract(mint, data, packet),
  )
    |> fuzz_dsl.assert_valid
}

test prop_transfer_rejects_extra_voucher_mint(_seed via fuzz.int()) {
  fuzz.label(@"regression.unit.transfer.invalid_extra_voucher_mint_rejected")

  let (data, packet) =
    packet(
      sink_voucher_denom(),
      "cosmos1sender",
      valid_cardano_receiver,
      source_channel,
      destination_channel,
    )
  let mint =
    from_asset(voucher_policy_id, voucher_token_name(data.denom), amount)
      |> add(voucher_policy_id, "extra-voucher", 1)

  fuzz_dsl.mutated_check(
    "transfer",
    "recv_sink",
    "extra_voucher_mint",
    "recv_sink_contract",
    recv_sink_contract(mint, data, packet),
  )
    |> fuzz_dsl.assert_rejected
}

test prop_transfer_rejects_wrong_escrow_delta(_seed via fuzz.int()) {
  fuzz.label(@"regression.unit.transfer.invalid_wrong_escrow_delta_rejected")

  fuzz_dsl.mutated_check(
    "transfer",
    "native_send",
    "wrong_escrow_delta",
    "native_escrow_contract",
    native_escrow_contract(100, 119, amount, channel_id, channel_id),
  )
    |> fuzz_dsl.assert_rejected
}

test transfer_rejects_wrong_logical_principal_with_correct_native_value_delta() fail {
  native_escrow_principal_contract(100, 100, 120, 119, amount)
}

test transfer_accepts_ada_reserve_above_exact_logical_principal() {
  ada_escrow_principal_contract(2_000_000, 100, 2_000_020, 120, amount)
}

test transfer_rejects_ada_physical_lovelace_below_logical_principal() fail {
  ada_escrow_principal_contract(99, 100, 119, 120, amount)
}

test transfer_rejects_wrong_ada_logical_principal_delta() fail {
  ada_escrow_principal_contract(2_000_000, 100, 2_000_020, 119, amount)
}

test prop_transfer_rejects_wrong_native_refund_amount(_seed via fuzz.int()) {
  fuzz.label(
    @"regression.unit.transfer.invalid_wrong_native_refund_amount_rejected",
  )

  fuzz_dsl.mutated_check(
    "transfer",
    "native_timeout",
    "wrong_native_refund_amount",
    "native_unescrow_contract",
    native_unescrow_contract(valid_cardano_receiver, 100, 81, amount),
  )
    |> fuzz_dsl.assert_rejected
}

test prop_transfer_rejects_wrong_voucher_burn_amount(_seed via fuzz.int()) {
  fuzz.label(
    @"regression.unit.transfer.invalid_wrong_voucher_burn_amount_rejected",
  )

  let (data, packet) =
    packet(
      sink_voucher_denom(),
      valid_cardano_receiver,
      "cosmos1receiver",
      source_channel,
      destination_channel,
    )
  let mint = from_asset(voucher_policy_id, voucher_token_name(data.denom), -19)

  fuzz_dsl.mutated_check(
    "transfer",
    "voucher_send",
    "wrong_voucher_burn_amount",
    "voucher_send_contract",
    voucher_send_contract(mint, data, packet),
  )
    |> fuzz_dsl.assert_rejected
}

test prop_transfer_rejects_wrong_escrow_shard(_seed via fuzz.int()) fail {
  fuzz.label(@"regression.unit.transfer.invalid_wrong_escrow_shard_rejected")

  native_escrow_contract(100, 120, amount, channel_id, "channel-999")
}

test prop_transfer_rejects_invalid_receiver_address(_seed via fuzz.int()) {
  fuzz.label(@"regression.unit.transfer.invalid_receiver_address_rejected")

  fuzz_dsl.mutated_check(
    "transfer",
    "recv_sink",
    "invalid_receiver_address",
    "receiver_address",
    receiver_address("not a hex address") != None,
  )
    |> fuzz_dsl.assert_rejected
}
