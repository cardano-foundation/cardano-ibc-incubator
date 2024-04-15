use ibc/apps/transfer/transfer_module_redeemer.{TransferModuleRedeemer}
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/core/ics_004/types/acknowledgement.{Acknowledgement}

pub type IBCModulePacketData {
  TransferModuleData(FungibleTokenPacketData)
  OtherModuleData
}

pub type IBCModuleCallback {
  OnChanOpenInit { channel_id: ByteArray }
  OnChanOpenTry { channel_id: ByteArray }
  OnChanOpenAck { channel_id: ByteArray }
  OnChanOpenConfirm { channel_id: ByteArray }
  OnRecvPacket {
    channel_id: ByteArray,
    acknowledgement: Acknowledgement,
    data: IBCModulePacketData,
  }
  OnTimeoutPacket { channel_id: ByteArray, data: IBCModulePacketData }
  OnAcknowledgementPacket {
    channel_id: ByteArray,
    acknowledgement: Acknowledgement,
    data: IBCModulePacketData,
  }
}

pub type IBCModuleOperator {
  TransferModuleOperator(TransferModuleRedeemer)
  OtherModuleOperator
}

pub type IBCModuleRedeemer {
  Callback(IBCModuleCallback)
  Operator(IBCModuleOperator)
}
