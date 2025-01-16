pub type AcknowledgementResponse {
  AcknowledgementResult { result: ByteArray }
  AcknowledgementError { err: ByteArray }
}
