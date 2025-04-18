use ibc/client/cardano_client/protos/cardano_pb.{
  AnyCardanoClientState, CardanoClientState, CardanoConsensusState,
  CardanoHeight, CardanoValidator, TokenConfigs, marshal_for_any_client_state,
  marshal_for_client_state, marshal_for_consensus_state, marshal_for_height,
  marshal_for_token_configs, marshal_for_validator,
}
use ibc/client/cardano_client/protos/cardano_pb_deprecated.{
  AnyCardanoClientState as AnyCardanoClientStateDeprecated,
  CardanoClientState as CardanoClientStateDeprecated,
  marshal_for_any_client_state as marshal_for_any_client_state_deprecated,
  marshal_for_client_state as marshal_for_client_state_deprecated,
  marshal_for_consensus_state as marshal_for_consensus_state_deprecated,
  marshal_for_height as marshal_for_height_deprecated,
  marshal_for_token_configs as marshal_for_token_configs_deprecated,
  marshal_for_validator as marshal_for_validator_deprecated,
  size_for_client_state as size_for_client_state_deprecated,
  size_for_consensus_state as size_for_consensus_state_deprecated,
  size_for_height as size_for_height_deprecated,
  size_for_token_configs as size_for_token_configs_deprecated,
  size_for_validator as size_for_validator_deprecated,
}

test test_marshal_for_any_client_state_empty() {
  marshal_for_any_client_state_deprecated(None) == #""
}

test test_marshal_for_any_client_state_some_data_success() {
  let accs_opt =
    Some(
      AnyCardanoClientStateDeprecated(
        #"01",
        Some(
          CardanoClientStateDeprecated(
            #"00",
            None,
            None,
            0,
            1,
            2,
            3,
            4,
            [],
            [],
            5,
            [],
            None,
          ),
        ),
      ),
    )
  marshal_for_any_client_state_deprecated(accs_opt) == #"0a0101120d0a010028013002380340045805"
}

test test_marshal_for_token_configs_same_results_empty() {
  let token_config = TokenConfigs(#"", #"", #"", #"")
  let (length, bytes) = marshal_for_token_configs(token_config)
  let length_deprecated = size_for_token_configs_deprecated(Some(token_config))
  let bytes_deprecated =
    marshal_for_token_configs_deprecated(Some(token_config))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_token_configs_same_results() {
  let token_config =
    TokenConfigs(
      #"0a0101120d0a010028013002380340045805",
      #"1300238040045805",
      #"0a0101120d0a010028013002380340045805",
      #"130102380340045805",
    )
  let (lenght, bytes) = marshal_for_token_configs(token_config)
  let length_deprecated = size_for_token_configs_deprecated(Some(token_config))
  let bytes_deprecated =
    marshal_for_token_configs_deprecated(Some(token_config))
  and {
    lenght == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_token_configs_same_results_large() {
  let token_config =
    TokenConfigs(
      #"0a0101120d0a0100280130023803400458050a0101120d0a0100280130023803400458050a0101120d0a0100280130023803400458050a0101120d0a010028013002380340045805",
      #"13002380340045805130023803400458051300238034004580513002380340045805",
      #"0a0101120d0a0100280130023803400458050a0101120d0a0100280130023803400458050a0101120d0a010028013002380340045805",
      #"13002380a340045805",
    )
  let (lenght, bytes) = marshal_for_token_configs(token_config)
  let length_deprecated = size_for_token_configs_deprecated(Some(token_config))
  let bytes_deprecated =
    marshal_for_token_configs_deprecated(Some(token_config))

  and {
    lenght == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_validator_same_results_empty() {
  let token_config = CardanoValidator(#"", #"")
  let (length, bytes) = marshal_for_validator(token_config)
  let length_deprecated = size_for_validator_deprecated(Some(token_config))
  let bytes_deprecated = marshal_for_validator_deprecated(Some(token_config))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_validator_same_results() {
  let token_config =
    CardanoValidator(
      #"0a0101120d0a010028013002380340045805",
      #"1300238040045805",
    )
  let (lenght, bytes) = marshal_for_validator(token_config)
  let length_deprecated = size_for_validator_deprecated(Some(token_config))
  let bytes_deprecated = marshal_for_validator_deprecated(Some(token_config))
  and {
    lenght == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_validator_same_results_large() {
  let token_config =
    CardanoValidator(
      #"0a0101120d0a0100280130023803400458050a0101120d0a0100280130023803400458050a0101120d0a0100280130023803400458050a0101120d0a010028013002380340045805",
      #"13002380340045805130023803400458051300238034004580513002380340045805",
    )
  let (lenght, bytes) = marshal_for_validator(token_config)
  let length_deprecated = size_for_validator_deprecated(Some(token_config))
  let bytes_deprecated = marshal_for_validator_deprecated(Some(token_config))
  and {
    lenght == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_height_same_results_empty() {
  let cardano_height = CardanoHeight(0, 0)
  let (length, bytes) = marshal_for_height(cardano_height)
  let length_deprecated = size_for_height_deprecated(Some(cardano_height))
  let bytes_deprecated = marshal_for_height_deprecated(Some(cardano_height))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_height_same_results() {
  let cardano_height = CardanoHeight(1337, 1442)
  let (lenght, bytes) = marshal_for_height(cardano_height)
  let length_deprecated = size_for_height_deprecated(Some(cardano_height))
  let bytes_deprecated = marshal_for_height_deprecated(Some(cardano_height))
  and {
    lenght == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_height_same_results_large() {
  let cardano_height = CardanoHeight(13371337133713371337, 14421442144214421442)
  let (lenght, bytes) = marshal_for_height(cardano_height)
  let length_deprecated = size_for_height_deprecated(Some(cardano_height))
  let bytes_deprecated = marshal_for_height_deprecated(Some(cardano_height))
  and {
    lenght == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_consensus_state_same_results_empty() {
  let consensus_state = CardanoConsensusState(0, 0)
  let (length, bytes) = marshal_for_consensus_state(consensus_state)
  let length_deprecated =
    size_for_consensus_state_deprecated(Some(consensus_state))
  let bytes_deprecated =
    marshal_for_consensus_state_deprecated(Some(consensus_state))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_consensus_state_same_results() {
  let consensus_state = CardanoConsensusState(1337, 1442)
  let (lenght, bytes) = marshal_for_consensus_state(consensus_state)
  let length_deprecated =
    size_for_consensus_state_deprecated(Some(consensus_state))
  let bytes_deprecated =
    marshal_for_consensus_state_deprecated(Some(consensus_state))
  and {
    lenght == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_consensus_state_same_results_large() {
  let consensus_state =
    CardanoConsensusState(
      1337133713371337133713371337,
      144214421442144214421442144214421442,
    )
  let (lenght, bytes) = marshal_for_consensus_state(consensus_state)
  let length_deprecated =
    size_for_consensus_state_deprecated(Some(consensus_state))
  let bytes_deprecated =
    marshal_for_consensus_state_deprecated(Some(consensus_state))
  and {
    lenght == length_deprecated,
    bytes == bytes_deprecated,
  }
}

const client_state_empty =
  CardanoClientStateDeprecated(
    #"",
    None,
    None,
    0,
    0,
    0,
    0,
    0,
    [],
    [],
    0,
    [],
    None,
  )

const client_state_empty_v2 =
  CardanoClientState(
    #"",
    CardanoHeight(0, 0),
    CardanoHeight(0, 0),
    0,
    0,
    0,
    0,
    0,
    [],
    [],
    0,
    [],
    TokenConfigs(#"", #"", #"", #""),
  )

// This test does not make sense anymore, as the "optional" fields are not optional anymore.
test test_marshal_for_client_state_same_results_empty() fail {
  let (length, bytes) = marshal_for_client_state(client_state_empty_v2)
  let length_deprecated =
    size_for_client_state_deprecated(Some(client_state_empty))
  let bytes_deprecated =
    marshal_for_client_state_deprecated(Some(client_state_empty))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

const client_state_some_empty =
  CardanoClientStateDeprecated(
    #"",
    Some(CardanoHeight(0, 0)),
    Some(CardanoHeight(0, 0)),
    0,
    0,
    0,
    0,
    0,
    [],
    [],
    0,
    [],
    Some(TokenConfigs(#"", #"", #"", #"")),
  )

test test_marshal_for_client_state_same_results_some_empty() {
  let (length, bytes) = marshal_for_client_state(client_state_empty_v2)
  let length_deprecated =
    size_for_client_state_deprecated(Some(client_state_some_empty))
  let bytes_deprecated =
    marshal_for_client_state_deprecated(Some(client_state_some_empty))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

const client_state =
  CardanoClientStateDeprecated(
    #"0a0101120d0a010028",
    Some(CardanoHeight(1337, 1442)),
    Some(CardanoHeight(1442, 1337)),
    1,
    2,
    3,
    4,
    5,
    [
      Some(
        CardanoValidator(
          #"abba0a0101120d0a010028013002380340045805",
          #"1300238040045805",
        ),
      ),
      Some(
        CardanoValidator(
          #"1300238040045805",
          #"0a0101120d0a010028013002380340045805",
        ),
      ),
    ],
    [
      Some(
        CardanoValidator(
          #"0a0101120d0a010028013002380340045805",
          #"1300238040045805",
        ),
      ),
    ],
    0,
    [#"0a0101120d0a010028", #"0a0101120d0a010028013002380340045805"],
    Some(
      TokenConfigs(
        #"0a0101120d0a010028",
        #"0a0101120d0a010028013002380340045805",
        #"0a0101120d0a010028",
        #"0a0101120d0a010028013002380340045805",
      ),
    ),
  )

const client_state_v2 =
  CardanoClientState(
    #"0a0101120d0a010028",
    CardanoHeight(1337, 1442),
    CardanoHeight(1442, 1337),
    1,
    2,
    3,
    4,
    5,
    [
      CardanoValidator(
        #"abba0a0101120d0a010028013002380340045805",
        #"1300238040045805",
      ),
      CardanoValidator(
        #"1300238040045805",
        #"0a0101120d0a010028013002380340045805",
      ),
    ],
    [
      CardanoValidator(
        #"0a0101120d0a010028013002380340045805",
        #"1300238040045805",
      ),
    ],
    0,
    [#"0a0101120d0a010028", #"0a0101120d0a010028013002380340045805"],
    TokenConfigs(
      #"0a0101120d0a010028",
      #"0a0101120d0a010028013002380340045805",
      #"0a0101120d0a010028",
      #"0a0101120d0a010028013002380340045805",
    ),
  )

test test_marshal_for_client_state_same_results_some() {
  let (length, bytes) = marshal_for_client_state(client_state_v2)
  let length_deprecated = size_for_client_state_deprecated(Some(client_state))
  let bytes_deprecated = marshal_for_client_state_deprecated(Some(client_state))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_any_client_state_some_empty() {
  let any_client_state =
    AnyCardanoClientStateDeprecated(#"", Some(client_state_some_empty))
  let any_client_state_v2 = AnyCardanoClientState(#"", client_state_empty_v2)
  let (_, bytes) = marshal_for_any_client_state(any_client_state_v2)
  let bytes_deprecated =
    marshal_for_any_client_state_deprecated(Some(any_client_state))
  bytes == bytes_deprecated
}

test test_marshal_for_any_client_state() {
  let any_client_state =
    AnyCardanoClientStateDeprecated(#"", Some(client_state))
  let any_client_state_v2 = AnyCardanoClientState(#"", client_state_v2)
  let (_, bytes) = marshal_for_any_client_state(any_client_state_v2)
  let bytes_deprecated =
    marshal_for_any_client_state_deprecated(Some(any_client_state))
  bytes == bytes_deprecated
}
