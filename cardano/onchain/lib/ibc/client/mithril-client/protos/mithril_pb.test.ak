use ibc/client/mithril_client/protos/mithril_pb.{
  AnyMithrilClientState, CardanoHeight, Fraction, MithrilClientState,
  MithrilDuration, MithrilProtocolParameters, marshal_for_any_client_state,
  marshal_for_client_state, marshal_for_duration, marshal_for_fraction,
  marshal_for_height, marshal_for_protocol_parameters,
}
use ibc/client/mithril_client/protos/mithril_pb_deprecated.{
  AnyMithrilClientState as AnyMithrilClientStateDeprecated,
  MithrilClientState as MithrilClientStateDeprecated,
  MithrilProtocolParameters as MithrilProtocolParametersDeprecated,
  marshal_for_any_client_state as marshal_for_any_client_state_deprecated,
  marshal_for_client_state as marshal_for_client_state_deprecated,
  marshal_for_duration as marshal_for_duration_deprecated,
  marshal_for_fraction as marshal_for_fraction_deprecated,
  marshal_for_height as marshal_for_height_deprecated,
  marshal_for_protocol_parameters as marshal_for_protocol_parameters_deprecated,
  size_for_client_state as size_for_client_state_deprecated,
  size_for_duration as size_for_duration_deprecated,
  size_for_fraction as size_for_fraction_deprecated,
  size_for_height as size_for_height_deprecated,
  size_for_protocol_parameters as size_for_protocol_parameters_deprecated,
}

test test_marshal_for_client_state() {
  let cs =
    Some(
      MithrilClientStateDeprecated {
        chain_id: "chain-id",
        latest_height: Some(
          CardanoHeight { revision_height: 11, revision_number: 0 },
        ),
        frozen_height: Some(
          CardanoHeight { revision_height: 12, revision_number: 0 },
        ),
        current_epoch: 2,
        trusting_period: 10000,
        protocol_parameters: Some(
          MithrilProtocolParametersDeprecated {
            k: 2,
            m: 3,
            phi_f: Some(Fraction { numerator: 20, denominator: 100 }),
          },
        ),
        upgrade_path: ["abc", "xyz"],
      },
    )
  marshal_for_client_state_deprecated(cs) == #"0a08636861696e2d69641202100b1a02100c20022a0310904e320a080210031a04081410643a036162633a0378797a"
}

test test_size_for_protocol_parameters_succeed() {
  size_for_protocol_parameters_deprecated(
    Some(
      MithrilProtocolParametersDeprecated {
        k: 222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222,
        m: 333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333,
        phi_f: Some(Fraction { numerator: 20, denominator: 100 }),
      },
    ),
  ) == 27
}

test test_marshal_for_fraction_same_result_empty() {
  let fraction = Fraction(0, 0)
  let (length, bytes) = marshal_for_fraction(fraction)
  let bytes_deprecated = marshal_for_fraction_deprecated(Some(fraction))
  let length_deprecated = size_for_fraction_deprecated(Some(fraction))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_fraction_same_result() {
  let fraction = Fraction(1337, 1442)
  let (length, bytes) = marshal_for_fraction(fraction)
  let bytes_deprecated = marshal_for_fraction_deprecated(Some(fraction))
  let length_deprecated = size_for_fraction_deprecated(Some(fraction))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_fraction_same_large() {
  let fraction = Fraction(13371337133713371337, 144214421442144214421442)
  let (length, bytes) = marshal_for_fraction(fraction)
  let bytes_deprecated = marshal_for_fraction_deprecated(Some(fraction))
  let length_deprecated = size_for_fraction_deprecated(Some(fraction))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_duration_same_result_empty() {
  let mithril_duration = MithrilDuration(0, 0)
  let (length, bytes) = marshal_for_duration(mithril_duration)
  let bytes_deprecated = marshal_for_duration_deprecated(Some(mithril_duration))
  let length_deprecated = size_for_duration_deprecated(Some(mithril_duration))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_duration_same_result() {
  let mithril_duration = MithrilDuration(1337, 1442)
  let (length, bytes) = marshal_for_duration(mithril_duration)
  let bytes_deprecated = marshal_for_duration_deprecated(Some(mithril_duration))
  let length_deprecated = size_for_duration_deprecated(Some(mithril_duration))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_duration_same_result_large() {
  let mithril_duration =
    MithrilDuration(13371337133713371337, 144214421442144214421442)
  let (length, bytes) = marshal_for_duration(mithril_duration)
  let bytes_deprecated = marshal_for_duration_deprecated(Some(mithril_duration))
  let length_deprecated = size_for_duration_deprecated(Some(mithril_duration))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_protocol_parameters_same_result_empty() {
  let mithril_protocol_parameters =
    MithrilProtocolParameters(0, 0, Fraction(0, 1))
  let mithril_protocol_parameters_deprecated =
    MithrilProtocolParametersDeprecated(0, 0, Some(Fraction(0, 1)))

  let (length, bytes) =
    marshal_for_protocol_parameters(mithril_protocol_parameters)
  let bytes_deprecated =
    marshal_for_protocol_parameters_deprecated(
      Some(mithril_protocol_parameters_deprecated),
    )
  let length_deprecated =
    size_for_protocol_parameters_deprecated(
      Some(mithril_protocol_parameters_deprecated),
    )

  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_protocol_parameters_same_result() {
  let mithril_protocol_parameters =
    MithrilProtocolParameters(1337, 1442, Fraction(1337, 1442))
  let mithril_protocol_parameters_deprecated =
    MithrilProtocolParametersDeprecated(1337, 1442, Some(Fraction(1337, 1442)))

  let (length, bytes) =
    marshal_for_protocol_parameters(mithril_protocol_parameters)
  let bytes_deprecated =
    marshal_for_protocol_parameters_deprecated(
      Some(mithril_protocol_parameters_deprecated),
    )
  let length_deprecated =
    size_for_protocol_parameters_deprecated(
      Some(mithril_protocol_parameters_deprecated),
    )

  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_protocol_parameters_same_result_large() {
  let mithril_protocol_parameters =
    MithrilProtocolParameters(
      1337133713371337,
      14421442144214421442,
      Fraction(1337133713371337, 1442144214421442),
    )
  let mithril_protocol_parameters_deprecated =
    MithrilProtocolParametersDeprecated(
      1337133713371337,
      14421442144214421442,
      Some(Fraction(1337133713371337, 1442144214421442)),
    )

  let (length, bytes) =
    marshal_for_protocol_parameters(mithril_protocol_parameters)
  let bytes_deprecated =
    marshal_for_protocol_parameters_deprecated(
      Some(mithril_protocol_parameters_deprecated),
    )
  let length_deprecated =
    size_for_protocol_parameters_deprecated(
      Some(mithril_protocol_parameters_deprecated),
    )

  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_height_empty() {
  let height = CardanoHeight(0, 0)
  let (length, bytes) = marshal_for_height(height)
  let bytes_deprecated = marshal_for_height_deprecated(Some(height))
  let length_deprecated = size_for_height_deprecated(Some(height))

  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_height_large() {
  let height =
    CardanoHeight(1337133713371337133713371337, 144214421442144214421442)
  let (length, bytes) = marshal_for_height(height)
  let bytes_deprecated = marshal_for_height_deprecated(Some(height))
  let length_deprecated = size_for_height_deprecated(Some(height))

  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

const mithril_client_state_empty =
  MithrilClientState(
    #"",
    CardanoHeight(0, 0),
    CardanoHeight(0, 0),
    0,
    0,
    MithrilProtocolParameters(0, 0, Fraction(0, 1)),
    [],
  )

const mithril_client_state_empty_deprecated =
  MithrilClientStateDeprecated(
    #"",
    Some(CardanoHeight(0, 0)),
    Some(CardanoHeight(0, 0)),
    0,
    0,
    Some(MithrilProtocolParametersDeprecated(0, 0, Some(Fraction(0, 1)))),
    [],
  )

test test_marshal_for_client_state_same_result_empty() {
  let (length, bytes) = marshal_for_client_state(mithril_client_state_empty)
  let bytes_deprecated =
    marshal_for_client_state_deprecated(
      Some(mithril_client_state_empty_deprecated),
    )
  let length_deprecated =
    size_for_client_state_deprecated(
      Some(mithril_client_state_empty_deprecated),
    )

  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

const mithril_client_state =
  MithrilClientState(
    #"6561737931206973207468652062657374207374616b6520706f6f6c",
    CardanoHeight(1337, 1442),
    CardanoHeight(1337, 1442),
    1337,
    1442,
    MithrilProtocolParameters(1337, 1442, Fraction(1337, 1442)),
    [
      #"6561737931206973207468652062657374207374616b6520706f6f6c",
      #"6561737931206973207468652062657374207374616b6520706f6f6c",
    ],
  )

const mithril_client_state_deprecated =
  MithrilClientStateDeprecated(
    #"6561737931206973207468652062657374207374616b6520706f6f6c",
    Some(CardanoHeight(1337, 1442)),
    Some(CardanoHeight(1337, 1442)),
    1337,
    1442,
    Some(
      MithrilProtocolParametersDeprecated(
        1337,
        1442,
        Some(Fraction(1337, 1442)),
      ),
    ),
    [
      #"6561737931206973207468652062657374207374616b6520706f6f6c",
      #"6561737931206973207468652062657374207374616b6520706f6f6c",
    ],
  )

test test_marshal_for_client_state_same_result() {
  let (length, bytes) = marshal_for_client_state(mithril_client_state)
  let bytes_deprecated =
    marshal_for_client_state_deprecated(Some(mithril_client_state_deprecated))
  let length_deprecated =
    size_for_client_state_deprecated(Some(mithril_client_state_deprecated))

  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_any_client_state_same_result_empty() {
  let any_client_state = AnyMithrilClientState(#"", mithril_client_state_empty)
  let any_client_state_deprecated =
    AnyMithrilClientStateDeprecated(
      #"",
      Some(mithril_client_state_empty_deprecated),
    )

  let (_, bytes) = marshal_for_any_client_state(any_client_state)
  let bytes_deprecated =
    marshal_for_any_client_state_deprecated(Some(any_client_state_deprecated))

  bytes == bytes_deprecated
}

test test_marshal_for_any_client_state_same_result() {
  let any_client_state = AnyMithrilClientState(#"", mithril_client_state)
  let any_client_state_deprecated =
    AnyMithrilClientStateDeprecated(#"", Some(mithril_client_state_deprecated))

  let (_, bytes) = marshal_for_any_client_state(any_client_state)
  let bytes_deprecated =
    marshal_for_any_client_state_deprecated(Some(any_client_state_deprecated))

  bytes == bytes_deprecated
}
