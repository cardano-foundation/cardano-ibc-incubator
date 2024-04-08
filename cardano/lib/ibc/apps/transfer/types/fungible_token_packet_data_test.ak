use aiken/list
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData} as ftpd_mod

//=============================validate_basic===============================
fn setup_validate_basic() -> FungibleTokenPacketData {
  FungibleTokenPacketData {
    denom: "ada",
    amount: "10000",
    sender: "cardano public key hash",
    receiver: "cosmos address",
    memo: "",
  }
}

test validate_basic_succeed() {
  let ftpd = setup_validate_basic()

  ftpd_mod.validate_basic(ftpd)
}

test validate_basic_fail_if_amount_is_not_number() {
  let ftpd = setup_validate_basic()
  let ftpd = FungibleTokenPacketData { ..ftpd, amount: "not a number" }

  ftpd_mod.validate_basic(ftpd) == False
}

test validate_basic_fail_if_amount_is_not_greater_than_0() {
  let ftpd = setup_validate_basic()
  let ftpd = FungibleTokenPacketData { ..ftpd, amount: "0" }

  ftpd_mod.validate_basic(ftpd) == False
}

test validate_basic_fail_if_sender_is_empty() {
  let ftpd = setup_validate_basic()
  let ftpd = FungibleTokenPacketData { ..ftpd, sender: "   " }

  ftpd_mod.validate_basic(ftpd) == False
}

test validate_basic_fail_if_receiver_is_empty() {
  let ftpd = setup_validate_basic()
  let ftpd = FungibleTokenPacketData { ..ftpd, receiver: "" }

  ftpd_mod.validate_basic(ftpd) == False
}

test validate_basic_fail_if_denom_is_invalid() {
  let ftpd = setup_validate_basic()
  let ftpd = FungibleTokenPacketData { ..ftpd, denom: "port-1/channel-0/" }

  ftpd_mod.validate_basic(ftpd) == False
}

//=======================================get_bytes==============================
test test_get_bytes() {
  let test_cases =
    [
      (
        FungibleTokenPacketData {
          denom: "transfer/gaiachannel/atom",
          amount: "100",
          sender: "cosmos1xqp8p6zm8rs5dwswp6j59nelhvyxy4j9ls0tk0",
          receiver: "cosmos1w3jhxarpv3j8yvs7f9y7g",
          memo: "",
        },
        #"7b22616d6f756e74223a22313030222c2264656e6f6d223a227472616e736665722f676169616368616e6e656c2f61746f6d222c227265636569766572223a22636f736d6f733177336a687861727076336a38797673376639793767222c2273656e646572223a22636f736d6f73317871703870367a6d387273356477737770366a35396e656c6876797879346a396c7330746b30227d",
      ),
      (
        FungibleTokenPacketData {
          denom: "transfer/gaiachannel/atom",
          amount: "100",
          sender: "cosmos1xqp8p6zm8rs5dwswp6j59nelhvyxy4j9ls0tk0",
          receiver: "cosmos1w3jhxarpv3j8yvs7f9y7g",
          memo: "memo",
        },
        #"7b22616d6f756e74223a22313030222c2264656e6f6d223a227472616e736665722f676169616368616e6e656c2f61746f6d222c226d656d6f223a226d656d6f222c227265636569766572223a22636f736d6f733177336a687861727076336a38797673376639793767222c2273656e646572223a22636f736d6f73317871703870367a6d387273356477737770366a35396e656c6876797879346a396c7330746b30227d",
      ),
      (
        FungibleTokenPacketData {
          denom: "transfer/gaiachannel/atom",
          amount: "18446744073709551616",
          sender: "cosmos1xqp8p6zm8rs5dwswp6j59nelhvyxy4j9ls0tk0",
          receiver: "cosmos1w3jhxarpv3j8yvs7f9y7g",
          memo: "",
        },
        #"7b22616d6f756e74223a223138343436373434303733373039353531363136222c2264656e6f6d223a227472616e736665722f676169616368616e6e656c2f61746f6d222c227265636569766572223a22636f736d6f733177336a687861727076336a38797673376639793767222c2273656e646572223a22636f736d6f73317871703870367a6d387273356477737770366a35396e656c6876797879346a396c7330746b30227d",
      ),
    ]

  list.all(test_cases, fn(tc) { ftpd_mod.get_bytes(tc.1st) == tc.2nd })
}
