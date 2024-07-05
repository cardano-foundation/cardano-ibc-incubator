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
      (
        FungibleTokenPacketData {
          denom: #"39666333336136666661613864316636303063313631616133383337333964356166333738303765643833333437636331333335323163393664366636333662",
          amount: "100",
          sender: #"3234373537306238626137646337323565396666333765393735376238313438623464356131323539353865646163326664343431376238",
          receiver: "cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6",
          memo: "{\"forward\":{\"receiver\":\"osmo12smx2wdlyttvyzvzg54y2vnqwq2qjateuf7thj\",\"port\": \"transfer\",\"channel\":\"channel-0\"}}",
        },
        #"7b22616d6f756e74223a22313030222c2264656e6f6d223a2239666333336136666661613864316636303063313631616133383337333964356166333738303765643833333437636331333335323163393664366636333662222c226d656d6f223a227b5c22666f72776172645c223a7b5c2272656365697665725c223a5c226f736d6f3132736d783277646c79747476797a767a6735347932766e71777132716a61746575663774686a5c222c5c22706f72745c223a205c227472616e736665725c222c5c226368616e6e656c5c223a5c226368616e6e656c2d305c227d7d222c227265636569766572223a22636f736d6f73317963656c353361356439786b3839713376647237766d383339743276776c3038706c367a6b36222c2273656e646572223a223234373537306238626137646337323565396666333765393735376238313438623464356131323539353865646163326664343431376238227d",
      ),
    ]

  list.all(test_cases, fn(tc) { ftpd_mod.get_bytes(tc.1st) == tc.2nd })
}
