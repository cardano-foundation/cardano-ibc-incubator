use aiken/list
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/state
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}

const mock_client_id = "client_id"

const mock_counterparty_client_id = "counterparty_client_id"

const mock_counterparty_connection_id = "counterparty_connection_id"

const mock_identifier = "identifier"

const mock_feature = "feature"

const mock_key_prefix = "prefix"

const mock_delay_period = 100

fn create_mock_connection_end() -> ConnectionEnd {
  ConnectionEnd {
    client_id: mock_client_id,
    versions: [
      Version { identifier: mock_identifier, features: [mock_feature] },
    ],
    state: state.Init,
    counterparty: Counterparty {
      client_id: mock_counterparty_client_id,
      connection_id: mock_counterparty_connection_id,
      prefix: MerklePrefix { key_prefix: mock_key_prefix },
    },
    delay_period: mock_delay_period,
  }
}

test test_new_connection_end() {
  let mock_connection_end = create_mock_connection_end()
  connection_end.new_connection_end(
    state.Init,
    mock_client_id,
    Counterparty {
      client_id: mock_counterparty_client_id,
      connection_id: mock_counterparty_connection_id,
      prefix: MerklePrefix { key_prefix: mock_key_prefix },
    },
    [Version { identifier: mock_identifier, features: [mock_feature] }],
    mock_delay_period,
  ) == mock_connection_end
}

test test_get_client_id() {
  let mock_connection_end = create_mock_connection_end()
  connection_end.get_client_id(mock_connection_end) == mock_client_id
}

test test_get_versions() {
  let mock_connection_end = create_mock_connection_end()
  connection_end.get_versions(mock_connection_end) == [
    Version { identifier: mock_identifier, features: [mock_feature] },
  ]
}

test test_get_state() {
  let mock_connection_end = create_mock_connection_end()
  connection_end.get_state(mock_connection_end) == state.Init
}

test test_get_counterparty() {
  let mock_connection_end = create_mock_connection_end()
  connection_end.get_counterparty(mock_connection_end) == Counterparty {
    client_id: mock_counterparty_client_id,
    connection_id: mock_counterparty_connection_id,
    prefix: MerklePrefix { key_prefix: mock_key_prefix },
  }
}

test test_get_delay_period() {
  let mock_connection_end = create_mock_connection_end()
  connection_end.get_delay_period(mock_connection_end) == mock_delay_period
}

test test_validate_basic() {
  let mock_connection_end = create_mock_connection_end()
  let mock_counterparty = mock_connection_end.counterparty
  let test_cases: List<(ConnectionEnd, Bool)> =
    [
      (mock_connection_end, True),
      //connection end client id
      (ConnectionEnd { ..mock_connection_end, client_id: "lowercaseid" }, True),
      (
        ConnectionEnd { ..mock_connection_end, client_id: "._+-#[]<>._+-#[]<>" },
        True,
      ),
      (
        ConnectionEnd { ..mock_connection_end, client_id: "lower._+-#[]<>" },
        True,
      ),
      (ConnectionEnd { ..mock_connection_end, client_id: "1234567890" }, True),
      (ConnectionEnd { ..mock_connection_end, client_id: "NOTLOWERCASE" }, True),
      (ConnectionEnd { ..mock_connection_end, client_id: "1234567890" }, True),
      (
        ConnectionEnd { ..mock_connection_end, client_id: "               " },
        False,
      ),
      (ConnectionEnd { ..mock_connection_end, client_id: "1" }, False),
      (
        ConnectionEnd {
          ..mock_connection_end,
          client_id: "this identifier is too long to be used as a valid identifier",
        },
        False,
      ),
      (
        ConnectionEnd { ..mock_connection_end, client_id: "lower/case/id" },
        False,
      ),
      (ConnectionEnd { ..mock_connection_end, client_id: "(clientid)" }, False),
      (ConnectionEnd { ..mock_connection_end, client_id: "" }, False),
      //version
      //version length must greater than 0
      (ConnectionEnd { ..mock_connection_end, versions: [] }, False),
      //validate version
      //identifier must not be empty
      (
        ConnectionEnd {
          ..mock_connection_end,
          versions: [
            Version { identifier: "", features: [mock_feature] },
            Version { identifier: mock_identifier, features: [mock_feature] },
          ],
        },
        False,
      ),
      //feature must not be empty
      (
        ConnectionEnd {
          ..mock_connection_end,
          versions: [
            Version { identifier: mock_identifier, features: [mock_feature] },
            Version {
              identifier: mock_identifier,
              features: ["", mock_feature],
            },
          ],
        },
        False,
      ),
      //counterparty validate
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            prefix: MerklePrefix { key_prefix: "" },
          },
        },
        False,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty { ..mock_counterparty, connection_id: "" },
        },
        True,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "lowercaseid",
          },
        },
        True,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "._+-#[]<>._+-#[]<>",
          },
        },
        True,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "lower._+-#[]<>",
          },
        },
        True,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "NOTLOWERCASE",
          },
        },
        True,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "1234567890",
          },
        },
        True,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "               ",
          },
        },
        False,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty { ..mock_counterparty, connection_id: "1" },
        },
        False,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "this identifier is too long to be used as a valid identifier",
          },
        },
        False,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "lower/case/id",
          },
        },
        False,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "(clientid)",
          },
        },
        False,
      ),
      //counterparty client Id
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "lowercaseid",
          },
        },
        True,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "._+-#[]<>._+-#[]<>",
          },
        },
        True,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "lower._+-#[]<>",
          },
        },
        True,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "1234567890",
          },
        },
        True,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "NOTLOWERCASE",
          },
        },
        True,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "               ",
          },
        },
        False,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty { ..mock_counterparty, client_id: "1" },
        },
        False,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "this identifier is too long to be used as a valid identifier",
          },
        },
        False,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "lower/case/id",
          },
        },
        False,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "(clientid)",
          },
        },
        False,
      ),
      (
        ConnectionEnd {
          ..mock_connection_end,
          counterparty: Counterparty { ..mock_counterparty, client_id: "" },
        },
        False,
      ),
    ]

  test_cases
    |> list.all(fn(case) { connection_end.validate_basic(case.1st) == case.2nd })
}
