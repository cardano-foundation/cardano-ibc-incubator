use ibc/auth.{AuthToken}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/state.{State}
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}

const mock_client_id = "ibc_client-199"

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
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }

  connection_datum.is_conn_open_init_valid(
    mock_connection_datum,
    mock_auth_token,
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

test test_is_conn_open_init_valid_fail_when_auth_token_not_match_with_connection_datum_token() fail {
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
  let mock_connection_end =
    create_mock_connection_end(
      state.Init,
      mock_invalid_counterparty_connection_id,
    )
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }

  connection_datum.is_conn_open_init_valid(
    mock_connection_datum,
    mock_auth_token,
  )
}

test test_is_conn_open_try_valid_succeed() {
  let mock_connection_end =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }

  connection_datum.is_conn_open_try_valid(
    mock_connection_datum,
    mock_auth_token,
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

test test_is_conn_open_try_valid_fail_when_auth_token_not_match_with_connection_datum_token() fail {
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
    create_mock_connection_end(
      state.TryOpen,
      mock_counterparty_connection_id_empty,
    )
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum =
    ConnectionDatum { state: mock_connection_end, token: mock_auth_token }

  connection_datum.is_conn_open_try_valid(
    mock_connection_datum,
    mock_auth_token,
  )
}

test test_is_connection_open_ack_valid_succeed() {
  let mock_connection_end_input = create_mock_connection_end(state.Init, "")

  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }

  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }

  let output_connection_datum =
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Open,
        counterparty: Counterparty {
          ..mock_connection_datum_input.state.counterparty,
          connection_id: mock_connection_id,
        },
      },
    }

  connection_datum.is_connection_open_ack_valid(
    mock_connection_datum_input,
    output_connection_datum,
  )
}

test test_is_connection_open_ack_valid_fail_when_input_datum_state_is_not_init() fail {
  let mock_connection_end_input = create_mock_connection_end(state.TryOpen, "")

  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }

  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }

  let output_connection_datum =
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Open,
        counterparty: Counterparty {
          ..mock_connection_datum_input.state.counterparty,
          connection_id: mock_connection_id,
        },
      },
    }

  connection_datum.is_connection_open_ack_valid(
    mock_connection_datum_input,
    output_connection_datum,
  )
}

test test_is_connection_open_ack_valid_fail_when_output_counterparty_conn_id_is_invalid() fail {
  let mock_connection_end_input = create_mock_connection_end(state.Init, "")

  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }

  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }

  let output_connection_datum =
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Open,
        counterparty: Counterparty {
          ..mock_connection_datum_input.state.counterparty,
          connection_id: "  ",
        },
      },
    }

  connection_datum.is_connection_open_ack_valid(
    mock_connection_datum_input,
    output_connection_datum,
  )
}

test test_is_connection_open_ack_valid_fail_when_output_datum_state_is_not_open() fail {
  let mock_connection_end_input = create_mock_connection_end(state.Init, "")

  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }

  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }

  let output_connection_datum =
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.TryOpen,
        counterparty: Counterparty {
          ..mock_connection_datum_input.state.counterparty,
          connection_id: mock_connection_id,
        },
      },
    }

  connection_datum.is_connection_open_ack_valid(
    mock_connection_datum_input,
    output_connection_datum,
  )
}

test test_is_connection_open_ack_valid_fail_when_output_datum_state_not_match_with_expected_datum_state() fail {
  let mock_connection_end_input = create_mock_connection_end(state.Init, "")

  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }

  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }

  let output_connection_datum =
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Open,
        delay_period: mock_connection_datum_input.state.delay_period + 1,
        counterparty: Counterparty {
          ..mock_connection_datum_input.state.counterparty,
          connection_id: mock_connection_id,
        },
      },
    }

  connection_datum.is_connection_open_ack_valid(
    mock_connection_datum_input,
    output_connection_datum,
  )
}

test test_is_connection_open_ack_valid_fail_when_output_datum_token_not_match_with_expected_datum_token() fail {
  let mock_connection_end_input = create_mock_connection_end(state.Init, "")

  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }

  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }

  let output_connection_datum =
    ConnectionDatum {
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Open,
        delay_period: mock_connection_datum_input.state.delay_period + 1,
        counterparty: Counterparty {
          ..mock_connection_datum_input.state.counterparty,
          connection_id: mock_connection_id,
        },
      },
      token: AuthToken {
        ..mock_connection_datum_input.token,
        name: "invalid token name",
      },
    }

  connection_datum.is_connection_open_ack_valid(
    mock_connection_datum_input,
    output_connection_datum,
  )
}

test test_is_connection_open_confirm_valid_succeed() {
  let mock_connection_end_input =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }

  let output_connection_datum =
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Open,
      },
    }
  connection_datum.is_connection_open_confirm_valid(
    mock_connection_datum_input,
    output_connection_datum,
  )
}

test test_is_connection_open_confirm_valid_fail_when_input_datum_state_is_not_tryopen() fail {
  let mock_connection_end_input =
    create_mock_connection_end(state.Init, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }

  let output_connection_datum =
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Open,
      },
    }
  connection_datum.is_connection_open_confirm_valid(
    mock_connection_datum_input,
    output_connection_datum,
  )
}

test test_is_connection_open_confirm_valid_fail_when_output_datum_state_is_not_open() fail {
  let mock_connection_end_input =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }

  let output_connection_datum =
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.TryOpen,
      },
    }
  connection_datum.is_connection_open_confirm_valid(
    mock_connection_datum_input,
    output_connection_datum,
  )
}

test test_is_connection_open_confirm_valid_fail_when_output_datum_state_not_match_with_expected_datum_state() fail {
  let mock_connection_end_input =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }

  let output_connection_datum =
    ConnectionDatum {
      ..mock_connection_datum_input,
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        delay_period: mock_connection_datum_input.state.delay_period + 1,
        state: state.Open,
      },
    }
  connection_datum.is_connection_open_confirm_valid(
    mock_connection_datum_input,
    output_connection_datum,
  )
}

test test_is_connection_open_confirm_valid_fail_when_output_datum_token_not_match_with_expected_datum_token() fail {
  let mock_connection_end_input =
    create_mock_connection_end(state.TryOpen, mock_connection_id)
  let mock_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_connection_datum_input =
    ConnectionDatum { state: mock_connection_end_input, token: mock_auth_token }

  let output_connection_datum =
    ConnectionDatum {
      state: ConnectionEnd {
        ..mock_connection_datum_input.state,
        state: state.Open,
      },
      token: AuthToken {
        ..mock_connection_datum_input.token,
        name: "invalid token name",
      },
    }

  connection_datum.is_connection_open_confirm_valid(
    mock_connection_datum_input,
    output_connection_datum,
  )
}
