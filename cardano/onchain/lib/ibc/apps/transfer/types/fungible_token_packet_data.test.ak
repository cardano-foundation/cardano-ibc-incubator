use aiken/primitive/bytearray
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
fn assert_get_bytes(ftpd: FungibleTokenPacketData, expected: ByteArray) -> Bool {
  ftpd_mod.get_bytes(ftpd) == expected
}

fn assert_get_v10_bytes(
  ftpd: FungibleTokenPacketData,
  expected: ByteArray,
) -> Bool {
  ftpd_mod.get_v10_bytes(ftpd) == expected
}

fn assert_get_v8_bytes(
  ftpd: FungibleTokenPacketData,
  expected: ByteArray,
) -> Bool {
  ftpd_mod.get_v8_bytes(ftpd) == expected
}

fn assert_get_ibc_rs_bytes(
  ftpd: FungibleTokenPacketData,
  expected: ByteArray,
) -> Bool {
  ftpd_mod.get_ibc_rs_bytes(ftpd) == expected
}

test test_get_bytes_without_memo() {
  assert_get_bytes(
    FungibleTokenPacketData {
      denom: "transfer/gaiachannel/atom",
      amount: "100",
      sender: "cosmos1xqp8p6zm8rs5dwswp6j59nelhvyxy4j9ls0tk0",
      receiver: "cosmos1w3jhxarpv3j8yvs7f9y7g",
      memo: "",
    },
    "{\"amount\":\"100\",\"denom\":\"transfer/gaiachannel/atom\",\"receiver\":\"cosmos1w3jhxarpv3j8yvs7f9y7g\",\"sender\":\"cosmos1xqp8p6zm8rs5dwswp6j59nelhvyxy4j9ls0tk0\"}",
  )
}

test test_get_bytes_with_memo() {
  assert_get_bytes(
    FungibleTokenPacketData {
      denom: "transfer/gaiachannel/atom",
      amount: "100",
      sender: "cosmos1xqp8p6zm8rs5dwswp6j59nelhvyxy4j9ls0tk0",
      receiver: "cosmos1w3jhxarpv3j8yvs7f9y7g",
      memo: "memo",
    },
    "{\"amount\":\"100\",\"denom\":\"transfer/gaiachannel/atom\",\"memo\":\"memo\",\"receiver\":\"cosmos1w3jhxarpv3j8yvs7f9y7g\",\"sender\":\"cosmos1xqp8p6zm8rs5dwswp6j59nelhvyxy4j9ls0tk0\"}",
  )
}

test test_get_v10_bytes_without_memo() {
  assert_get_v10_bytes(
    FungibleTokenPacketData {
      denom: "transfer/gaiachannel/atom",
      amount: "100",
      sender: "cosmos1xqp8p6zm8rs5dwswp6j59nelhvyxy4j9ls0tk0",
      receiver: "cosmos1w3jhxarpv3j8yvs7f9y7g",
      memo: "",
    },
    "{\"denom\":\"transfer/gaiachannel/atom\",\"amount\":\"100\",\"sender\":\"cosmos1xqp8p6zm8rs5dwswp6j59nelhvyxy4j9ls0tk0\",\"receiver\":\"cosmos1w3jhxarpv3j8yvs7f9y7g\"}",
  )
}

test test_get_v10_bytes_with_memo() {
  assert_get_v10_bytes(
    FungibleTokenPacketData {
      denom: "transfer/gaiachannel/atom",
      amount: "100",
      sender: "cosmos1xqp8p6zm8rs5dwswp6j59nelhvyxy4j9ls0tk0",
      receiver: "cosmos1w3jhxarpv3j8yvs7f9y7g",
      memo: "memo",
    },
    "{\"denom\":\"transfer/gaiachannel/atom\",\"amount\":\"100\",\"sender\":\"cosmos1xqp8p6zm8rs5dwswp6j59nelhvyxy4j9ls0tk0\",\"receiver\":\"cosmos1w3jhxarpv3j8yvs7f9y7g\",\"memo\":\"memo\"}",
  )
}

test test_get_ibc_rs_bytes_includes_empty_memo() {
  assert_get_ibc_rs_bytes(
    FungibleTokenPacketData {
      denom: "uatom",
      amount: "10",
      sender: "cosmos1sender",
      receiver: "cardano-receiver",
      memo: "",
    },
    "{\"denom\":\"uatom\",\"amount\":\"10\",\"sender\":\"cosmos1sender\",\"receiver\":\"cardano-receiver\",\"memo\":\"\"}",
  )
}

test matches_v8_and_v10_classic_wire_bytes() {
  let packet =
    FungibleTokenPacketData {
      denom: "utest",
      amount: "12345",
      sender: "cosmos1sender",
      receiver: "cardano-receiver",
      memo: "",
    }

  and {
    ftpd_mod.matches_bytes(packet, ftpd_mod.get_bytes(packet)),
    ftpd_mod.matches_bytes(packet, ftpd_mod.get_v10_bytes(packet)),
    ftpd_mod.matches_bytes(packet, ftpd_mod.get_ibc_rs_bytes(packet)),
    !ftpd_mod.matches_bytes(packet, "different packet data"),
  }
}

test test_get_bytes_with_large_amount() {
  assert_get_bytes(
    FungibleTokenPacketData {
      denom: "transfer/gaiachannel/atom",
      amount: "18446744073709551616",
      sender: "cosmos1xqp8p6zm8rs5dwswp6j59nelhvyxy4j9ls0tk0",
      receiver: "cosmos1w3jhxarpv3j8yvs7f9y7g",
      memo: "",
    },
    "{\"amount\":\"18446744073709551616\",\"denom\":\"transfer/gaiachannel/atom\",\"receiver\":\"cosmos1w3jhxarpv3j8yvs7f9y7g\",\"sender\":\"cosmos1xqp8p6zm8rs5dwswp6j59nelhvyxy4j9ls0tk0\"}",
  )
}

test test_get_bytes_with_forwarding_memo() {
  assert_get_bytes(
    FungibleTokenPacketData {
      denom: #"39666333336136666661613864316636303063313631616133383337333964356166333738303765643833333437636331333335323163393664366636333662",
      amount: "100",
      sender: #"3234373537306238626137646337323565396666333765393735376238313438623464356131323539353865646163326664343431376238",
      receiver: "cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6",
      memo: "{\"forward\":{\"receiver\":\"osmo12smx2wdlyttvyzvzg54y2vnqwq2qjateuf7thj\",\"port\": \"transfer\",\"channel\":\"channel-0\"}}",
    },
    #"7b22616d6f756e74223a22313030222c2264656e6f6d223a2239666333336136666661613864316636303063313631616133383337333964356166333738303765643833333437636331333335323163393664366636333662222c226d656d6f223a227b5c22666f72776172645c223a7b5c2272656365697665725c223a5c226f736d6f3132736d783277646c79747476797a767a6735347932766e71777132716a61746575663774686a5c222c5c22706f72745c223a205c227472616e736665725c222c5c226368616e6e656c5c223a5c226368616e6e656c2d305c227d7d222c227265636569766572223a22636f736d6f73317963656c353361356439786b3839713376647237766d383339743276776c3038706c367a6b36222c2273656e646572223a223234373537306238626137646337323565396666333765393735376238313438623464356131323539353865646163326664343431376238227d",
  )
}

test cardano_serializer_rejects_empty_denom() fail {
  let packet = setup_validate_basic()
  ftpd_mod.get_bytes(FungibleTokenPacketData { ..packet, denom: "" }) == ""
}

test v8_serializer_rejects_empty_amount() fail {
  let packet = setup_validate_basic()
  ftpd_mod.get_v8_bytes(FungibleTokenPacketData { ..packet, amount: "" }) == ""
}

test v10_serializer_rejects_empty_sender() fail {
  let packet = setup_validate_basic()
  ftpd_mod.get_v10_bytes(FungibleTokenPacketData { ..packet, sender: "" }) == ""
}

test serializer_rejects_empty_receiver() fail {
  let packet = setup_validate_basic()
  ftpd_mod.get_bytes(FungibleTokenPacketData { ..packet, receiver: "" }) == ""
}

test matches_bytes_rejects_each_empty_required_field() {
  let packet =
    FungibleTokenPacketData {
      denom: "d",
      amount: "1",
      sender: "s",
      receiver: "r",
      memo: "",
    }

  and {
    !ftpd_mod.matches_bytes(
      FungibleTokenPacketData { ..packet, denom: "" },
      "{\"amount\":\"1\",\"receiver\":\"r\",\"sender\":\"s\"}",
    ),
    !ftpd_mod.matches_bytes(
      FungibleTokenPacketData { ..packet, amount: "" },
      "{\"denom\":\"d\",\"receiver\":\"r\",\"sender\":\"s\"}",
    ),
    !ftpd_mod.matches_bytes(
      FungibleTokenPacketData { ..packet, sender: "" },
      "{\"amount\":\"1\",\"denom\":\"d\",\"receiver\":\"r\"}",
    ),
    !ftpd_mod.matches_bytes(
      FungibleTokenPacketData { ..packet, receiver: "" },
      "{\"amount\":\"1\",\"denom\":\"d\",\"sender\":\"s\"}",
    ),
  }
}

test all_profiles_escape_quotes_backslashes_and_controls_in_every_field() {
  let packet =
    FungibleTokenPacketData {
      amount: #"3109",
      denom: #"64225c0a",
      memo: #"6d0d0001",
      receiver: #"720c",
      sender: #"7308",
    }
  let sorted =
    #"7b22616d6f756e74223a22315c74222c2264656e6f6d223a22645c225c5c5c6e222c226d656d6f223a226d5c725c75303030305c7530303031222c227265636569766572223a22725c66222c2273656e646572223a22735c62227d"
  let struct_order =
    #"7b2264656e6f6d223a22645c225c5c5c6e222c22616d6f756e74223a22315c74222c2273656e646572223a22735c62222c227265636569766572223a22725c66222c226d656d6f223a226d5c725c75303030305c7530303031227d"

  and {
    assert_get_bytes(packet, sorted),
    assert_get_v8_bytes(packet, sorted),
    assert_get_v10_bytes(packet, struct_order),
  }
}

test all_control_characters_use_canonical_lowercase_escapes() {
  let packet =
    FungibleTokenPacketData {
      amount: "1",
      denom: "d",
      memo: #"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      receiver: "r",
      sender: "s",
    }
  let expected =
    #"7b22616d6f756e74223a2231222c2264656e6f6d223a2264222c226d656d6f223a225c75303030305c75303030315c75303030325c75303030335c75303030345c75303030355c75303030365c75303030375c625c745c6e5c75303030625c665c725c75303030655c75303030665c75303031305c75303031315c75303031325c75303031335c75303031345c75303031355c75303031365c75303031375c75303031385c75303031395c75303031615c75303031625c75303031635c75303031645c75303031655c7530303166222c227265636569766572223a2272222c2273656e646572223a2273227d"

  and {
    assert_get_bytes(packet, expected),
    assert_get_v8_bytes(packet, expected),
  }
}

test ibc_rs_uses_uppercase_hex_for_long_control_escapes() {
  let packet =
    FungibleTokenPacketData {
      amount: "1",
      denom: "d",
      memo: #"0b0e1f",
      receiver: "r",
      sender: "s",
    }
  let expected =
    "{\"denom\":\"d\",\"amount\":\"1\",\"sender\":\"s\",\"receiver\":\"r\",\"memo\":\"\\u000B\\u000E\\u001F\"}"

  and {
    assert_get_ibc_rs_bytes(packet, expected),
    ftpd_mod.matches_bytes(packet, expected),
  }
}

test javascript_and_go_profiles_handle_unicode_and_html_differently() {
  let packet =
    FungibleTokenPacketData {
      amount: "1",
      denom: #"e99baa",
      memo: #"3c3e26e280a8e280a9e29883",
      receiver: #"72c3a963657074657572",
      sender: #"e58f91e98081e88085",
    }
  let javascript_sorted =
    #"7b22616d6f756e74223a2231222c2264656e6f6d223a22e99baa222c226d656d6f223a223c3e26e280a8e280a9e29883222c227265636569766572223a2272c3a963657074657572222c2273656e646572223a22e58f91e98081e88085227d"
  let go_sorted =
    #"7b22616d6f756e74223a2231222c2264656e6f6d223a22e99baa222c226d656d6f223a225c75303033635c75303033655c75303032365c75323032385c7532303239e29883222c227265636569766572223a2272c3a963657074657572222c2273656e646572223a22e58f91e98081e88085227d"
  let go_struct_order =
    #"7b2264656e6f6d223a22e99baa222c22616d6f756e74223a2231222c2273656e646572223a22e58f91e98081e88085222c227265636569766572223a2272c3a963657074657572222c226d656d6f223a225c75303033635c75303033655c75303032365c75323032385c7532303239e29883227d"
  let ibc_rs_struct_order =
    #"7b2264656e6f6d223a22e99baa222c22616d6f756e74223a2231222c2273656e646572223a22e58f91e98081e88085222c227265636569766572223a2272c3a963657074657572222c226d656d6f223a223c3e26e280a8e280a9e29883227d"

  and {
    assert_get_bytes(packet, javascript_sorted),
    assert_get_v8_bytes(packet, go_sorted),
    assert_get_v10_bytes(packet, go_struct_order),
    assert_get_ibc_rs_bytes(packet, ibc_rs_struct_order),
    ftpd_mod.matches_bytes(packet, javascript_sorted),
    ftpd_mod.matches_bytes(packet, go_sorted),
    ftpd_mod.matches_bytes(packet, go_struct_order),
    ftpd_mod.matches_bytes(packet, ibc_rs_struct_order),
  }
}

test nearby_unicode_is_not_mistaken_for_a_go_line_separator() {
  // U+2014 shares the E2 80 prefix with U+2028/U+2029, but Go leaves it raw.
  let packet =
    FungibleTokenPacketData {
      amount: "1",
      denom: "d",
      memo: #"e28094",
      receiver: "r",
      sender: "s",
    }
  let sorted =
    "{\"amount\":\"1\",\"denom\":\"d\",\"memo\":\""
      |> bytearray.concat(#"e28094")
      |> bytearray.concat("\",\"receiver\":\"r\",\"sender\":\"s\"}")
  let struct_order =
    "{\"denom\":\"d\",\"amount\":\"1\",\"sender\":\"s\",\"receiver\":\"r\",\"memo\":\""
      |> bytearray.concat(#"e28094")
      |> bytearray.concat("\"}")

  and {
    ftpd_mod.get_bytes(packet) == sorted,
    ftpd_mod.get_v8_bytes(packet) == sorted,
    ftpd_mod.get_v10_bytes(packet) == struct_order,
    ftpd_mod.get_ibc_rs_bytes(packet) == struct_order,
    ftpd_mod.matches_bytes(packet, sorted),
    ftpd_mod.matches_bytes(packet, struct_order),
  }
}

test matches_bytes_rejects_noncanonical_json_forms() {
  let packet =
    FungibleTokenPacketData {
      amount: "1",
      denom: "d",
      memo: "m",
      receiver: "r",
      sender: "s",
    }

  and {
    !ftpd_mod.matches_bytes(
      packet,
      "{\"denom\":\"d\",\"amount\":\"1\",\"receiver\":\"r\",\"sender\":\"s\",\"memo\":\"m\"}",
    ),
    !ftpd_mod.matches_bytes(packet, "{\"amount\":\"1\""),
    !ftpd_mod.matches_bytes(
      packet,
      "{\"amount\":\"1\",\"amount\":\"1\",\"denom\":\"d\",\"memo\":\"m\",\"receiver\":\"r\",\"sender\":\"s\"}",
    ),
    !ftpd_mod.matches_bytes(
      packet,
      "{\"amount\":\"1\",\"denom\":\"d\",\"memo\":\"m\",\"receiver\":\"r\",\"sender\":\"s\",\"unknown\":\"x\"}",
    ),
    !ftpd_mod.matches_bytes(
      packet,
      "{\"amount\":1,\"denom\":\"d\",\"memo\":\"m\",\"receiver\":\"r\",\"sender\":\"s\"}",
    ),
    !ftpd_mod.matches_bytes(
      packet,
      "{\"amount\":\"1\",\"denom\":\"d\",\"memo\":\"m\",\"receiver\":\"r\",\"sender\":\"s\"}null",
    ),
    !ftpd_mod.matches_bytes(
      packet,
      "{ \"amount\": \"1\", \"denom\": \"d\", \"memo\": \"m\", \"receiver\": \"r\", \"sender\": \"s\" }",
    ),
  }
}

test escaped_delimiters_cannot_impersonate_another_packet() {
  let canonical =
    FungibleTokenPacketData {
      amount: "1",
      denom: "d",
      memo: "m",
      receiver: "r",
      sender: "s",
    }
  let injected =
    FungibleTokenPacketData {
      ..canonical,
      denom: #"64222c226d656d6f223a226d",
      memo: "",
    }
  let authenticated = ftpd_mod.get_bytes(canonical)

  and {
    ftpd_mod.get_bytes(injected) != authenticated,
    ftpd_mod.get_v8_bytes(injected) != authenticated,
    ftpd_mod.get_v10_bytes(injected) != authenticated,
    ftpd_mod.get_ibc_rs_bytes(injected) != authenticated,
    !ftpd_mod.matches_bytes(injected, authenticated),
  }
}

fn repeated_byte(byte: Int, count: Int) -> ByteArray {
  if count <= 0 {
    #""
  } else {
    repeated_byte(byte, count - 1) |> bytearray.push(byte)
  }
}

fn packet_at_field_limits() -> FungibleTokenPacketData {
  FungibleTokenPacketData {
    denom: repeated_byte(100, ftpd_mod.max_denom_bytes),
    amount: repeated_byte(49, ftpd_mod.max_amount_bytes),
    sender: repeated_byte(115, ftpd_mod.max_sender_bytes),
    receiver: repeated_byte(114, ftpd_mod.max_receiver_bytes),
    memo: repeated_byte(109, ftpd_mod.max_memo_bytes),
  }
}

test field_limits_accept_the_boundary_and_reject_one_more_byte() {
  let at_limit = packet_at_field_limits()

  and {
    ftpd_mod.fields_within_limits(at_limit),
    !ftpd_mod.fields_within_limits(
      FungibleTokenPacketData {
        ..at_limit,
        denom: repeated_byte(100, ftpd_mod.max_denom_bytes + 1),
      },
    ),
    !ftpd_mod.fields_within_limits(
      FungibleTokenPacketData {
        ..at_limit,
        amount: repeated_byte(49, ftpd_mod.max_amount_bytes + 1),
      },
    ),
    !ftpd_mod.fields_within_limits(
      FungibleTokenPacketData {
        ..at_limit,
        sender: repeated_byte(115, ftpd_mod.max_sender_bytes + 1),
      },
    ),
    !ftpd_mod.fields_within_limits(
      FungibleTokenPacketData {
        ..at_limit,
        receiver: repeated_byte(114, ftpd_mod.max_receiver_bytes + 1),
      },
    ),
    !ftpd_mod.fields_within_limits(
      FungibleTokenPacketData {
        ..at_limit,
        memo: repeated_byte(109, ftpd_mod.max_memo_bytes + 1),
      },
    ),
  }
}

test production_matcher_rejects_each_field_over_its_limit() {
  let packet =
    FungibleTokenPacketData {
      denom: "d",
      amount: "1",
      sender: "s",
      receiver: "r",
      memo: "",
    }

  and {
    !ftpd_mod.matches_bytes(
      FungibleTokenPacketData {
        ..packet,
        denom: repeated_byte(100, ftpd_mod.max_denom_bytes + 1),
      },
      "{}",
    ),
    !ftpd_mod.matches_bytes(
      FungibleTokenPacketData {
        ..packet,
        amount: repeated_byte(49, ftpd_mod.max_amount_bytes + 1),
      },
      "{}",
    ),
    !ftpd_mod.matches_bytes(
      FungibleTokenPacketData {
        ..packet,
        sender: repeated_byte(115, ftpd_mod.max_sender_bytes + 1),
      },
      "{}",
    ),
    !ftpd_mod.matches_bytes(
      FungibleTokenPacketData {
        ..packet,
        receiver: repeated_byte(114, ftpd_mod.max_receiver_bytes + 1),
      },
      "{}",
    ),
  }
}

test aggregate_field_limits_reject_before_serialization() {
  !ftpd_mod.matches_bytes(packet_at_field_limits(), "{}")
}

test serializers_reject_aggregate_field_limits() fail {
  ftpd_mod.get_v10_bytes(packet_at_field_limits()) == ""
}

fn packet_at_encoded_size(sender_bytes: Int) -> FungibleTokenPacketData {
  FungibleTokenPacketData {
    amount: "1",
    denom: repeated_byte(100, 256),
    memo: repeated_byte(109, 100),
    receiver: repeated_byte(114, 50),
    sender: repeated_byte(115, sender_bytes),
  }
}

test packet_limit_accepts_exactly_512_encoded_bytes() {
  let packet = packet_at_encoded_size(45)
  let cardano_bytes = ftpd_mod.get_bytes(packet)
  let v8_bytes = ftpd_mod.get_v8_bytes(packet)
  let v10_bytes = ftpd_mod.get_v10_bytes(packet)
  let ibc_rs_bytes = ftpd_mod.get_ibc_rs_bytes(packet)

  and {
    bytearray.length(cardano_bytes) == ftpd_mod.max_packet_bytes,
    bytearray.length(v8_bytes) == ftpd_mod.max_packet_bytes,
    bytearray.length(v10_bytes) == ftpd_mod.max_packet_bytes,
    bytearray.length(ibc_rs_bytes) == ftpd_mod.max_packet_bytes,
    ftpd_mod.matches_bytes(packet, cardano_bytes),
    ftpd_mod.matches_bytes(packet, v8_bytes),
    ftpd_mod.matches_bytes(packet, v10_bytes),
    ftpd_mod.matches_bytes(packet, ibc_rs_bytes),
  }
}

test packet_limit_rejects_authenticated_data_over_512_bytes() {
  !ftpd_mod.matches_bytes(
    packet_at_encoded_size(46),
    repeated_byte(120, ftpd_mod.max_packet_bytes + 1),
  )
}

const ten_raw_less_than = #"3c3c3c3c3c3c3c3c3c3c"

const four_raw_less_than = #"3c3c3c3c"

const ten_go_escaped_less_than =
  #"5c75303033635c75303033635c75303033635c75303033635c75303033635c75303033635c75303033635c75303033635c75303033635c7530303363"

const four_go_escaped_less_than =
  #"5c75303033635c75303033635c75303033635c7530303363"

fn repeat_chunk(chunk: ByteArray, count: Int) -> ByteArray {
  if count <= 0 {
    #""
  } else {
    repeat_chunk(chunk, count - 1) |> bytearray.concat(chunk)
  }
}

fn dense_go_escaped_packet(memo: ByteArray) -> FungibleTokenPacketData {
  FungibleTokenPacketData {
    denom: "d",
    amount: "1",
    sender: "s",
    receiver: "r",
    memo,
  }
}

fn v10_bytes_with_encoded_memo(encoded_memo: ByteArray) -> ByteArray {
  "{\"denom\":\"d\",\"amount\":\"1\",\"sender\":\"s\",\"receiver\":\"r\",\"memo\":\""
    |> bytearray.concat(encoded_memo)
    |> bytearray.concat("\"}")
}

fn v8_bytes_with_encoded_memo(encoded_memo: ByteArray) -> ByteArray {
  "{\"amount\":\"1\",\"denom\":\"d\",\"memo\":\""
    |> bytearray.concat(encoded_memo)
    |> bytearray.concat("\",\"receiver\":\"r\",\"sender\":\"s\"}")
}

test dense_go_escaped_512_byte_packet_matches() {
  let memo =
    "aaaa"
      |> bytearray.concat(repeat_chunk(ten_raw_less_than, 7))
      |> bytearray.concat(four_raw_less_than)
  let encoded_memo =
    "aaaa"
      |> bytearray.concat(repeat_chunk(ten_go_escaped_less_than, 7))
      |> bytearray.concat(four_go_escaped_less_than)
  let encoded = v10_bytes_with_encoded_memo(encoded_memo)

  and {
    bytearray.length(encoded) == 512,
    ftpd_mod.matches_bytes(dense_go_escaped_packet(memo), encoded),
  }
}

test dense_v8_sorted_go_escaped_512_byte_packet_matches() {
  let memo =
    "aaaa"
      |> bytearray.concat(repeat_chunk(ten_raw_less_than, 7))
      |> bytearray.concat(four_raw_less_than)
  let encoded_memo =
    "aaaa"
      |> bytearray.concat(repeat_chunk(ten_go_escaped_less_than, 7))
      |> bytearray.concat(four_go_escaped_less_than)
  let encoded = v8_bytes_with_encoded_memo(encoded_memo)

  and {
    bytearray.length(encoded) == 512,
    ftpd_mod.matches_bytes(dense_go_escaped_packet(memo), encoded),
  }
}

fn maximum_escape_packet(memo: ByteArray) -> FungibleTokenPacketData {
  FungibleTokenPacketData {
    denom: "ibc/usdt",
    amount: "100",
    sender: "cosmos sender address",
    receiver: "525f6e2b0f8a15a3c95d82c8113b99dfebfe40f124cb2bc71ee99e22",
    memo,
  }
}

test maximum_v10_control_escape_packet_matches() {
  let memo =
    #"0b61616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161"
  let encoded =
    #"7b2264656e6f6d223a226962632f75736474222c22616d6f756e74223a22313030222c2273656e646572223a22636f736d6f732073656e6465722061646472657373222c227265636569766572223a223532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232222c226d656d6f223a225c753030306261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161227d"

  and {
    bytearray.length(encoded) == ftpd_mod.max_packet_bytes,
    ftpd_mod.matches_bytes(maximum_escape_packet(memo), encoded),
  }
}

test maximum_v8_html_escape_packet_matches() {
  let memo =
    #"3c61616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161"
  let encoded =
    #"7b22616d6f756e74223a22313030222c2264656e6f6d223a226962632f75736474222c226d656d6f223a225c753030336361616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c227265636569766572223a223532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232222c2273656e646572223a22636f736d6f732073656e6465722061646472657373227d"

  and {
    bytearray.length(encoded) == ftpd_mod.max_packet_bytes,
    ftpd_mod.matches_bytes(maximum_escape_packet(memo), encoded),
  }
}

test go_escape_expansion_rejects_at_bounded_cost() fail {
  // The raw fields fit the minimum 512-byte JSON bound, but Go would expand
  // the memo to well over the packet limit. Escaping stops at the limit.
  let memo =
    repeat_chunk(ten_raw_less_than, 44)
      |> bytearray.concat(four_raw_less_than)
      |> bytearray.concat(four_raw_less_than)
  let authenticated = v10_bytes_with_encoded_memo("x")

  ftpd_mod.matches_bytes(dense_go_escaped_packet(memo), authenticated)
}

test distributed_escape_expansion_rejects_at_bounded_cost() fail {
  // The raw fields and JSON punctuation total exactly 512 bytes. Controls are
  // spread across fields so each field fits alone, but their combined escaped
  // form does not. Cumulative checks stop before constructing the full output.
  let eighty_five_controls = repeated_byte(0, 85)
  let seventy_eight_controls = repeated_byte(0, 78)
  let memo = repeated_byte(0, 78) |> bytearray.concat(repeated_byte(97, 41))
  let packet =
    FungibleTokenPacketData {
      denom: eighty_five_controls,
      amount: seventy_eight_controls,
      sender: eighty_five_controls,
      receiver: eighty_five_controls,
      memo,
    }

  ftpd_mod.matches_bytes(packet, "{}")
}

test serializers_reject_output_over_512_bytes() fail {
  ftpd_mod.get_bytes(packet_at_encoded_size(46)) == ""
}

fn packet_with_invalid_memo(memo: ByteArray) -> FungibleTokenPacketData {
  FungibleTokenPacketData {
    amount: "1",
    denom: "d",
    sender: "s",
    receiver: "r",
    memo,
  }
}

test rejects_isolated_utf8_continuation_byte() fail {
  ftpd_mod.get_bytes(packet_with_invalid_memo(#"80")) == ""
}

test rejects_truncated_utf8_sequence() fail {
  ftpd_mod.get_v8_bytes(packet_with_invalid_memo(#"e280")) == ""
}

test rejects_overlong_utf8_sequence() fail {
  ftpd_mod.get_v10_bytes(packet_with_invalid_memo(#"c0af")) == ""
}

test matches_bytes_rejects_utf8_surrogate() fail {
  ftpd_mod.matches_bytes(packet_with_invalid_memo(#"eda080"), "{}")
}

test matches_bytes_rejects_invalid_authenticated_utf8() fail {
  let malformed =
    "{\"amount\":\"1\",\"denom\":\"d\",\"memo\":\""
      |> bytearray.concat(#"80")
      |> bytearray.concat("\",\"receiver\":\"r\",\"sender\":\"s\"}")
  ftpd_mod.matches_bytes(packet_with_invalid_memo("m"), malformed)
}

test every_field_is_utf8_checked_denom() fail {
  let packet = packet_with_invalid_memo("")
  ftpd_mod.get_bytes(FungibleTokenPacketData { ..packet, denom: #"80" }) == ""
}

test every_field_is_utf8_checked_amount() fail {
  let packet = packet_with_invalid_memo("")
  ftpd_mod.get_bytes(FungibleTokenPacketData { ..packet, amount: #"80" }) == ""
}

test every_field_is_utf8_checked_sender() fail {
  let packet = packet_with_invalid_memo("")
  ftpd_mod.get_bytes(FungibleTokenPacketData { ..packet, sender: #"80" }) == ""
}

test every_field_is_utf8_checked_receiver() fail {
  let packet = packet_with_invalid_memo("")
  ftpd_mod.get_bytes(FungibleTokenPacketData { ..packet, receiver: #"80" }) == ""
}
