use ibc/core/ics_004/types/acknowledgement.{Acknowledgement}

pub type IBCModulePacketData {
  /// Application-owned payload. Constructor index 0 and its single-field arity
  /// are a stable wire contract; future envelope variants must be appended.
  ModuleDataV1(Data)
  OtherModuleData
}

/// Constructor and record-field order form the callback wire ABI, so append variants instead of reordering them.
pub type IBCModuleCallback {
  OnChanOpenInit { channel_id: ByteArray }
  OnChanOpenTry { channel_id: ByteArray }
  OnChanOpenAck { channel_id: ByteArray }
  OnChanOpenConfirm { channel_id: ByteArray }
  OnChanCloseInit { channel_id: ByteArray }
  OnChanCloseConfirm { channel_id: ByteArray }
  OnRecvPacket {
    channel_id: ByteArray,
    packet_data: ByteArray,
    acknowledgement: Acknowledgement,
    data: IBCModulePacketData,
  }
  OnTimeoutPacket {
    channel_id: ByteArray,
    packet_data: ByteArray,
    data: IBCModulePacketData,
  }
  OnAcknowledgementPacket {
    channel_id: ByteArray,
    packet_data: ByteArray,
    acknowledgement: Acknowledgement,
    data: IBCModulePacketData,
  }
  // Application approval for an outbound packet. The raw packet bytes and
  // packet commitment bind the application effect to the exact IBC packet;
  // `data` carries an opaque payload that the registered application owns,
  // decodes, and binds to `packet_data`.
  OnSendPacket {
    channel_id: ByteArray,
    packet_data: ByteArray,
    packet_commitment: ByteArray,
    data: IBCModulePacketData,
  }
}

pub type IBCModuleOperator {
  /// Application-owned operator. Constructor index 0 and its single-field
  /// arity are a stable wire contract; future variants must be appended.
  ModuleOperatorV1(Data)
  OtherModuleOperator
}

pub type IBCModuleRedeemer {
  Callback(IBCModuleCallback)
  Operator(IBCModuleOperator)
}
