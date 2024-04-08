use aiken/bytearray.{concat}
use aiken/hash
use ibc/core/ics_004/types/acknowledgement_response.{
  AcknowledgementError, AcknowledgementResponse, AcknowledgementResult,
}

pub type Acknowledgement {
  response: AcknowledgementResponse,
}

pub fn new_result_acknowledgement(result: ByteArray) -> Acknowledgement {
  Acknowledgement { response: AcknowledgementResult { result } }
}

pub fn new_error_acknowledgement(err: ByteArray) -> Acknowledgement {
  Acknowledgement { response: AcknowledgementError { err } }
}

pub fn acknowledgement(ack: Acknowledgement) -> ByteArray {
  marshal_json(ack)
}

pub fn commit_acknowledgement(data: ByteArray) -> ByteArray {
  hash.sha2_256(data)
}

pub fn marshal_json(ack: Acknowledgement) -> ByteArray {
  when ack.response is {
    AcknowledgementResult { .. } -> #"7b22726573756c74223a2241513d3d227d"
    AcknowledgementError { err } ->
      #[]
        |> concat("{")
        |> concat(get_json("error", err))
        |> concat("}")
  }
}

pub fn get_json(key: ByteArray, value: ByteArray) -> ByteArray {
  #[]
    |> concat("\"")
    |> concat(key)
    |> concat("\"")
    |> concat(":")
    |> concat("\"")
    |> concat(value)
    |> concat("\"")
}

test test_marshal_json_error() {
  let ack = Acknowledgement { response: AcknowledgementError { err: "error" } }
  marshal_json(ack) == #"7b226572726f72223a226572726f72227d"
}
