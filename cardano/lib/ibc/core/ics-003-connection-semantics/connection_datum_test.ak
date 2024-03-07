use aiken/list
use ibc/auth.{AuthToken}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/state.{State}
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}

const mock_client_id = "client_id"

const mock_connection_id = "connection_id"

const mock_counterparty_client_id = "counterparty_client_id"

const mock_key_prefix = "prefix"

const mock_delay_period = 100

const mock_policy_id = #"786a02f742015903c6c6fd852552d272912f4740e1584761"

const mock_asset_name = "handler"

fn create_mock_connection_end(
  connection_state: State,
  connection_id: ByteArray,
) -> ConnectionEnd {
  let mock_compatible_versions = version.get_compatible_versions()
  ConnectionEnd {
    client_id: mock_client_id,
    versions: mock_compatible_versions,
    state: connection_state,
    counterparty: Counterparty {
      client_id: mock_counterparty_client_id,
      connection_id,
      prefix: MerklePrefix { key_prefix: mock_key_prefix },
    },
    delay_period: mock_delay_period,
  }
}

test test_is_conn_open_init_valid_succeed() {
  let mock_connection_end = create_mock_connection_end(state.Init, "")
  let mock_counterparty = mock_connection_end.counterparty
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }
  let test_cases: List<(ConnectionDatum, AuthToken, Bool)> =
    [
      (mock_connection_datum, mock_auth_token, True),
      //connection end client id
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            client_id: "lowercaseid",
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            client_id: "._+-#[]<>._+-#[]<>",
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            client_id: "lower._+-#[]<>",
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            client_id: "1234567890",
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            client_id: "NOTLOWERCASE",
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            client_id: "1234567890",
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            counterparty: Counterparty {
              ..mock_counterparty,
              connection_id: "",
            },
          },
        },
        mock_auth_token,
        True,
      ),
      //counterparty client Id
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            counterparty: Counterparty {
              ..mock_counterparty,
              client_id: "lowercaseid",
            },
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            counterparty: Counterparty {
              ..mock_counterparty,
              client_id: "._+-#[]<>._+-#[]<>",
            },
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            counterparty: Counterparty {
              ..mock_counterparty,
              client_id: "lower._+-#[]<>",
            },
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            counterparty: Counterparty {
              ..mock_counterparty,
              client_id: "1234567890",
            },
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            counterparty: Counterparty {
              ..mock_counterparty,
              client_id: "NOTLOWERCASE",
            },
          },
        },
        mock_auth_token,
        True,
      ),
    ]
  test_cases
    |> list.all(
         fn(case) {
           connection_datum.is_conn_open_init_valid(case.1st, case.2nd) == case.3rd
         },
       )
}

// This test is an example for validating the basic functionality of the validate_basic function in connection_end.
// To access the full test, refer to: ibc/core/ics_003_connection_semantics/types/connection_end_test.ak
test test_is_conn_open_init_valid_fail_at_validate_basic() fail {
  let mock_connection_end = create_mock_connection_end(state.Init, "")
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }
  connection_datum.is_conn_open_init_valid(
    ConnectionDatum {
      ..mock_connection_datum,
      state: ConnectionEnd {
        ..mock_connection_end,
        client_id: "this identifier is too long to be used as a valid identifier",
      },
    },
    mock_auth_token,
  )
}

test test_is_conn_open_init_valid_fail_when_auth_token_not_match_with_conection_datum_token() fail {
  let mock_connection_end = create_mock_connection_end(state.Init, "")
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }
  let mock_auth_token_invalid = AuthToken { policy_id: "", name: "" }

  connection_datum.is_conn_open_init_valid(
    mock_connection_datum,
    mock_auth_token_invalid,
  )
}

test test_is_conn_open_init_valid_fail_when_version_is_not_supported() fail {
  let mock_identifier_invalid = "invalid_identifier"
  let mock_connection_end = create_mock_connection_end(state.Init, "")
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }
  connection_datum.is_conn_open_init_valid(
    ConnectionDatum {
      ..mock_connection_datum,
      state: ConnectionEnd {
        ..mock_connection_datum.state,
        versions: [
          Version {
            identifier: mock_identifier_invalid,
            features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
          },
        ],
      },
    },
    mock_auth_token,
  )
}

test test_is_conn_open_init_valid_fail_when_connection_end_state_is_not_init() fail {
  let mock_connection_end = create_mock_connection_end(state.Init, "")
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }

  connection_datum.is_conn_open_init_valid(
    ConnectionDatum {
      ..mock_connection_datum,
      state: ConnectionEnd {
        ..mock_connection_datum.state,
        state: state.TryOpen,
      },
    },
    mock_auth_token,
  )
}

test test_is_conn_open_init_valid_fail_when_counterparty_connection_id_is_not_empty() fail {
  let mock_invalid_counterparty_connection_id = "invalid_counterparty"
  let mock_connection_end = create_mock_connection_end(state.Init, "")
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }

  connection_datum.is_conn_open_init_valid(
    ConnectionDatum {
      ..mock_connection_datum,
      state: ConnectionEnd {
        ..mock_connection_datum.state,
        counterparty: Counterparty {
          ..mock_connection_datum.state.counterparty,
          connection_id: mock_invalid_counterparty_connection_id,
        },
      },
    },
    mock_auth_token,
  )
}

test test_is_conn_open_try_valid_succeed() {
  let mock_connection_end =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_counterparty = mock_connection_end.counterparty
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }
  let test_cases: List<(ConnectionDatum, AuthToken, Bool)> =
    [
      (mock_connection_datum, mock_auth_token, True),
      //connection end client id
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            client_id: "lowercaseid",
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            client_id: "._+-#[]<>._+-#[]<>",
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            client_id: "lower._+-#[]<>",
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            client_id: "1234567890",
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            client_id: "NOTLOWERCASE",
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            client_id: "1234567890",
          },
        },
        mock_auth_token,
        True,
      ),
      //connection id
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            counterparty: Counterparty {
              ..mock_counterparty,
              connection_id: "lowercaseid",
            },
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            counterparty: Counterparty {
              ..mock_counterparty,
              connection_id: "._+-#[]<>._+-#[]<>",
            },
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            counterparty: Counterparty {
              ..mock_counterparty,
              connection_id: "lower._+-#[]<>",
            },
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            counterparty: Counterparty {
              ..mock_counterparty,
              connection_id: "NOTLOWERCASE",
            },
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            counterparty: Counterparty {
              ..mock_counterparty,
              connection_id: "1234567890",
            },
          },
        },
        mock_auth_token,
        True,
      ),
      //counterparty client Id
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            counterparty: Counterparty {
              ..mock_counterparty,
              client_id: "lowercaseid",
            },
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            counterparty: Counterparty {
              ..mock_counterparty,
              client_id: "._+-#[]<>._+-#[]<>",
            },
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            counterparty: Counterparty {
              ..mock_counterparty,
              client_id: "lower._+-#[]<>",
            },
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            counterparty: Counterparty {
              ..mock_counterparty,
              client_id: "1234567890",
            },
          },
        },
        mock_auth_token,
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum,
          state: ConnectionEnd {
            ..mock_connection_end,
            counterparty: Counterparty {
              ..mock_counterparty,
              client_id: "NOTLOWERCASE",
            },
          },
        },
        mock_auth_token,
        True,
      ),
    ]
  test_cases
    |> list.all(
         fn(case) {
           connection_datum.is_conn_open_try_valid(case.1st, case.2nd) == case.3rd
         },
       )
}

// This test is an example for validating the basic functionality of the validate_basic function in connection_end in connection_datum.
// To access the full test of validate_basic, refer to: ibc/core/ics_003_connection_semantics/types/connection_end_test.ak
test test_is_conn_open_try_valid_fail_at_validate_basic() fail {
  let mock_connection_end =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }
  connection_datum.is_conn_open_init_valid(
    ConnectionDatum {
      ..mock_connection_datum,
      state: ConnectionEnd {
        ..mock_connection_end,
        client_id: "this identifier is too long to be used as a valid identifier",
      },
    },
    mock_auth_token,
  )
}

test test_is_conn_open_try_valid_fail_when_version_is_not_compatible() fail {
  let mock_connection_end =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }
  connection_datum.is_conn_open_try_valid(
    ConnectionDatum {
      ..mock_connection_datum,
      state: ConnectionEnd { ..mock_connection_end, versions: [] },
    },
    mock_auth_token,
  )
}

test test_is_conn_open_try_valid_fail_when_auth_token_not_match_with_conection_datum_token() fail {
  let mock_connection_end =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }
  let mock_auth_token_invalid = AuthToken { policy_id: "", name: "" }

  connection_datum.is_conn_open_try_valid(
    mock_connection_datum,
    mock_auth_token_invalid,
  )
}

test test_is_conn_open_try_valid_fail_when_version_is_not_supported() fail {
  let mock_identifier_invalid = "invalid_identifier"
  let mock_connection_end =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }
  connection_datum.is_conn_open_try_valid(
    ConnectionDatum {
      ..mock_connection_datum,
      state: ConnectionEnd {
        ..mock_connection_datum.state,
        versions: [
          Version {
            identifier: mock_identifier_invalid,
            features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
          },
        ],
      },
    },
    mock_auth_token,
  )
}

test test_is_conn_open_try_valid_fail_when_connection_end_state_is_not_try_open() fail {
  let mock_connection_end =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }

  connection_datum.is_conn_open_try_valid(
    ConnectionDatum {
      ..mock_connection_datum,
      state: ConnectionEnd { ..mock_connection_datum.state, state: state.Init },
    },
    mock_auth_token,
  )
}

test test_is_conn_open_try_valid_fail_when_counterparty_connection_id_is_empty() fail {
  let mock_counterparty_connection_id_empty = " "
  let mock_connection_end =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }

  connection_datum.is_conn_open_try_valid(
    ConnectionDatum {
      ..mock_connection_datum,
      state: ConnectionEnd {
        ..mock_connection_datum.state,
        counterparty: Counterparty {
          ..mock_connection_datum.state.counterparty,
          connection_id: mock_counterparty_connection_id_empty,
        },
      },
    },
    mock_auth_token,
  )
}

test test_is_connection_open_ack_valid_succeed() {
  let mock_connection_end_input =
    create_mock_connection_end(state.Init, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }
  let test_cases: List<(ConnectionDatum, Bool)> =
    [
      (mock_connection_datum_input, True),
      //connection end client id
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            client_id: "lowercaseid",
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            client_id: "._+-#[]<>._+-#[]<>",
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            client_id: "lower._+-#[]<>",
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            client_id: "1234567890",
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            client_id: "NOTLOWERCASE",
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            client_id: "1234567890",
          },
        },
        True,
      ),
      //counterparty client Id
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            counterparty: Counterparty {
              ..mock_connection_datum_input.state.counterparty,
              client_id: "lowercaseid",
            },
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            counterparty: Counterparty {
              ..mock_connection_datum_input.state.counterparty,
              client_id: "._+-#[]<>._+-#[]<>",
            },
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            counterparty: Counterparty {
              ..mock_connection_datum_input.state.counterparty,
              client_id: "lower._+-#[]<>",
            },
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            counterparty: Counterparty {
              ..mock_connection_datum_input.state.counterparty,
              client_id: "1234567890",
            },
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            counterparty: Counterparty {
              ..mock_connection_datum_input.state.counterparty,
              client_id: "NOTLOWERCASE",
            },
          },
        },
        True,
      ),
    ]
  test_cases
    |> list.all(
         fn(case) {
           connection_datum.is_connection_open_ack_valid(
             case.1st,
             ConnectionDatum {
               ..case.1st,
               state: ConnectionEnd { ..case.1st.state, state: state.Open },
             },
           ) == case.2nd
         },
       )
}

test test_is_connection_open_ack_valid_fail_when_input_datum_state_is_not_init() fail {
  let mock_connection_end_input =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }
  connection_datum.is_connection_open_ack_valid(
    mock_connection_datum_input,
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Open,
      },
    },
  )
}

test test_is_connection_open_ack_valid_fail_when_output_counterparty_conn_id_is_empty() fail {
  let mock_connection_end_input =
    create_mock_connection_end(state.Init, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }
  connection_datum.is_connection_open_ack_valid(
    mock_connection_datum_input,
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Open,
        counterparty: Counterparty {
          ..mock_connection_datum_input.state.counterparty,
          connection_id: "",
        },
      },
    },
  )
}

test test_is_connection_open_ack_valid_fail_when_output_datum_fail_at_validate_basic() fail {
  let mock_connection_end_input =
    create_mock_connection_end(state.Init, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }
  connection_datum.is_connection_open_ack_valid(
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        client_id: "this identifier is too long to be used as a valid identifier",
      },
    },
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Open,
        client_id: "this identifier is too long to be used as a valid identifier",
      },
    },
  )
}

test test_is_connection_open_ack_valid_fail_when_output_datum_state_is_not_open() fail {
  let mock_connection_end_input =
    create_mock_connection_end(state.Init, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }
  connection_datum.is_connection_open_ack_valid(
    mock_connection_datum_input,
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.TryOpen,
      },
    },
  )
}

test test_is_connection_open_ack_valid_fail_when_output_datum_state_not_match_with_expected_datum_state() fail {
  let mock_connection_end_input =
    create_mock_connection_end(state.Init, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }
  connection_datum.is_connection_open_ack_valid(
    mock_connection_datum_input,
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Open,
        delay_period: //diffrent delay_period with input datum
        mock_delay_period + 1,
      },
    },
  )
}

test test_is_connection_open_ack_valid_fail_when_output_datum_token_not_match_with_expected_datum_token() fail {
  let mock_connection_end_input =
    create_mock_connection_end(state.Init, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }
  connection_datum.is_connection_open_ack_valid(
    mock_connection_datum_input,
    ConnectionDatum {
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Open,
      },
      token: AuthToken { ..mock_auth_token, name: "invalid_asset_name" },
    },
  )
}

test test_is_connection_open_confirm_valid_succeed() {
  let mock_connection_end_input =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }
  let test_cases: List<(ConnectionDatum, Bool)> =
    [
      (mock_connection_datum_input, True),
      //connection end client id
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            client_id: "lowercaseid",
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            client_id: "._+-#[]<>._+-#[]<>",
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            client_id: "lower._+-#[]<>",
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            client_id: "1234567890",
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            client_id: "NOTLOWERCASE",
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            client_id: "1234567890",
          },
        },
        True,
      ),
      //counterparty client Id
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            counterparty: Counterparty {
              ..mock_connection_datum_input.state.counterparty,
              client_id: "lowercaseid",
            },
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            counterparty: Counterparty {
              ..mock_connection_datum_input.state.counterparty,
              client_id: "._+-#[]<>._+-#[]<>",
            },
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            counterparty: Counterparty {
              ..mock_connection_datum_input.state.counterparty,
              client_id: "lower._+-#[]<>",
            },
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            counterparty: Counterparty {
              ..mock_connection_datum_input.state.counterparty,
              client_id: "1234567890",
            },
          },
        },
        True,
      ),
      (
        ConnectionDatum {
          ..mock_connection_datum_input,
          state: ConnectionEnd {
            ..mock_connection_datum_input.state,
            counterparty: Counterparty {
              ..mock_connection_datum_input.state.counterparty,
              client_id: "NOTLOWERCASE",
            },
          },
        },
        True,
      ),
    ]
  test_cases
    |> list.all(
         fn(case) {
           connection_datum.is_connection_open_confirm_valid(
             case.1st,
             ConnectionDatum {
               ..case.1st,
               state: ConnectionEnd { ..case.1st.state, state: state.Open },
             },
           ) == case.2nd
         },
       )
}

test test_is_connection_open_confirm_valid_fail_when_input_datum_state_is_not_tryopen() fail {
  let mock_connection_end_input =
    create_mock_connection_end(state.Init, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }
  connection_datum.is_connection_open_confirm_valid(
    mock_connection_datum_input,
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Open,
      },
    },
  )
}

test test_is_connection_open_confirm_valid_fail_when_output_datum_state_is_not_open() fail {
  let mock_connection_end_input =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }
  connection_datum.is_connection_open_confirm_valid(
    mock_connection_datum_input,
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Init,
      },
    },
  )
}

test test_is_connection_open_confirm_valid_fail_when_output_datum_state_not_match_with_expected_datum_state() fail {
  let mock_connection_end_input =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }
  connection_datum.is_connection_open_confirm_valid(
    mock_connection_datum_input,
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Open,
        delay_period: //diffrent delay_period with input datum
        mock_delay_period + 1,
      },
    },
  )
}

test test_is_connection_open_confirm_valid_fail_when_output_datum_token_not_match_with_expected_datum_token() fail {
  let mock_connection_end_input =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }
  connection_datum.is_connection_open_confirm_valid(
    mock_connection_datum_input,
    ConnectionDatum {
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Open,
      },
      token: AuthToken { ..mock_auth_token, name: "invalid_asset_name" },
    },
  )
}
