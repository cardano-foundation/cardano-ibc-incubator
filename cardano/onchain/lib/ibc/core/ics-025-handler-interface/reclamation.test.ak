use aiken/cbor
use ibc/core/ics_025_handler_interface/reclamation

test client_connection_count_path_is_versioned_and_unambiguous() {
  reclamation.client_connection_count_path("07-tendermint-12") == "cardano/dependencies/v1/clients/07-tendermint-12/liveConnections"
}

test dependency_count_uses_canonical_data_encoding() {
  reclamation.encode_count(12) == cbor.serialise(12)
}

test lifecycle_windows_are_fixed_at_seven_days() {
  and {
    reclamation.connection_retirement_not_before(1_000) == 604_801_000,
    reclamation.channel_abandonment_not_before(1_000) == 604_801_000,
    reclamation.proof_window_end(1_000) == 604_801_000,
  }
}

test dependency_count_transitions_do_not_underflow() {
  and {
    reclamation.validate_count_increment(0, 1),
    reclamation.validate_count_decrement(1, 0),
    !reclamation.validate_count_decrement(0, -1),
  }
}

test not_before_is_inclusive() {
  and {
    !reclamation.has_reached_not_before(999, 1_000),
    reclamation.has_reached_not_before(1_000, 1_000),
  }
}
