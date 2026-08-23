use aiken/cbor
use cardano/transaction.{OutputReference}
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateDatum, ReferenceScriptIdentity,
  ReferenceScriptRegistration, Sealed, ShuttingDown, empty_ibc_state_root,
  empty_reference_script_inventory_root,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  FinalizeReferenceScriptRegistration, HostStateRedeemer,
  ReclaimReferenceScripts, RegisterReferenceScripts,
}

const policy = #"11111111111111111111111111111111111111111111111111111111"

const deployer = #"22222222222222222222222222222222222222222222222222222222"

const ref_1 =
  OutputReference {
    transaction_id: #"0101010101010101010101010101010101010101010101010101010101010101",
    output_index: 0,
  }

const ref_2 =
  OutputReference {
    transaction_id: #"0202020202020202020202020202020202020202020202020202020202020202",
    output_index: 0,
  }

const ref_3 =
  OutputReference {
    transaction_id: #"0303030303030303030303030303030303030303030303030303030303030303",
    output_index: 0,
  }

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
    last_update_time: version,
    live_client_count,
    live_connection_count,
    live_channel_count,
  }
}

fn active_datum(state: HostState) -> HostStateDatum {
  HostStateDatum {
    state,
    nft_policy: policy,
    deployer,
    shutdown: Active,
    live_reference_script_count: None,
    reference_script_inventory_root: empty_reference_script_inventory_root,
    reference_script_registration: None,
  }
}

fn identity(
  output_reference: OutputReference,
  reference_script_hash,
) -> ReferenceScriptIdentity {
  ReferenceScriptIdentity { output_reference, reference_script_hash }
}

fn identity_1() -> ReferenceScriptIdentity {
  // The first registered identity is the HostState STT reference script.
  identity(ref_1, #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1")
}

fn host_script_hash() {
  identity_1().reference_script_hash
}

fn identity_2() -> ReferenceScriptIdentity {
  identity(ref_2, #"a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2")
}

fn identity_3() -> ReferenceScriptIdentity {
  identity(ref_3, #"a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3")
}

fn registration(
  target_count: Int,
  target_root: ByteArray,
  last_out_ref: OutputReference,
) -> ReferenceScriptRegistration {
  ReferenceScriptRegistration { target_count, target_root, last_out_ref }
}

test initialization_requires_empty_unregistered_inventory() {
  and {
    host_state.is_initialized_valid(active_datum(state(0, 0, 0, 0)), policy),
    !host_state.is_initialized_valid(active_datum(state(0, 1, 0, 0)), policy),
    !host_state.is_initialized_valid(
      HostStateDatum {
        ..active_datum(state(0, 0, 0, 0)),
        live_reference_script_count: Some(0),
      },
      policy,
    ),
    !host_state.is_initialized_valid(
      HostStateDatum {
        ..active_datum(state(0, 0, 0, 0)),
        reference_script_inventory_root: #"1111111111111111111111111111111111111111111111111111111111111111",
      },
      policy,
    ),
  }
}

test ordinary_transitions_preserve_the_complete_reference_inventory_state() {
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
    !host_state.validate_reference_inventory_preserved(
      old,
      HostStateDatum {
        ..new,
        reference_script_inventory_root: #"1111111111111111111111111111111111111111111111111111111111111111",
      },
    ),
    !host_state.validate_reference_inventory_preserved(
      old,
      HostStateDatum { ..new, live_reference_script_count: Some(1) },
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

test client_updates_are_allowed_only_strictly_before_the_shutdown_cutoff() {
  let old =
    HostStateDatum {
      ..active_datum(state(4, 1, 0, 0)),
      shutdown: ShuttingDown { initiated_at: 100, grace_period_end: 1_000 },
    }
  let new =
    HostStateDatum {
      ..old,
      state: HostState { ..old.state, version: old.state.version + 1 },
    }
  and {
    host_state.validate_update_client(old, new, 999),
    !host_state.validate_update_client(old, new, 1_000),
    !host_state.validate_update_client(old, new, 1_001),
  }
}

test shutdown_entry_requires_an_exact_finalized_inventory() {
  let target_root =
    host_state.append_reference_script_identities(
      empty_reference_script_inventory_root,
      [identity_1(), identity_2(), identity_3()],
    )
  let old =
    HostStateDatum {
      ..active_datum(state(1, 0, 0, 0)),
      live_reference_script_count: Some(3),
      reference_script_inventory_root: target_root,
      reference_script_registration: Some(registration(3, target_root, ref_3)),
    }
  let initiated_at = 100
  let grace_period_end = 1_000
  let new =
    HostStateDatum {
      ..old,
      state: HostState {
        ..old.state,
        version: old.state.version + 1,
        last_update_time: initiated_at,
      },
      shutdown: ShuttingDown { initiated_at, grace_period_end },
    }
  and {
    host_state.validate_enter_shutdown(old, new, grace_period_end, initiated_at),
    !host_state.validate_enter_shutdown(
      HostStateDatum { ..old, live_reference_script_count: Some(-3) },
      HostStateDatum { ..new, live_reference_script_count: Some(-3) },
      grace_period_end,
      initiated_at,
    ),
    !host_state.validate_enter_shutdown(
      active_datum(state(1, 0, 0, 0)),
      new,
      grace_period_end,
      initiated_at,
    ),
  }
}

test registration_precommits_then_accumulates_canonical_batches_and_finalizes() {
  let first_root =
    host_state.append_reference_script_identities(
      empty_reference_script_inventory_root,
      [identity_1(), identity_2()],
    )
  let target_root =
    host_state.append_reference_script_identities(first_root, [identity_3()])
  let target_count = 3
  let old = active_datum(state(0, 0, 0, 0))
  let first =
    HostStateDatum {
      ..old,
      state: HostState { ..old.state, version: 1, last_update_time: 1 },
      live_reference_script_count: Some(-2),
      reference_script_inventory_root: first_root,
      reference_script_registration: Some(
        registration(target_count, target_root, ref_2),
      ),
    }
  let complete =
    HostStateDatum {
      ..first,
      state: HostState { ..first.state, version: 2, last_update_time: 2 },
      live_reference_script_count: Some(-3),
      reference_script_inventory_root: target_root,
      reference_script_registration: Some(
        registration(target_count, target_root, ref_3),
      ),
    }
  let finalized =
    HostStateDatum {
      ..complete,
      state: HostState { ..complete.state, version: 3, last_update_time: 3 },
      live_reference_script_count: Some(3),
    }
  let early_finalize =
    HostStateDatum {
      ..first,
      state: HostState { ..first.state, version: 2, last_update_time: 2 },
      live_reference_script_count: Some(2),
    }
  and {
    // The Host reference is deliberately first; the non-Host tail is canonical.
    host_state.validate_register_reference_scripts(
      old,
      first,
      [identity_1(), identity_2()],
      2,
      True,
      host_script_hash(),
      target_count,
      target_root,
    ),
    host_state.validate_register_reference_scripts(
      first,
      complete,
      [identity_3()],
      2,
      True,
      host_script_hash(),
      target_count,
      target_root,
    ),
    host_state.validate_finalize_reference_script_registration(
      complete,
      finalized,
    ),
    !host_state.validate_finalize_reference_script_registration(
      first,
      early_finalize,
    ),
    // A lower outref cannot be moved into a later registration batch.
    !host_state.validate_register_reference_scripts(
      first,
      HostStateDatum {
        ..complete,
        reference_script_inventory_root: host_state.append_reference_script_identities(
          first_root,
          [identity_1()],
        ),
        reference_script_registration: Some(
          registration(target_count, target_root, ref_1),
        ),
      },
      [identity_1()],
      1,
      True,
      host_script_hash(),
      target_count,
      target_root,
    ),
    // Partial registration blocks all ordinary Host transitions.
    !host_state.validate_reference_inventory_preserved(
      first,
      HostStateDatum {
        ..first,
        state: HostState { ..first.state, version: 2, last_update_time: 2 },
      },
    ),
  }
}

test reference_inventory_target_count_is_protocol_bounded() {
  let old = active_datum(state(0, 0, 0, 0))
  let target_root =
    host_state.fold_reference_script_identities_in_order(
      empty_reference_script_inventory_root,
      [identity_1(), identity_2()],
    )
  let new =
    HostStateDatum {
      ..old,
      state: HostState { ..old.state, version: 1, last_update_time: 1 },
      live_reference_script_count: Some(-2),
      reference_script_inventory_root: target_root,
      reference_script_registration: Some(registration(129, target_root, ref_2)),
    }
  !host_state.validate_register_reference_scripts(
    old,
    new,
    [identity_1(), identity_2()],
    2,
    True,
    host_script_hash(),
    129,
    target_root,
  )
}

test reference_inventory_wire_encodings_are_stable() {
  let register: HostStateRedeemer =
    RegisterReferenceScripts {
      target_count: 3,
      target_root: #"1111111111111111111111111111111111111111111111111111111111111111",
      batch_out_refs: [ref_1, ref_2],
    }
  let reclaim: HostStateRedeemer =
    ReclaimReferenceScripts {
      predecessor_root: empty_reference_script_inventory_root,
    }
  let finalize: HostStateRedeemer = FinalizeReferenceScriptRegistration
  and {
    cbor.serialise(register) == #"d9050e9f03582011111111111111111111111111111111111111111111111111111111111111119fd8799f5820010101010101010101010101010101010101010101010101010101010101010100ffd8799f5820020202020202020202020202020202020202020202020202020202020202020200ffffff",
    cbor.serialise(reclaim) == #"d9050f9f58200000000000000000000000000000000000000000000000000000000000000000ff",
    cbor.serialise(finalize) == #"d9051080",
    cbor.serialise(identity_1()) == #"d8799fd8799f5820010101010101010101010101010101010101010101010101010101010101010100ff581ca1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1ff",
  }
}

test reference_inventory_root_matches_the_gateway_golden_vector() {
  let first =
    identity(
      OutputReference {
        transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
        output_index: 0,
      },
      #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )
  let second =
    identity(
      OutputReference {
        transaction_id: #"2222222222222222222222222222222222222222222222222222222222222222",
        output_index: 7,
      },
      #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    )

  host_state.append_reference_script_identities(
    empty_reference_script_inventory_root,
    // Deliberately reversed: canonical outref sorting is part of consensus.
    [second, first],
  ) == #"8ab929a509199835bfa494bc353cd86a2b86eac5599e1e24ac4f6aed3690094f"
}

test reference_inventory_reclaims_suffixes_to_the_host_only_terminal_state() {
  let root_after_first =
    host_state.append_reference_script_identities(
      empty_reference_script_inventory_root,
      [identity_1()],
    )
  let target_root =
    host_state.append_reference_script_identities(
      root_after_first,
      [identity_2(), identity_3()],
    )
  let registration = registration(3, target_root, ref_3)
  let shutdown = Sealed { sealed_at: 1_000, proof_window_end: 2_000 }
  let old =
    HostStateDatum {
      state: HostState { ..state(4, 0, 0, 0), last_update_time: 1_000 },
      nft_policy: policy,
      deployer,
      shutdown,
      live_reference_script_count: Some(3),
      reference_script_inventory_root: target_root,
      reference_script_registration: Some(registration),
    }
  let intermediate =
    HostStateDatum {
      ..old,
      state: HostState { ..old.state, version: 5, last_update_time: 2_001 },
      live_reference_script_count: Some(1),
      reference_script_inventory_root: root_after_first,
    }
  let forbidden_successor =
    HostStateDatum {
      ..intermediate,
      state: HostState {
        ..intermediate.state,
        version: 6,
        last_update_time: 2_002,
      },
      live_reference_script_count: Some(0),
      reference_script_inventory_root: empty_reference_script_inventory_root,
    }
  let forbidden_early_host_successor =
    HostStateDatum {
      ..old,
      state: HostState { ..old.state, version: 5, last_update_time: 2_001 },
      live_reference_script_count: Some(0),
      reference_script_inventory_root: empty_reference_script_inventory_root,
    }
  and {
    host_state.validate_reclaim_reference_scripts(
      old,
      intermediate,
      [identity_3(), identity_2()],
      root_after_first,
      2_000,
      host_script_hash(),
    ),
    !host_state.validate_reclaim_reference_scripts(
      intermediate,
      forbidden_successor,
      [identity_1()],
      empty_reference_script_inventory_root,
      2_000,
      host_script_hash(),
    ),
    !host_state.validate_reclaim_reference_scripts(
      old,
      forbidden_early_host_successor,
      [identity_1(), identity_2(), identity_3()],
      empty_reference_script_inventory_root,
      2_000,
      host_script_hash(),
    ),
    host_state.is_host_state_reclaimable_with_terminal_reference(
      intermediate,
      identity_1(),
      2_000,
      host_script_hash(),
    ),
    !host_state.validate_reclaim_reference_scripts(
      old,
      intermediate,
      [identity_2()],
      root_after_first,
      2_000,
      host_script_hash(),
    ),
    !host_state.validate_reclaim_reference_scripts(
      old,
      intermediate,
      [
        identity_2(),
        identity(
          ref_3,
          #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        ),
      ],
      root_after_first,
      2_000,
      host_script_hash(),
    ),
    !host_state.validate_reclaim_reference_scripts(
      old,
      intermediate,
      [identity_2(), identity_3()],
      #"4444444444444444444444444444444444444444444444444444444444444444",
      2_000,
      host_script_hash(),
    ),
    !host_state.validate_reclaim_reference_scripts(
      old,
      intermediate,
      [identity_2(), identity_3()],
      root_after_first,
      1_999,
      host_script_hash(),
    ),
    !host_state.is_host_state_reclaimable_with_terminal_reference(
      HostStateDatum {
        ..intermediate,
        reference_script_inventory_root: empty_reference_script_inventory_root,
      },
      identity_1(),
      2_000,
      host_script_hash(),
    ),
  }
}
