use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateDatum, Sealed, ShuttingDown, empty_ibc_state_root,
}
use ibc/core/ics_025_handler_interface/reclamation

const policy = #"11111111111111111111111111111111111111111111111111111111"

const deployer = #"22222222222222222222222222222222222222222222222222222222"

fn state(
  version: Int,
  live_client_count: Int,
  live_connection_count: Int,
  live_channel_count: Int,
) -> HostState {
  HostState {
    version,
    ibc_state_root: empty_ibc_state_root,
    next_client_sequence: 0,
    next_connection_sequence: 0,
    next_channel_sequence: 0,
    bound_port: [],
    last_update_time: 0,
    live_client_count,
    live_connection_count,
    live_channel_count,
  }
}

fn active_datum(state: HostState) -> HostStateDatum {
  HostStateDatum { state, nft_policy: policy, deployer, shutdown: Active }
}

test initialization_requires_zero_live_counts() {
  and {
    host_state.is_initialized_valid(active_datum(state(0, 0, 0, 0)), policy),
    !host_state.is_initialized_valid(active_datum(state(0, 1, 0, 0)), policy),
  }
}

test client_creation_increments_only_the_live_client_count() {
  let old = active_datum(state(0, 0, 0, 0))
  let new =
    HostStateDatum {
      ..old,
      state: HostState {
        ..old.state,
        version: 1,
        next_client_sequence: 1,
        live_client_count: 1,
      },
    }

  and {
    host_state.validate_create_client(old, new),
    !host_state.validate_create_client(
      old,
      HostStateDatum {
        ..new,
        state: HostState { ..new.state, live_connection_count: 1 },
      },
    ),
  }
}

test live_count_decrement_rejects_underflow() {
  and {
    host_state.validate_live_channel_count_decrement(
      state(0, 2, 3, 1),
      state(0, 2, 3, 0),
    ),
    !host_state.validate_live_channel_count_decrement(
      state(0, 2, 3, 0),
      state(0, 2, 3, -1),
    ),
  }
}

test drained_shutdown_seals_for_the_fixed_proof_window() {
  let old =
    HostStateDatum {
      ..active_datum(state(4, 0, 0, 0)),
      shutdown: ShuttingDown { initiated_at: 100, grace_period_end: 1_000 },
    }
  let new =
    HostStateDatum {
      ..old,
      state: HostState { ..old.state, version: 5, last_update_time: 1_000 },
      shutdown: Sealed {
        sealed_at: 1_000,
        proof_window_end: reclamation.proof_window_end(1_000),
      },
    }

  and {
    host_state.validate_seal_shutdown(old, new, 1_000),
    !host_state.is_host_state_reclaimable(
      new,
      reclamation.proof_window_end(1_000) - 1,
    ),
    host_state.is_host_state_reclaimable(
      new,
      reclamation.proof_window_end(1_000),
    ),
  }
}
