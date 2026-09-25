use aiken/collection/list
use aiken/fuzz
use ibc/auth
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateControl, HostStateDatum, ModuleRegistration,
  ShuttingDown, validate_create_channel, validate_create_client,
  validate_create_connection, validate_retire_state, validate_update_only_root,
}

fn fixture(seed: Int) -> HostStateDatum {
  HostStateDatum {
    state: HostState {
      version: seed,
      ibc_state_root: "old root",
      next_client_sequence: seed + 1,
      next_connection_sequence: seed + 2,
      next_channel_sequence: seed + 3,
      bound_port: [],
      last_update_time: seed,
    },
    nft_policy: "policy",
    deployer: "deployer",
    control: HostStateControl {
      port_registry: [],
      shutdown: Active,
      live_clients: 0,
      live_connections: 0,
      live_channels: 0,
    },
  }
}

test retirement_decrements_only_the_selected_live_count() {
  let initial = fixture(0)
  let old =
    HostStateDatum {
      ..initial,
      control: HostStateControl {
        ..initial.control,
        live_clients: 1,
        live_connections: 1,
        live_channels: 1,
      },
    }
  let next =
    HostStateDatum {
      ..old,
      state: HostState { ..old.state, version: old.state.version + 1 },
      control: HostStateControl { ..old.control, live_clients: 0 },
    }
  and {
    validate_retire_state(old, next, 0),
    !validate_retire_state(old, next, 1),
    !validate_retire_state(old, next, 2),
    !validate_retire_state(old, next, 3),
    !validate_retire_state(next, next, 0),
  }
}

fn rejects_protected_field_changes(
  old: HostStateDatum,
  new: HostStateDatum,
  validate: fn(HostStateDatum, HostStateDatum) -> Bool,
) -> Bool {
  and {
    validate(old, new),
    list.all(
      [
        HostStateDatum { ..new, nft_policy: "different policy" },
        HostStateDatum { ..new, deployer: "different deployer" },
        HostStateDatum {
          ..new,
          control: HostStateControl {
            ..new.control,
            port_registry: [
              Pair(
                "transfer",
                ModuleRegistration {
                  module_script_hash: "module",
                  port_token: auth.AuthToken { policy_id: "port", name: "port" },
                  module_token: auth.AuthToken {
                    policy_id: "module",
                    name: "module",
                  },
                },
              ),
            ],
          },
        },
        HostStateDatum {
          ..new,
          control: HostStateControl {
            ..new.control,
            shutdown: ShuttingDown { initiated_at: 0, grace_period_end: 1 },
          },
        },
        HostStateDatum {
          ..new,
          state: HostState { ..new.state, version: old.state.version },
        },
        HostStateDatum {
          ..new,
          state: HostState { ..new.state, bound_port: [1] },
        },
        HostStateDatum {
          ..new,
          state: HostState {
            ..new.state,
            next_client_sequence: new.state.next_client_sequence + 1,
          },
        },
        HostStateDatum {
          ..new,
          state: HostState {
            ..new.state,
            next_connection_sequence: new.state.next_connection_sequence + 1,
          },
        },
        HostStateDatum {
          ..new,
          state: HostState {
            ..new.state,
            next_channel_sequence: new.state.next_channel_sequence + 1,
          },
        },
      ],
      fn(changed) { !validate(old, changed) },
    ),
  }
}

test sequence_transitions_preserve_protected_fields(seed via fuzz.int()) {
  fuzz.label(@"fuzz.unit.host.state.protected_fields")
  let old = fixture(seed)
  // Root and time can change independently of these field checks. The spending
  // validator separately verifies the root against the operation's witnesses.
  let updated =
    HostStateDatum {
      ..old,
      state: HostState {
        ..old.state,
        version: old.state.version + 1,
        ibc_state_root: "new root",
        last_update_time: seed + 100,
      },
    }
  and {
    rejects_protected_field_changes(old, updated, validate_update_only_root),
    rejects_protected_field_changes(
      old,
      HostStateDatum {
        ..updated,
        state: HostState {
          ..updated.state,
          next_client_sequence: old.state.next_client_sequence + 1,
        },
        control: HostStateControl {
          ..updated.control,
          live_clients: old.control.live_clients + 1,
        },
      },
      validate_create_client,
    ),
    rejects_protected_field_changes(
      old,
      HostStateDatum {
        ..updated,
        state: HostState {
          ..updated.state,
          next_connection_sequence: old.state.next_connection_sequence + 1,
        },
        control: HostStateControl {
          ..updated.control,
          live_connections: old.control.live_connections + 1,
        },
      },
      validate_create_connection,
    ),
    rejects_protected_field_changes(
      old,
      HostStateDatum {
        ..updated,
        state: HostState {
          ..updated.state,
          next_channel_sequence: old.state.next_channel_sequence + 1,
        },
        control: HostStateControl {
          ..updated.control,
          live_channels: old.control.live_channels + 1,
        },
      },
      validate_create_channel,
    ),
  }
}

test shutdown_permits_root_updates_but_no_creation(seed via fuzz.int()) {
  fuzz.label(@"fuzz.unit.host.state.shutdown")
  let old = fixture(seed)
  let old =
    HostStateDatum {
      ..old,
      control: HostStateControl {
        ..old.control,
        shutdown: ShuttingDown {
          initiated_at: seed,
          grace_period_end: seed + 1,
        },
      },
    }
  let updated =
    HostStateDatum {
      ..old,
      state: HostState { ..old.state, version: old.state.version + 1 },
    }
  and {
    validate_update_only_root(old, updated),
    !validate_create_client(
      old,
      HostStateDatum {
        ..updated,
        state: HostState {
          ..updated.state,
          next_client_sequence: old.state.next_client_sequence + 1,
        },
      },
    ),
    !validate_create_connection(
      old,
      HostStateDatum {
        ..updated,
        state: HostState {
          ..updated.state,
          next_connection_sequence: old.state.next_connection_sequence + 1,
        },
      },
    ),
    !validate_create_channel(
      old,
      HostStateDatum {
        ..updated,
        state: HostState {
          ..updated.state,
          next_channel_sequence: old.state.next_channel_sequence + 1,
        },
      },
    ),
  }
}
