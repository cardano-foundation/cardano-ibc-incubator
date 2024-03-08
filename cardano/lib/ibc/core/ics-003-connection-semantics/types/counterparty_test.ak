use aiken/list
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}

const mock_client_id = "client_id"

const mock_connection_id = "connection_id"

const mock_key_prefix = "key_prefix"

test test_new_counterparty() {
  let mock_counterparty =
    Counterparty {
      client_id: mock_client_id,
      connection_id: mock_connection_id,
      prefix: MerklePrefix { key_prefix: mock_key_prefix },
    }
  counterparty.new_counterparty(
    mock_client_id,
    mock_connection_id,
    MerklePrefix { key_prefix: mock_key_prefix },
  ) == mock_counterparty
}

test test_get_client_id() {
  let mock_counterparty =
    Counterparty {
      client_id: mock_client_id,
      connection_id: mock_connection_id,
      prefix: MerklePrefix { key_prefix: mock_key_prefix },
    }
  counterparty.get_client_id(mock_counterparty) == mock_client_id
}

test test_get_connection_id() {
  let mock_counterparty =
    Counterparty {
      client_id: mock_client_id,
      connection_id: mock_connection_id,
      prefix: MerklePrefix { key_prefix: mock_key_prefix },
    }
  counterparty.get_connection_id(mock_counterparty) == mock_connection_id
}

test test_get_prefix() {
  let mock_counterparty =
    Counterparty {
      client_id: mock_client_id,
      connection_id: mock_connection_id,
      prefix: MerklePrefix { key_prefix: mock_key_prefix },
    }
  counterparty.get_prefix(mock_counterparty) == MerklePrefix {
    key_prefix: mock_key_prefix,
  }
}

test test_validate_basic() {
  let mock_counterparty =
    Counterparty {
      client_id: mock_client_id,
      connection_id: mock_connection_id,
      prefix: MerklePrefix { key_prefix: mock_key_prefix },
    }
  let test_cases: List<(Counterparty, Bool)> =
    [
      (
        Counterparty {
          ..mock_counterparty,
          prefix: MerklePrefix { key_prefix: "" },
        },
        False,
      ),
      //connection id
      (Counterparty { ..mock_counterparty, connection_id: "" }, True),
      (Counterparty { ..mock_counterparty, connection_id: "lowercaseid" }, True),
      (
        Counterparty {
          ..mock_counterparty,
          connection_id: "._+-#[]<>._+-#[]<>",
        },
        True,
      ),
      (
        Counterparty { ..mock_counterparty, connection_id: "lower._+-#[]<>" },
        True,
      ),
      (Counterparty { ..mock_counterparty, connection_id: "1234567890" }, True),
      (
        Counterparty { ..mock_counterparty, connection_id: "NOTLOWERCASE" },
        True,
      ),
      (Counterparty { ..mock_counterparty, connection_id: "1234567890" }, True),
      (
        Counterparty { ..mock_counterparty, connection_id: "               " },
        False,
      ),
      (Counterparty { ..mock_counterparty, connection_id: "1" }, False),
      (
        Counterparty {
          ..mock_counterparty,
          connection_id: "this identifier is too long to be used as a valid identifier",
        },
        False,
      ),
      (
        Counterparty { ..mock_counterparty, connection_id: "lower/case/id" },
        False,
      ),
      (Counterparty { ..mock_counterparty, connection_id: "(clientid)" }, False),
      //client id
      (Counterparty { ..mock_counterparty, client_id: "lowercaseid" }, True),
      (
        Counterparty { ..mock_counterparty, client_id: "._+-#[]<>._+-#[]<>" },
        True,
      ),
      (Counterparty { ..mock_counterparty, client_id: "lower._+-#[]<>" }, True),
      (Counterparty { ..mock_counterparty, client_id: "1234567890" }, True),
      (Counterparty { ..mock_counterparty, client_id: "NOTLOWERCASE" }, True),
      (Counterparty { ..mock_counterparty, client_id: "1234567890" }, True),
      (
        Counterparty { ..mock_counterparty, client_id: "               " },
        False,
      ),
      (Counterparty { ..mock_counterparty, client_id: "1" }, False),
      (
        Counterparty {
          ..mock_counterparty,
          client_id: "this identifier is too long to be used as a valid identifier",
        },
        False,
      ),
      (Counterparty { ..mock_counterparty, client_id: "lower/case/id" }, False),
      (Counterparty { ..mock_counterparty, client_id: "(clientid)" }, False),
      (Counterparty { ..mock_counterparty, client_id: "" }, False),
    ]
  test_cases
    |> list.all(fn(case) { counterparty.validate_basic(case.1st) == case.2nd })
}
