use ibc/apps/transfer/transfer_module_redeemer.{
  Transfer, TransferModuleRedeemer,
}
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/core/ics_005/types/ibc_module_redeemer.{
  ModuleDataV1, ModuleOperatorV1, OtherModuleData, OtherModuleOperator,
}

type LegacyModulePacketData {
  LegacyTransferModuleData(FungibleTokenPacketData)
  LegacyOtherModuleData
}

type LegacyModuleOperator {
  LegacyTransferModuleOperator(TransferModuleRedeemer)
  LegacyOtherModuleOperator
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
