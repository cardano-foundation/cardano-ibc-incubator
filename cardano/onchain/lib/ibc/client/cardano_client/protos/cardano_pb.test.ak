use ibc/client/cardano_client/protos/cardano_pb.{
  AnyCardanoClientState, AnyCardanoClientStateV2, CardanoClientState,
  CardanoClientStateV2, CardanoConsensusState, CardanoHeight, CardanoValidator,
  TokenConfigs, marshal_for_any_client_state, marshal_for_any_client_state_v2,
  marshal_for_client_state, marshal_for_client_state_v2,
  marshal_for_consensus_state, marshal_for_consensus_state_v2,
  marshal_for_height, marshal_for_height_v2, marshal_for_token_configs,
  marshal_for_token_configs_v2, marshal_for_validator, marshal_for_validator_v2,
  size_for_client_state, size_for_consensus_state, size_for_height,
  size_for_token_configs, size_for_validator,
}

test test_marshal_for_any_client_state_empty() {
  marshal_for_any_client_state(None) == #""
}

test test_marshal_for_any_client_state_some_data_success() {
  let accs_opt =
    Some(
      AnyCardanoClientState(
        #"01",
        Some(
          CardanoClientState(
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
  marshal_for_any_client_state(accs_opt) == #"0a0101120d0a010028013002380340045805"
}

test test_marshal_for_token_configs_same_results_empty() {
  let token_config = TokenConfigs(#"", #"", #"", #"")
  let (length, bytes) = marshal_for_token_configs_v2(token_config)
  let length_deprecated = size_for_token_configs(Some(token_config))
  let bytes_deprecated = marshal_for_token_configs(Some(token_config))
  trace length
  trace bytes
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
  let (lenght, bytes) = marshal_for_token_configs_v2(token_config)
  let length_deprecated = size_for_token_configs(Some(token_config))
  let bytes_deprecated = marshal_for_token_configs(Some(token_config))
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
  let (lenght, bytes) = marshal_for_token_configs_v2(token_config)
  let length_deprecated = size_for_token_configs(Some(token_config))
  let bytes_deprecated = marshal_for_token_configs(Some(token_config))

  and {
    lenght == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_validator_same_results_empty() {
  let token_config = CardanoValidator(#"", #"")
  let (length, bytes) = marshal_for_validator_v2(token_config)
  let length_deprecated = size_for_validator(Some(token_config))
  let bytes_deprecated = marshal_for_validator(Some(token_config))
  trace length
  trace bytes
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
  let (lenght, bytes) = marshal_for_validator_v2(token_config)
  let length_deprecated = size_for_validator(Some(token_config))
  let bytes_deprecated = marshal_for_validator(Some(token_config))
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
  let (lenght, bytes) = marshal_for_validator_v2(token_config)
  let length_deprecated = size_for_validator(Some(token_config))
  let bytes_deprecated = marshal_for_validator(Some(token_config))
  and {
    lenght == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_height_same_results_empty() {
  let cardano_height = CardanoHeight(0, 0)
  let (length, bytes) = marshal_for_height_v2(cardano_height)
  let length_deprecated = size_for_height(Some(cardano_height))
  let bytes_deprecated = marshal_for_height(Some(cardano_height))
  trace length
  trace bytes
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_height_same_results() {
  let cardano_height = CardanoHeight(1337, 1442)
  let (lenght, bytes) = marshal_for_height_v2(cardano_height)
  let length_deprecated = size_for_height(Some(cardano_height))
  let bytes_deprecated = marshal_for_height(Some(cardano_height))
  and {
    lenght == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_height_same_results_large() {
  let cardano_height = CardanoHeight(13371337133713371337, 14421442144214421442)
  let (lenght, bytes) = marshal_for_height_v2(cardano_height)
  let length_deprecated = size_for_height(Some(cardano_height))
  let bytes_deprecated = marshal_for_height(Some(cardano_height))
  and {
    lenght == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_consensus_state_same_results_empty() {
  let consensus_state = CardanoConsensusState(0, 0)
  let (length, bytes) = marshal_for_consensus_state_v2(consensus_state)
  let length_deprecated = size_for_consensus_state(Some(consensus_state))
  let bytes_deprecated = marshal_for_consensus_state(Some(consensus_state))
  trace length
  trace bytes
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_consensus_state_same_results() {
  let consensus_state = CardanoConsensusState(1337, 1442)
  let (lenght, bytes) = marshal_for_consensus_state_v2(consensus_state)
  let length_deprecated = size_for_consensus_state(Some(consensus_state))
  let bytes_deprecated = marshal_for_consensus_state(Some(consensus_state))
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
  let (lenght, bytes) = marshal_for_consensus_state_v2(consensus_state)
  let length_deprecated = size_for_consensus_state(Some(consensus_state))
  let bytes_deprecated = marshal_for_consensus_state(Some(consensus_state))
  and {
    lenght == length_deprecated,
    bytes == bytes_deprecated,
  }
}

const client_state_empty =
  CardanoClientState(#"", None, None, 0, 0, 0, 0, 0, [], [], 0, [], None)

const client_state_empty_v2 =
  CardanoClientStateV2(
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

// This should not fail?!
test test_marshal_for_client_state_same_results_empty() fail {
  let (length, bytes) = marshal_for_client_state_v2(client_state_empty_v2)
  let length_deprecated = size_for_client_state(Some(client_state_empty))
  let bytes_deprecated = marshal_for_client_state(Some(client_state_empty))
  trace length
  trace bytes
  trace length_deprecated
  trace bytes_deprecated
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

const client_state_some_empty =
  CardanoClientState(
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
  let (length, bytes) = marshal_for_client_state_v2(client_state_empty_v2)
  let length_deprecated = size_for_client_state(Some(client_state_some_empty))
  let bytes_deprecated = marshal_for_client_state(Some(client_state_some_empty))
  trace length
  trace bytes
  trace length_deprecated
  trace bytes_deprecated
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

const client_state =
  CardanoClientState(
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
  CardanoClientStateV2(
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
  let (length, bytes) = marshal_for_client_state_v2(client_state_v2)
  let length_deprecated = size_for_client_state(Some(client_state))
  let bytes_deprecated = marshal_for_client_state(Some(client_state))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_any_client_state_some_empty() {
  let any_client_state =
    AnyCardanoClientState(#"", Some(client_state_some_empty))
  let any_client_state_v2 = AnyCardanoClientStateV2(#"", client_state_empty_v2)
  let (_, bytes) = marshal_for_any_client_state_v2(any_client_state_v2)
  let bytes_deprecated = marshal_for_any_client_state(Some(any_client_state))
  bytes == bytes_deprecated
}

test test_marshal_for_any_client_state() {
  let any_client_state = AnyCardanoClientState(#"", Some(client_state))
  let any_client_state_v2 = AnyCardanoClientStateV2(#"", client_state_v2)
  let (_, bytes) = marshal_for_any_client_state_v2(any_client_state_v2)
  let bytes_deprecated = marshal_for_any_client_state(Some(any_client_state))
  bytes == bytes_deprecated
}
