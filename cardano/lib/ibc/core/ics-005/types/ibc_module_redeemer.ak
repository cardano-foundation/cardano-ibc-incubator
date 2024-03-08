use ibc/core/ics_004/types/acknowledgement.{Acknowledgement}

pub type IBCModuleCallback {
  OnChanOpenInit { channel_id: ByteArray }
  OnChanOpenTry { channel_id: ByteArray }
  OnChanOpenAck { channel_id: ByteArray }
  OnChanOpenConfirm { channel_id: ByteArray }
  OnRecvPacket { channel_id: ByteArray, acknowledgement: Acknowledgement }
}

pub type IBCModuleRedeemer {
  Callback(IBCModuleCallback)
  Operator(Data)
}
