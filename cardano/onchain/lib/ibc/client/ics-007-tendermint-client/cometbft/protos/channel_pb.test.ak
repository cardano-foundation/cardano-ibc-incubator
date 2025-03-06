use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb.{
  Channel, Counterparty, NONE, UNINITIALIZED, marshal_for_channel,
  marshal_for_counterparty,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb_deprecated.{
  marshal_for_channel as marshal_for_channel_deprecated,
  marshal_for_counterparty as marshal_for_counterparty_deprecated,
  size_for_channel as size_for_channel_deprecated,
  size_for_counterparty as size_for_counterparty_deprecated,
}

const counterparty_empty = Counterparty(#"", #"")

const counterparty =
  Counterparty(#"1202120022021a00", #"abba1202120022021a00abba")

const counterparty_large =
  Counterparty(
    #"a282f1d7db456bc3b5a4d2c412d4e0d573f7512e09052e19b380fc0336b7ff359bad1d1d448090692463a8757059af5649dd7f97e60e97043e7fbc00a93ea7880d9c4d91781fd7afc1c9dccb7e4b9a7a07c60da39a2a68678c7cd634e58c6ece9cfa9f5a6746f8d6fb1614589add9385e3e11afa56eebb7b402511f19f21745051384bace2bc656f57f5b81be526f10e9f9b1e3f6cf29dc64b5b0832823fdc8b31bc7e19bfaf48ce533754aaf1721a535cd1a0409f5654c0d4fc6422d3510b927a26305ebdf960a3f455caba3b680744e6b0250cb47f3a81949fc3c20defc366a8a8b85e3f6b4639c9dff3fadf857ba403ce5727a133e3be2ff71156e0c2c72fecf5a4b940a3fb2500273bfa0bae89371508fde3864f8a527244aa0beca21b4def352752ebcb0949396b7a1b42c15ef3176fedac0bc13962efcc8c8a31c938363d7b65ce18e704e8a185c4bb699facca16182cc1ea2fe4e85754daacb8517a218eec3b1d9d8ac81789ae7878cca4e95c72e7a55f6170a1adc073e43f891cc3d1b01051a32eceafaf738eddecdcfdff5a70bbd369b5f9e0d93f5749bc761e6be1958082483479451e24eb0306e69616a3cf95a444073bf1b2c59d2c9a4b41a1e1408a0dc82ac52c8411e290ef8ec677fbd9e48fbb8277e68fc777d7c68ed826f6c8f3456c91a4385979d4105a65f0ccd043c8e9d7b26935ad47818e48181a6f2a4fc7515d2555637fbe2db68b0352477f1a002f3b33869d8a2d1106bad2dd4ddf8b1f7c54904d507dbf89bf7fdd01c267946d496bf13c9dbc33de67538eb5a33bf528409cc43784dfaf7b9680b11e31b9ca716ed5f979b371368014e76756a962d3e5385690d8cb75a381e93e79cae8f985efa3c7a53c3b579df669a29907fd882ac7aafc9bbf834dd82578c4be8df683f8eb9cfcfb895166cd1ea198bfb8bd66958607f3b2715335f44b79d99e7e13f9e6e28bd42286282e7849bb4eb9bbe6517977cdd9d3d18224bc1635a94154f6398ad9562cba0bf4b96b39d24d0048c15a02a258d093d3892812b2c79997561c57110fb50f9b5fd0df5b56d5573202030c04b4fdcacb71014ab8bd21aac88665334ea7c8f74c33dc866d9cf8d349faebe6f70f4a7f10aab82f88785e5779d9dd10336eeddf1aa215bd3e96efba4bcaf03bf460ab19cbdb23445cf172f38f610f3e1818c3c7de2cad36633f27c10f3e1c342209a941053ce7a3a07a59ed3dd9d764cc819e98d600a77331b51a8173c0fe9a599650de356f7a9c2440ea15d1a000fbf1bc5b313f970dd2aaaf09471a83fac87e5eba4b2562f039f5cf2463d216bdd550f5c2e6d833a00de54f519f41e76a56597f4304cd5defa2cafb5409f2db6723c9ed3c9d793eb457eca74da269063da5b88c372209a8243a",
    #"abba1202120022021a00abba",
  )

test test_counterparty_same_results_empty() {
  let (length, bytes) = marshal_for_counterparty(counterparty_empty)
  let length_deprecated =
    size_for_counterparty_deprecated(Some(counterparty_empty))
  let bytes_deprecated =
    marshal_for_counterparty_deprecated(Some(counterparty_empty))

  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_counterparty_same_results() {
  let (length, bytes) = marshal_for_counterparty(counterparty)
  let length_deprecated = size_for_counterparty_deprecated(Some(counterparty))
  let bytes_deprecated = marshal_for_counterparty_deprecated(Some(counterparty))

  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_counterparty_same_results_large_values() {
  let (length, bytes) = marshal_for_counterparty(counterparty_large)
  let length_deprecated =
    size_for_counterparty_deprecated(Some(counterparty_large))
  let bytes_deprecated =
    marshal_for_counterparty_deprecated(Some(counterparty_large))

  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_channel_same_results_empty() {
  let channel = Channel(UNINITIALIZED, NONE, counterparty_empty, [], #"", 0)
  let (length, bytes) = marshal_for_channel(channel)
  let length_deprecated = size_for_channel_deprecated(Some(channel))
  let bytes_deprecated = marshal_for_channel_deprecated(Some(channel))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_channel_same_results() {
  let channel =
    Channel(
      UNINITIALIZED,
      NONE,
      counterparty,
      [
        #"1202120022021a00", #"abba1202120022021a00abba", #"1202120022021a00",
        #"abba1202120022021a00abba",
      ],
      #"abba1202120022021a00abba",
      1337,
    )
  let (length, bytes) = marshal_for_channel(channel)
  let length_deprecated = size_for_channel_deprecated(Some(channel))
  let bytes_deprecated = marshal_for_channel_deprecated(Some(channel))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_channel_same_results_large() {
  let channel =
    Channel(
      UNINITIALIZED,
      NONE,
      counterparty_large,
      [
        #"1202120022021a00abba1202120022021a00abba",
        #"1202120022021a00abba1202120022021a00abba", #"1202120022021a00",
        #"1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba",
        #"1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba",
        #"1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba",
        #"1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba",
        #"1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba",
        #"1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba",
        #"1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba",
        #"1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba1202120022021a00abba",
      ],
      #"1202120022021a00",
      133713371337133713371337133713371337,
    )
  let (length, bytes) = marshal_for_channel(channel)
  let length_deprecated = size_for_channel_deprecated(Some(channel))
  let bytes_deprecated = marshal_for_channel_deprecated(Some(channel))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}
