use aiken/crypto
use aiken/primitive/bytearray.{concat}
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
  crypto.sha2_256(data)
}

pub fn marshal_json(ack: Acknowledgement) -> ByteArray {
  when ack.response is {
    AcknowledgementResult { result } ->
      #[]
        |> concat("{")
        |> concat(get_json("result", result))
        |> concat("}")
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

test test_marshal_json_result() {
  let ack =
    Acknowledgement {
      response: AcknowledgementResult {
        result: "eyJjb250cmFjdF9yZXN1bHQiOiJleUp6Wlc1MFgyRnRiM1Z1ZENJNklqRXdPRGd3SWl3aVpHVnViMjBpT2lKMWIzTnRieUlzSW1Ob1lXNXVaV3hmYVdRaU9pSmphR0Z1Ym1Wc0xUQWlMQ0p5WldObGFYWmxjaUk2SW1OdmMyMXZjekY1WTJWc05UTmhOV1E1ZUdzNE9YRXpkbVJ5TjNadE9ETTVkREoyZDJ3d09IQnNObnByTmlJc0luQmhZMnRsZEY5elpYRjFaVzVqWlNJNk1YMD0iLCJpYmNfYWNrIjoiZXlKeVpYTjFiSFFpT2lKQlVUMDlJbjA9In0=",
      },
    }
  marshal_json(ack) == #"7b22726573756c74223a2265794a6a62323530636d466a644639795a584e31624851694f694a6c65557036576c63314d466779526e52694d315a315a454e4a4e6b6c71525864505247643353576c3361567048566e56694d6a427054326c4b4d57497a546e526965556c7a5357314f62316c584e5856615633686d5956645261553970536d706852305a31596d31576330785551576c4d51307035576c644f62474659576d786a61556b325357314f646d4d794d585a6a656b593157544a5763303555546d684f563145315a55647a4e4539595258706b62564a35546a4e61644539455454566b52456f795a444a3364303949516e4e4f626e4279546d6c4a63306c75516d685a4d6e52735a455935656c7059526a4661567a5671576c4e4a4e6b31594d4430694c434a70596d4e6659574e72496a6f695a586c4b65567059546a46695346467054326c4b516c56554d446c4a626a4139496e303d227d"
}
