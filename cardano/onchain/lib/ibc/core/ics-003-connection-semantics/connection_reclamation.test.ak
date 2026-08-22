use ibc/auth.{AuthToken}
use ibc/core/ics_003_connection_semantics/connection_datum.{
  ConnectionActive, ConnectionDatum, Retiring,
}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/state.{Init, Open}
use ibc/core/ics_003_connection_semantics/types/version
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_025_handler_interface/reclamation

fn token() -> AuthToken {
  AuthToken { policy_id: "connection policy", name: "connection token" }
}

fn connection(state, counterparty_connection_id: ByteArray) -> ConnectionEnd {
  ConnectionEnd {
    client_id: "07-tendermint-0",
    versions: version.get_compatible_versions(),
    state,
    counterparty: Counterparty {
      client_id: "07-tendermint-1",
      connection_id: counterparty_connection_id,
      prefix: MerklePrefix { key_prefix: "ibc" },
    },
    delay_period: 0,
  }
}

fn datum(state, live_channel_count: Int) -> ConnectionDatum {
  ConnectionDatum {
    state,
    token: token(),
    live_channel_count,
    lifecycle: ConnectionActive,
  }
}

test channel_count_transitions_preserve_the_connection() {
  let input = datum(connection(Open, "connection-1"), 1)

  and {
    connection_datum.validate_increment_channel_count(
      input,
      ConnectionDatum { ..input, live_channel_count: 2 },
    ),
    connection_datum.validate_decrement_channel_count(
      input,
      ConnectionDatum { ..input, live_channel_count: 0 },
    ),
    !connection_datum.validate_decrement_channel_count(
      ConnectionDatum { ..input, live_channel_count: 0 },
      ConnectionDatum { ..input, live_channel_count: -1 },
    ),
  }
}

test retirement_uses_a_fixed_delay_and_requires_zero_children_to_reclaim() {
  let initiated_at = 10_000
  let not_before = reclamation.connection_retirement_not_before(initiated_at)
  let input = datum(connection(Open, "connection-1"), 0)
  let retiring = ConnectionDatum { ..input, lifecycle: Retiring { not_before } }

  and {
    connection_datum.validate_begin_retirement(
      input,
      retiring,
      initiated_at,
      not_before,
    ),
    !connection_datum.is_reclaimable(retiring, not_before - 1),
    connection_datum.is_reclaimable(retiring, not_before),
  }
}

test retirement_freezes_open_ack_progress() {
  let not_before = reclamation.connection_retirement_not_before(0)
  let input =
    ConnectionDatum {
      ..datum(connection(Init, ""), 0),
      lifecycle: Retiring { not_before },
    }
  let output =
    ConnectionDatum { ..input, state: connection(Open, "connection-1") }

  !connection_datum.is_connection_open_ack_valid(input, output)
}
