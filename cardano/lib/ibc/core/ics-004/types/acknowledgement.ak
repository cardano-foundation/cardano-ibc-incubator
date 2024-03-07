use ibc/core/ics_004/types/acknowledgement_response.{
  AcknowledgementResponse, AcknowledgementResult,
}

pub type Acknowledgement {
  response: AcknowledgementResponse,
}

pub fn new_result_acknowledgement(result: ByteArray) -> Acknowledgement {
  Acknowledgement { response: AcknowledgementResult { result } }
}

pub fn acknowledgement(_ack: Acknowledgement) -> ByteArray {
  #"08F7557ED51826FE18D84512BF24EC75001EDBAF2123A477DF72A0A9F3640A7C"
}
