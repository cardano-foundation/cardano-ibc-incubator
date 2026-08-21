use ibc/apps/transfer/transfer_module_redeemer.{
  Transfer, TransferModuleRedeemer,
}
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/core/ics_005/types/ibc_module_redeemer.{
  ModuleDataV1, ModuleOperatorV1, OnChanReclaim, OnHostStateSeal,
  OtherModuleData, OtherModuleOperator,
}

// Plutus Data encodes constructor indices and fields, not source names, so equal shapes prove wire compatibility.
type LegacyModulePacketData {
  LegacyTransferModuleData(FungibleTokenPacketData)
  LegacyOtherModuleData
}

type LegacyModuleOperator {
  LegacyTransferModuleOperator(TransferModuleRedeemer)
  LegacyOtherModuleOperator
}

// Only constructor positions and field shapes affect Plutus Data. The ten
// placeholders reserve the callback indices that existed before reclamation.
type AppendedCallbackShape {
  PriorCallback0
  PriorCallback1
  PriorCallback2
  PriorCallback3
  PriorCallback4
  PriorCallback5
  PriorCallback6
  PriorCallback7
  PriorCallback8
  PriorCallback9
  ExpectedOnChanReclaim {
    channel_id: ByteArray,
    channel_live_escrow_shard_count_siblings: List<ByteArray>,
  }
  ExpectedOnHostStateSeal
}

const packet_data =
  FungibleTokenPacketData {
    denom: "lovelace",
    amount: "1",
    sender: "sender",
    receiver: "receiver",
    memo: "",
  }

test opaque_packet_data_preserves_the_legacy_constructor_shape() {
  let legacy: Data = LegacyTransferModuleData(packet_data)
  let generic: Data = ModuleDataV1(packet_data)

  legacy == generic
}

test no_packet_data_preserves_the_legacy_constructor_shape() {
  let legacy: Data = LegacyOtherModuleData
  let generic: Data = OtherModuleData

  legacy == generic
}

test opaque_operator_preserves_the_legacy_constructor_shape() {
  let operator = Transfer { channel_id: "channel-0", data: packet_data }
  let legacy: Data = LegacyTransferModuleOperator(operator)
  let generic: Data = ModuleOperatorV1(operator)

  legacy == generic
}

test no_operator_preserves_the_legacy_constructor_shape() {
  let legacy: Data = LegacyOtherModuleOperator
  let generic: Data = OtherModuleOperator

  legacy == generic
}

test channel_reclaim_callback_is_appended_at_index_ten() {
  let expected: Data =
    ExpectedOnChanReclaim {
      channel_id: "channel-0",
      channel_live_escrow_shard_count_siblings: [],
    }
  let actual: Data =
    OnChanReclaim {
      channel_id: "channel-0",
      channel_live_escrow_shard_count_siblings: [],
    }

  expected == actual
}

test host_seal_callback_is_appended_after_channel_reclaim() {
  let expected: Data = ExpectedOnHostStateSeal
  let actual: Data = OnHostStateSeal

  expected == actual
}
