use aiken/primitive/bytearray
use ibc/apps/transfer/types/fungible_token_packet_data as packet
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}

fn amount(data: FungibleTokenPacketData) -> Int {
  expect Some(amount) = packet.validated_amount(data)
  amount
}

fn data(amount: ByteArray) -> FungibleTokenPacketData {
  FungibleTokenPacketData {
    denom: "uatom",
    amount,
    sender: "alice",
    receiver: "bob",
    memo: "",
  }
}

test benchmark_one_digit() {
  amount(data("1")) == 1
}

test benchmark_six_digits() {
  amount(data("100000")) == 100000
}

test benchmark_uint64() {
  amount(data("18446744073709551615")) == 18446744073709551615
}

test benchmark_uint256() {
  amount(
    data(
      bytearray.concat(
        "115792089237316195423570985008687907853",
        "269984665640564039457584007913129639935",
      ),
    ),
  ) == 115792089237316195423570985008687907853269984665640564039457584007913129639935
}
