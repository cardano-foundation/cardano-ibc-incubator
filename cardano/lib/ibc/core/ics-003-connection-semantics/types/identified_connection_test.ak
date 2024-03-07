use aiken/list
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/identified_connection.{
  IdentifiedConnection,
}
use ibc/core/ics_003_connection_semantics/types/state
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}

const mock_client_id = "client_id"

const mock_counterparty_client_id = "counterparty_client_id"

const mock_connection_id = "connection_id"

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

test test_new_identified_connection() {
  let mock_connection_end = create_mock_connection_end()
  identified_connection.new_identified_connection(
    mock_connection_id,
    mock_connection_end,
  ) == IdentifiedConnection {
    id: mock_connection_id,
    client_id: mock_connection_end.client_id,
    versions: mock_connection_end.versions,
    state: mock_connection_end.state,
    counterparty: mock_connection_end.counterparty,
    delay_period: mock_connection_end.delay_period,
  }
}

test test_validate_basic() {
  let mock_connection_end = create_mock_connection_end()
  let mock_counterparty =
    Counterparty {
      client_id: mock_counterparty_client_id,
      connection_id: mock_counterparty_connection_id,
      prefix: MerklePrefix { key_prefix: mock_key_prefix },
    }
  let mock_identifier_connection =
    IdentifiedConnection {
      id: mock_connection_id,
      client_id: mock_connection_end.client_id,
      versions: mock_connection_end.versions,
      state: mock_connection_end.state,
      counterparty: mock_connection_end.counterparty,
      delay_period: mock_connection_end.delay_period,
    }
  let test_cases: List<(IdentifiedConnection, Bool)> =
    [
      (mock_identifier_connection, True),
      //identified connection id
      (
        IdentifiedConnection { ..mock_identifier_connection, id: "lowercaseid" },
        True,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          id: "._+-#[]<>._+-#[]<>",
        },
        True,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          id: "lower._+-#[]<>",
        },
        True,
      ),
      (
        IdentifiedConnection { ..mock_identifier_connection, id: "1234567890" },
        True,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          client_id: "NOTLOWERCASE",
        },
        True,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          client_id: "1234567890",
        },
        True,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          client_id: "               ",
        },
        False,
      ),
      (
        IdentifiedConnection { ..mock_identifier_connection, client_id: "1" },
        False,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          client_id: "this identifier is too long to be used as a valid identifier",
        },
        False,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          client_id: "lower/case/id",
        },
        False,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          client_id: "(clientid)",
        },
        False,
      ),
      (
        IdentifiedConnection { ..mock_identifier_connection, client_id: "" },
        False,
      ),
      //version
      //version length must greater than 0
      (
        IdentifiedConnection { ..mock_identifier_connection, versions: [] },
        False,
      ),
      //validate version
      //identifier must not be empty
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          versions: [
            Version { identifier: "", features: [mock_feature] },
            Version { identifier: mock_identifier, features: [mock_feature] },
          ],
        },
        False,
      ),
      //feature must not be empty
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
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
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            prefix: MerklePrefix { key_prefix: "" },
          },
        },
        False,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty { ..mock_counterparty, connection_id: "" },
        },
        True,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "lowercaseid",
          },
        },
        True,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "._+-#[]<>._+-#[]<>",
          },
        },
        True,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "lower._+-#[]<>",
          },
        },
        True,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "NOTLOWERCASE",
          },
        },
        True,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "1234567890",
          },
        },
        True,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "               ",
          },
        },
        False,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty { ..mock_counterparty, connection_id: "1" },
        },
        False,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "this identifier is too long to be used as a valid identifier",
          },
        },
        False,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "lower/case/id",
          },
        },
        False,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            connection_id: "(clientid)",
          },
        },
        False,
      ),
      //counterparty client Id
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "lowercaseid",
          },
        },
        True,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "._+-#[]<>._+-#[]<>",
          },
        },
        True,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "lower._+-#[]<>",
          },
        },
        True,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "1234567890",
          },
        },
        True,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "NOTLOWERCASE",
          },
        },
        True,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "               ",
          },
        },
        False,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty { ..mock_counterparty, client_id: "1" },
        },
        False,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "this identifier is too long to be used as a valid identifier",
          },
        },
        False,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "lower/case/id",
          },
        },
        False,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty {
            ..mock_counterparty,
            client_id: "(clientid)",
          },
        },
        False,
      ),
      (
        IdentifiedConnection {
          ..mock_identifier_connection,
          counterparty: Counterparty { ..mock_counterparty, client_id: "" },
        },
        False,
      ),
    ]
  test_cases
    |> list.all(
         fn(case) { identified_connection.validate_basic(case.1st) == case.2nd },
       )
}
