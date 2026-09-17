// Independent kernel fixtures. These tests call the real validators; they do
// not claim ledger balance, script dispatch, or populated bridge integration.
use aiken/builtin
use aiken/cbor
use aiken/collection/list
use aiken/interval
use aiken/primitive/bytearray
use cardano/address.{Address, Inline, Script, VerificationKey, from_script}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Spend, Transaction, Withdraw,
  placeholder,
}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/types/escrow_datum.{TransferEscrowDatum}
use ibc/apps/transfer/types/transfer_module_datum.{TransferModuleDatum}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  ReclaimTransferWithdrawal,
}
use ibc/core/ics_005/types/ibc_module_redeemer.{ReclaimModule}
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateControl, HostStateDatum, ModuleRegistration,
  ShuttingDown, host_state_token_name, min_shutdown_grace_period_ms,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{EnterShutdown}
use ibc/core/ics_025_handler_interface/ibc_state_commitment as tree
use ibc/implementation/host_state_stt as legacy_host
use ibc/implementation/spending_transfer_module as transfer_dispatch
use ibc/migration/auth as migration
use ibc/migration/types.{
  Activate, Authority, Begin, Cancel, CancelRestoration, Counts, Emergency,
  FixedIdentity, Governance, Implementation, MoveCore, MoveEscrow,
  MoveTransferRoot, Moving, Proposal, Propose, ProposeEmergencyRotation,
  ProposeRestoration, Proposed, Ready, Registry, RegistryRedeemer, Replace,
  Restoration, Restore, Restrict, Rotate, RotateAuthority, minimum_delay_ms,
  registry_token_name,
}
use ibc/utils/string
use implementation_registry
use minting_implementation_registry
use upgradeable/host_state as host_wrapper
use upgradeable/transfer as transfer_wrapper

const approval_upper = 2_000

const ready_at = 86_402_000

const expires_at = 86_412_000

const execution_upper = 86_403_000

type Case {
  old: Registry,
  action: RegistryRedeemer,
  transaction: Transaction,
}

fn hash(n: Int) -> ByteArray {
  bytearray.from_int_big_endian(n, 28)
}

fn ref(n: Int) -> OutputReference {
  OutputReference {
    transaction_id: bytearray.from_int_big_endian(n, 32),
    output_index: 0,
  }
}

fn governance() -> Governance {
  Governance {
    signers: [hash(11), hash(12), hash(13)],
    quorum: 2,
    delay_ms: minimum_delay_ms,
  }
}

fn implementation(generation: Int) -> Implementation {
  Implementation {
    generation,
    addresses: list.map(
      [0, 1, 2, 3, 4],
      fn(role) { from_script(hash(generation * 100 + role)) },
    ),
    compatibility: bytearray.from_int_big_endian(777, 32),
  }
}

fn initial() -> Registry {
  Registry {
    emergency: Emergency {
      authority: Authority {
        signers: [bytearray.from_int_big_endian(999, 28)],
        quorum: 1,
      },
      epoch: 0,
      mask: 0,
      restoration: None,
    },
    token: AuthToken { policy_id: hash(1), name: registry_token_name },
    host_policy: hash(2),
    identity: FixedIdentity {
      client_policy: hash(3),
      connection_policy: hash(4),
      channel_policy: hash(5),
      escrow_policy: hash(6),
      reference_holder: from_script(hash(901)),
    },
    governance: governance(),
    nonce: 0,
    current: implementation(1),
    phase: Ready,
  }
}

fn counts() -> Counts {
  Counts { clients: 2, connections: 1, channels: 1 }
}

fn zeros() -> Counts {
  Counts { clients: 0, connections: 0, channels: 0 }
}

fn siblings() -> List<ByteArray> {
  list.repeat(tree.empty_hash, 64)
}

fn proposal() -> Proposal {
  Replace {
    source_generation: 1,
    nonce: 1,
    target: implementation(2),
    maximum: counts(),
    escrow_inventory: tree.empty_hash,
  }
}

fn approved(plan: Proposal) -> Registry {
  Registry {
    ..initial(),
    nonce: 1,
    phase: Proposed { proposal: plan, ready_at, expires_at },
  }
}

fn registration() -> ModuleRegistration {
  ModuleRegistration {
    module_script_hash: hash(104),
    port_token: AuthToken { policy_id: hash(8), name: "transfer" },
    module_token: AuthToken { policy_id: hash(7), name: "module" },
  }
}

fn host() -> HostStateDatum {
  HostStateDatum {
    nft_policy: hash(2),
    deployer: hash(11),
    state: HostState {
      version: 7,
      ibc_state_root: tree.apply_update(
        tree.empty_hash,
        "ports/transfer",
        "",
        cbor.serialise(registration()),
        siblings(),
      ),
      next_client_sequence: 2,
      next_connection_sequence: 1,
      next_channel_sequence: 1,
      bound_port: [],
      last_update_time: 1_000,
    },
    control: HostStateControl {
      port_registry: [Pair("transfer", registration())],
      shutdown: Active,
    },
  }
}

fn object_output(address: Address, token: AuthToken, datum: Data) -> Output {
  Output {
    address,
    value: assets.from_lovelace(4_000_000)
      |> assets.add(token.policy_id, token.name, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn registry_output(registry: Registry) -> Output {
  object_output(from_script(hash(900)), registry.token, registry)
}

fn host_output(datum: HostStateDatum, generation: Int) -> Output {
  object_output(
    from_script(hash(generation * 100)),
    AuthToken { policy_id: hash(2), name: host_state_token_name },
    datum,
  )
}

fn module_output(root: ByteArray, generation: Int) -> Output {
  let registration = registration()
  let output =
    object_output(
      from_script(hash(generation * 100 + 4)),
      registration.module_token,
      TransferModuleDatum { escrow_shard_registry_root: root },
    )
  Output {
    ..output,
    value: assets.add(
      output.value,
      registration.port_token.policy_id,
      registration.port_token.name,
      1,
    ),
  }
}

fn input(n: Int, output: Output) -> Input {
  Input { output_reference: ref(n), output }
}

fn transition(
  old: Registry,
  new: Registry,
  action: RegistryRedeemer,
  objects: List<Input>,
  outputs: List<Output>,
  lower: Int,
  upper: Int,
  signers: List<ByteArray>,
) -> Case {
  let action_data: Data = action
  let migration_data = builtin.constr_data(100, [])
  Case {
    old,
    action,
    transaction: Transaction {
      ..placeholder,
      inputs: [input(1, registry_output(old)), ..objects],
      outputs: [registry_output(new), ..outputs],
      redeemers: [
        Pair(Spend(ref(1)), action_data),
        ..list.map(
          objects,
          fn(object) { Pair(Spend(object.output_reference), migration_data) },
        )
      ],
      validity_range: interval.between(lower, upper),
      extra_signatories: signers,
    },
  }
}

fn run(case: Case) -> Bool {
  implementation_registry.implementation_registry.spend(
    Some(case.old),
    case.action,
    ref(1),
    case.transaction,
  )
}

fn with_registry_output(case: Case, registry: Registry) -> Case {
  expect [_, ..rest] = case.transaction.outputs
  Case {
    ..case,
    transaction: Transaction {
      ..case.transaction,
      outputs: [registry_output(registry), ..rest],
    },
  }
}

fn with_object_output(case: Case, output: Output) -> Case {
  expect [registry, _] = case.transaction.outputs
  Case {
    ..case,
    transaction: Transaction { ..case.transaction, outputs: [registry, output] },
  }
}

fn output_object(case: Case) -> Output {
  expect [_, output] = case.transaction.outputs
  output
}

fn new_registry(case: Case) -> Registry {
  expect [output, ..] = case.transaction.outputs
  expect InlineDatum(data) = output.datum
  expect registry: Registry = data
  registry
}

fn with_registry_input(case: Case, registry: Registry) -> Case {
  expect [_, ..rest] = case.transaction.inputs
  Case {
    ..case,
    old: registry,
    transaction: Transaction {
      ..case.transaction,
      inputs: [input(1, registry_output(registry)), ..rest],
    },
  }
}

fn extra_script(case: Case) -> Case {
  let extra =
    object_output(
      from_script(hash(999)),
      AuthToken { policy_id: hash(998), name: "unrelated" },
      builtin.constr_data(0, []),
    )
  Case {
    ..case,
    transaction: Transaction {
      ..case.transaction,
      inputs: [input(99, extra), ..case.transaction.inputs],
      outputs: [extra, ..case.transaction.outputs],
    },
  }
}

fn propose(plan: Proposal) -> Case {
  transition(
    initial(),
    approved(plan),
    Propose { proposal: plan, expires_at },
    [],
    [],
    1_000,
    approval_upper,
    [hash(11), hash(12)],
  )
}

fn moving(next: Counts, remaining: ByteArray, moved: Bool) -> Registry {
  Registry {
    ..initial(),
    nonce: 1,
    phase: Moving {
      target: implementation(2),
      limits: counts(),
      next,
      registration: registration(),
      escrow_remaining: remaining,
      module_moved: moved,
    },
  }
}

fn begin() -> Case {
  let old_host = host()
  let updated =
    HostStateDatum {
      ..old_host,
      state: HostState {
        ..old_host.state,
        version: 8,
        last_update_time: execution_upper,
      },
    }
  let case =
    transition(
      approved(proposal()),
      moving(zeros(), tree.empty_hash, False),
      Begin,
      [input(2, host_output(old_host, 1))],
      [host_output(updated, 2)],
      ready_at,
      execution_upper,
      [],
    )
  let published =
    list.map(
      [0, 1, 2, 3, 4],
      fn(role) {
        input(
          20 + role,
          Output {
            ..object_output(
              from_script(hash(901)),
              AuthToken { policy_id: hash(50), name: "publication" },
              builtin.constr_data(0, []),
            ),
            reference_script: Some(hash(200 + role)),
          },
        )
      },
    )
  Case {
    ..case,
    transaction: Transaction {
      ..case.transaction,
      reference_inputs: [
        input(3, module_output(tree.empty_hash, 1)),
        ..published
      ],
    },
  }
}

fn core_token(role: Int, sequence: Int) -> AuthToken {
  let prefix =
    when role is {
      1 -> "ibc_client"
      2 -> "connection"
      3 -> "channel"
      _ -> fail
    }
  AuthToken {
    policy_id: hash(role + 2),
    name: auth.generate_token_name(
      AuthToken { policy_id: hash(2), name: host_state_token_name },
      prefix,
      string.int_to_string(sequence),
    ),
  }
}

fn core(role: Int) -> Case {
  let next =
    when role is {
      1 -> Counts { ..zeros(), clients: 1 }
      2 -> Counts { ..zeros(), connections: 1 }
      3 -> Counts { ..zeros(), channels: 1 }
      _ -> fail
    }
  let old_output =
    object_output(
      from_script(hash(100 + role)),
      core_token(role, 0),
      builtin.constr_data(7, [builtin.b_data("opaque preserved state")]),
    )
  let output = Output { ..old_output, address: from_script(hash(200 + role)) }
  transition(
    moving(zeros(), tree.empty_hash, False),
    moving(next, tree.empty_hash, False),
    MoveCore { role },
    [input(2, old_output)],
    [output],
    ready_at,
    execution_upper,
    [],
  )
}

fn module_move() -> Case {
  transition(
    moving(zeros(), tree.empty_hash, False),
    moving(zeros(), tree.empty_hash, True),
    MoveTransferRoot,
    [input(2, module_output(tree.empty_hash, 1))],
    [module_output(tree.empty_hash, 2)],
    ready_at,
    execution_upper,
    [],
  )
}

fn escrow() -> Case {
  let datum =
    TransferEscrowDatum {
      channel_id: "channel-0",
      denom: "native-asset",
      escrowed_amount: 100,
    }
  let token =
    AuthToken {
      policy_id: hash(6),
      name: transfer_escrow_shard.shard_token_name(
        datum.channel_id,
        datum.denom,
      ),
    }
  let root =
    tree.apply_update(
      tree.empty_hash,
      transfer_escrow_shard.shard_registry_key(datum.channel_id, datum.denom),
      "",
      #"01",
      siblings(),
    )
  let output = object_output(from_script(hash(104)), token, datum)
  let output =
    Output {
      ..output,
      value: assets.add(output.value, hash(77), "real-escrow-asset", 100),
    }
  transition(
    moving(zeros(), root, False),
    moving(zeros(), tree.empty_hash, False),
    MoveEscrow { siblings: siblings() },
    [input(2, output)],
    [Output { ..output, address: from_script(hash(204)) }],
    ready_at,
    execution_upper,
    [],
  )
}

fn activation() -> Case {
  let original = host()
  let old_host =
    HostStateDatum {
      ..original,
      state: HostState { ..original.state, version: 8 },
    }
  let old_registration = registration()
  let updated_registration =
    ModuleRegistration { ..old_registration, module_script_hash: hash(204) }
  let updated =
    HostStateDatum {
      ..old_host,
      state: HostState {
        ..old_host.state,
        version: 9,
        last_update_time: execution_upper,
        ibc_state_root: tree.apply_update(
          old_host.state.ibc_state_root,
          "ports/transfer",
          cbor.serialise(old_registration),
          cbor.serialise(updated_registration),
          siblings(),
        ),
      },
      control: HostStateControl {
        ..old_host.control,
        port_registry: [Pair("transfer", updated_registration)],
      },
    }
  let old = moving(counts(), tree.empty_hash, True)
  transition(
    old,
    Registry { ..old, current: implementation(2), phase: Ready },
    Activate { port_siblings: siblings() },
    [input(2, host_output(old_host, 2))],
    [host_output(updated, 2)],
    ready_at,
    execution_upper,
    [],
  )
}

fn bootstrap(
  registry: Registry,
  signers: List<ByteArray>,
  include_nonce: Bool,
) -> Bool {
  let nonce_output =
    object_output(
      Address(VerificationKey(hash(11)), None),
      AuthToken { policy_id: hash(80), name: "wallet" },
      builtin.constr_data(0, []),
    )
  let transaction =
    Transaction {
      ..placeholder,
      inputs: if include_nonce {
        [input(88, nonce_output)]
      } else {
        []
      },
      outputs: [registry_output(registry)],
      mint: assets.from_asset(hash(1), registry_token_name, 1),
      extra_signatories: signers,
    }
  minting_implementation_registry.mint_implementation_registry.mint(
    ref(88),
    from_script(hash(900)),
    hash(2),
    governance(),
    initial().emergency.authority,
    builtin.constr_data(0, []),
    hash(1),
    transaction,
  )
}

test migration_adversarial_valid_bootstrap() {
  bootstrap(initial(), [hash(11), hash(12)], True)
}

test migration_adversarial_bootstrap_rejects_missing_authority() fail {
  expect bootstrap(initial(), [hash(11)], True)
  True
}

test migration_adversarial_bootstrap_rejects_missing_nonce() fail {
  expect bootstrap(initial(), [hash(11), hash(12)], False)
  True
}

test migration_adversarial_bootstrap_rejects_duplicate_identity_policy() fail {
  let old = initial()
  expect
    bootstrap(
      Registry {
        ..old,
        identity: FixedIdentity {
          ..old.identity,
          client_policy: old.host_policy,
        },
      },
      [hash(11), hash(12)],
      True,
    )
  True
}

test migration_adversarial_bootstrap_rejects_premigrated_state() fail {
  expect
    bootstrap(
      moving(zeros(), tree.empty_hash, False),
      [hash(11), hash(12)],
      True,
    )
  True
}

test migration_adversarial_valid_approval() {
  run(propose(proposal()))
}

// No emergency transition exists in this ABI. Even the complete governance
// quorum cannot turn a Ready registry into Moving through a control-only
// proposal, or waive the remaining delay by signing Begin.
test containment_current_approval_cannot_directly_enter_moving() {
  let case = propose(proposal())
  expect run(case)
  !run(with_registry_output(case, moving(zeros(), tree.empty_hash, False)))
}

test migration_adversarial_approval_rejects_missing_quorum() fail {
  let case = propose(proposal())
  expect
    run(
      Case {
        ..case,
        transaction: Transaction {
          ..case.transaction,
          extra_signatories: [hash(11)],
        },
      },
    )
  True
}

test migration_adversarial_duplicate_signature_does_not_create_quorum() fail {
  let case = propose(proposal())
  expect
    run(
      Case {
        ..case,
        transaction: Transaction {
          ..case.transaction,
          extra_signatories: [hash(11), hash(11)],
        },
      },
    )
  True
}

test migration_adversarial_approval_rejects_stale_nonce() fail {
  expect Replace { source_generation, target, maximum, escrow_inventory, .. } =
    proposal()
  expect
    run(
      propose(
        Replace {
          source_generation,
          nonce: 0,
          target,
          maximum,
          escrow_inventory,
        },
      ),
    )
  True
}

test migration_adversarial_approval_rejects_wrong_source() fail {
  expect Replace { nonce, target, maximum, escrow_inventory, .. } = proposal()
  expect
    run(
      propose(
        Replace {
          source_generation: 2,
          nonce,
          target,
          maximum,
          escrow_inventory,
        },
      ),
    )
  True
}

test migration_adversarial_approval_rejects_generation_skip() fail {
  expect Replace { source_generation, nonce, maximum, escrow_inventory, .. } =
    proposal()
  expect
    run(
      propose(
        Replace {
          source_generation,
          nonce,
          target: implementation(3),
          maximum,
          escrow_inventory,
        },
      ),
    )
  True
}

test migration_adversarial_approval_rejects_dependency_digest_substitution() fail {
  expect Replace { source_generation, nonce, target, maximum, escrow_inventory } =
    proposal()
  expect
    run(
      propose(
        Replace {
          source_generation,
          nonce,
          target: Implementation { ..target, compatibility: tree.empty_hash },
          maximum,
          escrow_inventory,
        },
      ),
    )
  True
}

test migration_adversarial_approval_rejects_source_role_reuse() fail {
  expect Replace { source_generation, nonce, target, maximum, escrow_inventory } =
    proposal()
  expect [_, ..rest] = target.addresses
  expect
    run(
      propose(
        Replace {
          source_generation,
          nonce,
          target: Implementation {
            ..target,
            addresses: [from_script(hash(100)), ..rest],
          },
          maximum,
          escrow_inventory,
        },
      ),
    )
  True
}

test migration_adversarial_approval_rejects_reduced_delay_in_output() fail {
  let case = propose(proposal())
  let new = new_registry(case)
  expect
    run(
      with_registry_output(
        case,
        Registry {
          ..new,
          phase: Proposed {
            proposal: proposal(),
            ready_at: approval_upper,
            expires_at,
          },
        },
      ),
    )
  True
}

test migration_adversarial_approval_rejects_ordinary_script_piggyback() fail {
  expect run(extra_script(propose(proposal())))
  True
}

test migration_adversarial_authorized_cancel_before_expiry() {
  let old = approved(proposal())
  run(
    transition(
      old,
      Registry { ..old, phase: Ready },
      Cancel,
      [],
      [],
      ready_at,
      execution_upper,
      [hash(11), hash(12)],
    ),
  )
}

test migration_adversarial_permissionless_cancel_after_expiry() {
  let old = approved(proposal())
  run(
    transition(
      old,
      Registry { ..old, phase: Ready },
      Cancel,
      [],
      [],
      expires_at + 1,
      expires_at + 2,
      [],
    ),
  )
}

test migration_adversarial_cancellation_at_exact_expiry_requires_authority() fail {
  let old = approved(proposal())
  expect
    run(
      transition(
        old,
        Registry { ..old, phase: Ready },
        Cancel,
        [],
        [],
        expires_at,
        expires_at + 1,
        [],
      ),
    )
  True
}

test migration_adversarial_cancellation_cannot_rewind_partial_migration() fail {
  let old = moving(zeros(), tree.empty_hash, False)
  expect
    run(
      transition(
        old,
        Registry { ..old, phase: Ready },
        Cancel,
        [],
        [],
        expires_at + 1,
        expires_at + 2,
        [hash(11), hash(12)],
      ),
    )
  True
}

fn rotation() -> Case {
  let next_governance =
    Governance {
      signers: [hash(14), hash(15)],
      quorum: 2,
      delay_ms: minimum_delay_ms,
    }
  let old = approved(Rotate { nonce: 1, governance: next_governance })
  transition(
    old,
    Registry { ..old, governance: next_governance, phase: Ready },
    RotateAuthority,
    [],
    [],
    ready_at,
    execution_upper,
    [],
  )
}

test migration_adversarial_valid_rotation_approval() {
  run(
    propose(
      Rotate {
        nonce: 1,
        governance: Governance {
          signers: [hash(14)],
          quorum: 1,
          delay_ms: minimum_delay_ms,
        },
      },
    ),
  )
}

test migration_adversarial_valid_permissionless_rotation_execution() {
  run(rotation())
}

test migration_adversarial_rotation_cannot_bypass_timelock() fail {
  let case = rotation()
  expect
    run(
      Case {
        ..case,
        transaction: Transaction {
          ..case.transaction,
          validity_range: interval.between(ready_at - 1, ready_at),
        },
      },
    )
  True
}

test migration_adversarial_rotation_cannot_substitute_authority() fail {
  let case = rotation()
  let new = new_registry(case)
  expect
    run(
      with_registry_output(
        case,
        Registry {
          ..new,
          governance: Governance {
            signers: [hash(99)],
            quorum: 1,
            delay_ms: minimum_delay_ms,
          },
        },
      ),
    )
  True
}

test migration_adversarial_rotation_rejects_zero_threshold() fail {
  expect
    run(
      propose(
        Rotate {
          nonce: 1,
          governance: Governance {
            signers: [hash(14)],
            quorum: 0,
            delay_ms: minimum_delay_ms,
          },
        },
      ),
    )
  True
}

test migration_adversarial_rotation_rejects_short_future_delay() fail {
  expect
    run(
      propose(
        Rotate {
          nonce: 1,
          governance: Governance { signers: [hash(14)], quorum: 1, delay_ms: 1 },
        },
      ),
    )
  True
}

test migration_adversarial_valid_begin() {
  run(begin())
}

test migration_adversarial_begin_rejects_counter_above_approved_maximum() fail {
  expect Replace { source_generation, nonce, target, maximum, escrow_inventory } =
    proposal()
  let narrowed =
    Replace {
      source_generation,
      nonce,
      target,
      maximum: Counts { ..maximum, clients: 1 },
      escrow_inventory,
    }
  expect run(with_registry_input(begin(), approved(narrowed)))
  True
}

test migration_adversarial_begin_rejects_changed_escrow_inventory() fail {
  expect Replace { source_generation, nonce, target, maximum, .. } = proposal()
  let stale =
    Replace {
      source_generation,
      nonce,
      target,
      maximum,
      escrow_inventory: bytearray.from_int_big_endian(1, 32),
    }
  expect run(with_registry_input(begin(), approved(stale)))
  True
}

test migration_adversarial_begin_rejects_ordinary_script_piggyback() fail {
  expect run(extra_script(begin()))
  True
}

test migration_adversarial_begin_rejects_unpublished_successors() fail {
  let case = begin()
  expect [module, ..] = case.transaction.reference_inputs
  expect
    run(
      Case {
        ..case,
        transaction: Transaction {
          ..case.transaction,
          reference_inputs: [module],
        },
      },
    )
  True
}

test migration_adversarial_begin_rejects_early_execution() fail {
  let case = begin()
  expect
    run(
      Case {
        ..case,
        transaction: Transaction {
          ..case.transaction,
          validity_range: interval.between(ready_at - 1, execution_upper),
        },
      },
    )
  True
}

test containment_current_begin_with_full_authority_still_rejects_delay_bypass() fail {
  let case = begin()
  expect run(case)
  run(
    Case {
      ..case,
      transaction: Transaction {
        ..case.transaction,
        extra_signatories: governance().signers,
        validity_range: interval.between(ready_at - 1, execution_upper),
      },
    },
  )
}

test migration_adversarial_begin_rejects_expired_approval() fail {
  let case = begin()
  expect
    run(
      Case {
        ..case,
        transaction: Transaction {
          ..case.transaction,
          validity_range: interval.between(expires_at + 1, expires_at + 2),
        },
      },
    )
  True
}

test migration_adversarial_begin_rejects_unrelated_mint() fail {
  let case = begin()
  expect
    run(
      Case {
        ..case,
        transaction: Transaction {
          ..case.transaction,
          mint: assets.from_asset(hash(70), "marker", 1),
        },
      },
    )
  True
}

test migration_adversarial_begin_rejects_withdrawal_side_effect() fail {
  let case = begin()
  expect
    run(
      Case {
        ..case,
        transaction: Transaction {
          ..case.transaction,
          withdrawals: [Pair(Script(hash(71)), 0)],
        },
      },
    )
  True
}

test migration_adversarial_begin_rejects_commitment_mutation() fail {
  let case = begin()
  let output = output_object(case)
  expect InlineDatum(raw) = output.datum
  expect datum: HostStateDatum = raw
  expect
    run(
      with_object_output(
        case,
        Output {
          ..output,
          datum: InlineDatum(
            HostStateDatum {
              ..datum,
              state: HostState {
                ..datum.state,
                ibc_state_root: tree.empty_hash,
              },
            },
          ),
        },
      ),
    )
  True
}

test migration_adversarial_begin_rejects_stake_credential_substitution() fail {
  let case = begin()
  let output = output_object(case)
  expect
    run(
      with_object_output(
        case,
        Output {
          ..output,
          address: Address(
            output.address.payment_credential,
            Some(Inline(VerificationKey(hash(66)))),
          ),
        },
      ),
    )
  True
}

test migration_adversarial_valid_client_move() {
  run(core(1))
}

test migration_adversarial_core_rejects_replay_after_cursor_advance() fail {
  let old = moving(Counts { ..zeros(), clients: 1 }, tree.empty_hash, False)
  let updated = moving(Counts { ..zeros(), clients: 2 }, tree.empty_hash, False)
  let replay = with_registry_input(core(1), old)
  expect run(with_registry_output(replay, updated))
  True
}

test migration_adversarial_valid_connection_move() {
  run(core(2))
}

test migration_adversarial_valid_channel_move() {
  run(core(3))
}

test migration_adversarial_core_move_rejects_omitted_cursor() fail {
  let case = core(1)
  expect
    run(
      with_registry_output(
        case,
        moving(Counts { ..zeros(), clients: 2 }, tree.empty_hash, False),
      ),
    )
  True
}

test migration_adversarial_core_move_rejects_double_script_satisfaction() fail {
  expect run(extra_script(core(1)))
  True
}

test migration_adversarial_core_move_rejects_datum_mutation() fail {
  let case = core(1)
  let output = output_object(case)
  expect
    run(
      with_object_output(
        case,
        Output { ..output, datum: InlineDatum(builtin.constr_data(0, [])) },
      ),
    )
  True
}

test migration_adversarial_core_move_rejects_ada_sweep() fail {
  let case = core(1)
  let output = output_object(case)
  expect
    run(
      with_object_output(
        case,
        Output { ..output, value: assets.add(output.value, "", "", -1) },
      ),
    )
  True
}

test migration_adversarial_core_move_rejects_wrong_destination_role() fail {
  let case = core(1)
  let output = output_object(case)
  expect
    run(
      with_object_output(
        case,
        Output { ..output, address: from_script(hash(202)) },
      ),
    )
  True
}

test migration_adversarial_core_move_rejects_reference_script_loss() fail {
  let case = core(1)
  expect [registry, object] = case.transaction.inputs
  let changed =
    Input {
      ..object,
      output: Output { ..object.output, reference_script: Some(hash(81)) },
    }
  expect
    run(
      Case {
        ..case,
        transaction: Transaction {
          ..case.transaction,
          inputs: [registry, changed],
        },
      },
    )
  True
}

test migration_adversarial_valid_transfer_root_move() {
  run(module_move())
}

test migration_adversarial_root_move_rejects_missing_port_capability() fail {
  let case = module_move()
  expect [registry, object] = case.transaction.inputs
  let token = registration().port_token
  let changed =
    Input {
      ..object,
      output: Output {
        ..object.output,
        value: assets.add(object.output.value, token.policy_id, token.name, -1),
      },
    }
  expect
    run(
      Case {
        ..case,
        transaction: Transaction {
          ..case.transaction,
          inputs: [registry, changed],
        },
      },
    )
  True
}

test migration_adversarial_valid_real_escrow_move_and_inventory_deletion() {
  run(escrow())
}

test migration_adversarial_escrow_move_rejects_value_diversion() fail {
  let case = escrow()
  let output = output_object(case)
  expect
    run(
      with_object_output(
        case,
        Output {
          ..output,
          value: assets.add(output.value, hash(77), "real-escrow-asset", -1),
        },
      ),
    )
  True
}

test migration_adversarial_escrow_move_rejects_obligation_mutation() fail {
  let case = escrow()
  let output = output_object(case)
  expect InlineDatum(raw) = output.datum
  expect datum: TransferEscrowDatum = raw
  expect
    run(
      with_object_output(
        case,
        Output {
          ..output,
          datum: InlineDatum(
            TransferEscrowDatum { ..datum, escrowed_amount: 0 },
          ),
        },
      ),
    )
  True
}

test migration_adversarial_escrow_move_rejects_fake_inventory_proof() fail {
  let case = escrow()
  expect
    run(
      Case {
        ..case,
        action: MoveEscrow {
          siblings: list.repeat(bytearray.from_int_big_endian(1, 32), 64),
        },
      },
    )
  True
}

test migration_adversarial_escrow_move_rejects_phantom_object() fail {
  let case = escrow()
  expect [registry, _] = case.transaction.inputs
  expect
    run(
      Case {
        ..case,
        transaction: Transaction { ..case.transaction, inputs: [registry] },
      },
    )
  True
}

test migration_adversarial_valid_activation() {
  run(activation())
}

test migration_adversarial_activation_rejects_ordinary_script_piggyback() fail {
  expect run(extra_script(activation()))
  True
}

fn incomplete_activation() -> Case {
  let case = activation()
  let old = moving(Counts { ..counts(), clients: 1 }, tree.empty_hash, True)
  expect [_, object] = case.transaction.inputs
  Case {
    ..case,
    old,
    transaction: Transaction {
      ..case.transaction,
      inputs: [input(1, registry_output(old)), object],
    },
  }
}

test migration_adversarial_activation_rejects_omitted_core_state() fail {
  expect run(incomplete_activation())
  True
}

test migration_adversarial_activation_rejects_unmoved_transfer_root() fail {
  let case = activation()
  let old = moving(counts(), tree.empty_hash, False)
  expect [_, object] = case.transaction.inputs
  expect
    run(
      Case {
        ..case,
        old,
        transaction: Transaction {
          ..case.transaction,
          inputs: [input(1, registry_output(old)), object],
        },
      },
    )
  True
}

test migration_adversarial_activation_rejects_remaining_escrow_obligations() fail {
  let case = activation()
  let escrow = escrow()
  expect Moving { escrow_remaining, .. } = escrow.old.phase
  let old = moving(counts(), escrow_remaining, True)
  expect [_, object] = case.transaction.inputs
  expect
    run(
      Case {
        ..case,
        old,
        transaction: Transaction {
          ..case.transaction,
          inputs: [input(1, registry_output(old)), object],
        },
      },
    )
  True
}

test migration_adversarial_activation_rejects_unproved_root_replacement() fail {
  let case = activation()
  let output = output_object(case)
  expect InlineDatum(raw) = output.datum
  expect datum: HostStateDatum = raw
  expect
    run(
      with_object_output(
        case,
        Output {
          ..output,
          datum: InlineDatum(
            HostStateDatum {
              ..datum,
              state: HostState {
                ..datum.state,
                ibc_state_root: tree.empty_hash,
              },
            },
          ),
        },
      ),
    )
  True
}

test migration_adversarial_activation_rejects_wrong_port_witness() fail {
  let case = activation()
  expect
    run(
      Case {
        ..case,
        action: Activate {
          port_siblings: list.repeat(bytearray.from_int_big_endian(1, 32), 64),
        },
      },
    )
  True
}

// Deliberately reduced predicates show these attack fixtures are accepted when
// the named guard is omitted. These are negative controls, not a second kernel.
test migration_adversarial_negative_control_target_only_completion_accepts_omission() {
  let case = incomplete_activation()
  let updated = new_registry(case)
  expect Moving { target, .. } = case.old.phase
  updated.current == target && updated.phase == Ready
}

test migration_adversarial_negative_control_token_only_custody_accepts_escrow_diversion() {
  let case = escrow()
  expect [_, object] = case.transaction.inputs
  let output = output_object(case)
  let diverted =
    Output {
      ..output,
      value: assets.add(output.value, hash(77), "real-escrow-asset", -1),
    }
  expect InlineDatum(raw) = object.output.datum
  expect datum: TransferEscrowDatum = raw
  let token =
    AuthToken {
      policy_id: hash(6),
      name: transfer_escrow_shard.shard_token_name(
        datum.channel_id,
        datum.denom,
      ),
    }
  migration.contains(diverted, token) && diverted.datum == object.output.datum
}

test migration_adversarial_approved_registry_keeps_updates_active() {
  let registry = approved(proposal())
  let transaction =
    Transaction {
      ..placeholder,
      reference_inputs: [input(1, registry_output(registry))],
    }
  let active = migration.active_registry(transaction, registry.token.policy_id)
  active.preparing && active.current.generation == 1
}

test migration_adversarial_channel_creation_rejects_approved_phase() fail {
  let registry = approved(proposal())
  let transaction =
    Transaction {
      ..placeholder,
      reference_inputs: [input(1, registry_output(registry))],
    }
  let (host_policy, _, _, _) =
    migration.channel_creation_context(transaction, registry.token.policy_id)
  host_policy == registry.host_policy
}

test migration_adversarial_partial_decoder_rejects_moving_phase() fail {
  let registry = moving(zeros(), tree.empty_hash, False)
  let transaction =
    Transaction {
      ..placeholder,
      reference_inputs: [input(1, registry_output(registry))],
    }
  let active = migration.active_registry(transaction, registry.token.policy_id)
  active.current.generation == 1
}

fn legacy_shutdown_attempt(registry: Registry) -> Transaction {
  let old = host()
  let next =
    HostStateDatum {
      ..old,
      state: HostState {
        ..old.state,
        version: old.state.version + 1,
        last_update_time: approval_upper,
      },
      control: HostStateControl {
        ..old.control,
        shutdown: ShuttingDown {
          initiated_at: approval_upper,
          grace_period_end: approval_upper + min_shutdown_grace_period_ms,
        },
      },
    }
  Transaction {
    ..placeholder,
    inputs: [input(2, host_output(old, 1))],
    reference_inputs: [input(1, registry_output(registry))],
    outputs: [host_output(next, 1)],
    extra_signatories: [old.deployer],
    validity_range: interval.between(1_000, approval_upper),
  }
}

test migration_adversarial_cleanup_control_has_valid_legacy_authority_and_state() {
  // Same transaction as both rejection cases below. Authentication and the
  // retained legacy transition pass: rejection is not a malformed fixture.
  list.all(
    [initial(), approved(proposal())],
    fn(registry) {
      let transaction = legacy_shutdown_attempt(registry)
      let active = migration.active_spend(transaction, hash(1), 1, 0, ref(2))
      and {
        active.host_policy == hash(2),
        legacy_host.validate(
          True,
          hash(2),
          hash(101),
          hash(102),
          hash(103),
          hash(3),
          hash(4),
          hash(5),
          Some(host()),
          EnterShutdown {
            grace_period_end: approval_upper + min_shutdown_grace_period_ms,
          },
          ref(2),
          transaction,
        ),
      }
    },
  )
}

fn attempt_upgradeable_shutdown(registry: Registry) -> Bool {
  let raw: Data =
    EnterShutdown {
      grace_period_end: approval_upper + min_shutdown_grace_period_ms,
    }
  host_wrapper.host_state.spend(
    hash(1),
    1,
    None,
    raw,
    ref(2),
    legacy_shutdown_attempt(registry),
  )
}

test migration_adversarial_cleanup_rejects_deployer_shutdown_while_active() fail {
  attempt_upgradeable_shutdown(initial())
}

test migration_adversarial_cleanup_rejects_deployer_shutdown_after_approval() fail {
  attempt_upgradeable_shutdown(approved(proposal()))
}

fn restrict_case(old: Registry, mask: Int, signers: List<ByteArray>) -> Case {
  transition(
    old,
    Registry {
      ..old,
      emergency: Emergency {
        ..old.emergency,
        mask,
        epoch: old.emergency.epoch + 1,
        restoration: when old.emergency.restoration is {
          Some(ticket) ->
            if ticket.mask == None {
              Some(ticket)
            } else {
              None
            }
          None -> None
        },
      },
    },
    Restrict { mask },
    [],
    [],
    1000,
    2000,
    signers,
  )
}

fn held(case: Case, mask: Int) -> Case {
  expect run(case)
  let original = case.old
  let destination = new_registry(case)
  case
    |> with_registry_input(
        Registry {
          ..original,
          emergency: Emergency { ..original.emergency, mask },
        },
      )
    |> with_registry_output(
        Registry {
          ..destination,
          emergency: Emergency { ..destination.emergency, mask },
        },
      )
}

test emergency_immediate_before_proposal() {
  run(restrict_case(initial(), 9, [hash(999)]))
}

test emergency_immediate_during_delay() {
  run(restrict_case(approved(proposal()), 9, [hash(999)]))
}

test emergency_immediate_during_migration() {
  run(restrict_case(moving(zeros(), tree.empty_hash, False), 9, [hash(999)]))
}

test emergency_rejects_code_authority_without_emergency_key() fail {
  run(restrict_case(initial(), 9, [hash(11), hash(12), hash(13)]))
}

test emergency_rejects_loosen() fail {
  let old = initial()
  run(
    restrict_case(
      Registry { ..old, emergency: Emergency { ..old.emergency, mask: 9 } },
      1,
      [hash(999)],
    ),
  )
}

test emergency_rejects_code_substitution() fail {
  let case = restrict_case(initial(), 9, [hash(999)])
  expect run(case)
  let output = new_registry(case)
  run(
    with_registry_output(
      case,
      Registry { ..output, current: implementation(7) },
    ),
  )
}

test emergency_hold_rejects_previously_approved_begin() fail {
  run(held(begin(), 8))
}

test emergency_hold_rejects_previously_approved_activation() fail {
  run(held(activation(), 8))
}

test emergency_traffic_restriction_survives_activation() {
  run(held(activation(), 1))
}

test emergency_traffic_restriction_permits_authorized_begin() {
  run(held(begin(), 1))
}

fn restoration_proposal() -> Case {
  let source = initial()
  let old =
    Registry {
      ..source,
      emergency: Emergency { ..source.emergency, mask: 9, epoch: 1 },
    }
  let authority = Authority { signers: [hash(998)], quorum: 1 }
  let new =
    Registry {
      ..old,
      emergency: Emergency {
        ..old.emergency,
        restoration: Some(
          Restoration {
            registry_nonce: old.nonce,
            generation: 1,
            epoch: 1,
            mask: Some(0),
            authority,
            ready_at,
            expires_at,
          },
        ),
      },
    }
  transition(
    old,
    new,
    ProposeRestoration { mask: 0, authority, expires_at },
    [],
    [],
    1000,
    approval_upper,
    [hash(11), hash(12)],
  )
}

fn restoration() -> Case {
  let proposal = restoration_proposal()
  expect run(proposal)
  let old = new_registry(proposal)
  let new =
    Registry {
      ..old,
      emergency: Emergency {
        authority: Authority { signers: [hash(998)], quorum: 1 },
        mask: 0,
        epoch: 2,
        restoration: None,
      },
    }
  transition(old, new, Restore, [], [], ready_at, execution_upper, [])
}

test emergency_restore_delayed_and_permissionless() {
  run(restoration())
}

test emergency_restore_premature_even_with_both_authorities() fail {
  let case = restoration()
  run(
    Case {
      ..case,
      transaction: Transaction {
        ..case.transaction,
        validity_range: interval.between(1000, 2000),
        extra_signatories: [hash(11), hash(12), hash(999)],
      },
    },
  )
}

test emergency_cannot_self_authorize_restoration() fail {
  let case = restoration_proposal()
  run(
    Case {
      ..case,
      transaction: Transaction {
        ..case.transaction,
        extra_signatories: [hash(999)],
      },
    },
  )
}

test emergency_restriction_revokes_pending_restoration() {
  let old = new_registry(restoration_proposal())
  run(restrict_case(old, 9, [hash(999)]))
}

test emergency_stale_restoration_nonce_rejected() fail {
  let case = restoration()
  let old = Registry { ..case.old, nonce: case.old.nonce + 1 }
  let new = Registry { ..new_registry(case), nonce: old.nonce }
  run(case |> with_registry_input(old) |> with_registry_output(new))
}

test emergency_stale_restoration_epoch_rejected() fail {
  let case = restoration()
  let old =
    Registry {
      ..case.old,
      emergency: Emergency { ..case.old.emergency, epoch: 2 },
    }
  run(with_registry_input(case, old))
}

test emergency_cancel_restoration_preserves_restrictions() {
  let old = new_registry(restoration_proposal())
  run(
    transition(
      old,
      Registry {
        ..old,
        emergency: Emergency { ..old.emergency, restoration: None },
      },
      CancelRestoration,
      [],
      [],
      1000,
      2000,
      [hash(11), hash(12)],
    ),
  )
}

test emergency_hold_rejects_escrow_move() fail {
  run(held(escrow(), 8))
}

test emergency_traffic_restriction_permits_escrow_move() {
  run(held(escrow(), 1))
}

test emergency_stale_restoration_generation_rejected() fail {
  let case = restoration()
  let old = Registry { ..case.old, current: implementation(2) }
  let new = Registry { ..new_registry(case), current: old.current }
  run(case |> with_registry_input(old) |> with_registry_output(new))
}

test emergency_rejects_out_of_range_mask() fail {
  run(restrict_case(initial(), 16, [hash(999)]))
}

fn rotating_with_restoration() -> Case {
  let case = rotation()
  expect run(case)
  let ticket = new_registry(restoration_proposal()).emergency.restoration
  let old =
    Registry {
      ..case.old,
      emergency: Emergency {
        ..case.old.emergency,
        mask: 9,
        restoration: ticket,
      },
    }
  let new =
    Registry {
      ..new_registry(case),
      emergency: Emergency { ..old.emergency, restoration: None },
    }
  case |> with_registry_input(old) |> with_registry_output(new)
}

test emergency_rotation_revokes_outgoing_restoration() {
  run(rotating_with_restoration())
}

test emergency_rotation_rejects_retaining_outgoing_restoration() fail {
  let case = rotating_with_restoration()
  let new = new_registry(case)
  run(
    with_registry_output(
      case,
      Registry { ..new, emergency: case.old.emergency },
    ),
  )
}

test emergency_transfer_retirement_stays_disabled_after_size_optimization() {
  let r = registration()
  let withdrawal: Data =
    ReclaimTransferWithdrawal {
      port_unit: bytearray.concat(r.port_token.policy_id, r.port_token.name),
      module_unit: bytearray.concat(
        r.module_token.policy_id,
        r.module_token.name,
      ),
      escrow_policy: hash(6),
    }
  let tx =
    Transaction {
      ..placeholder,
      reference_inputs: [input(9, registry_output(initial()))],
      redeemers: [Pair(Withdraw(Script(hash(900))), withdrawal)],
    }
  // Exact retained dispatch with retirement enabled accepts this witness.
  // Therefore rejection below is its explicit False flag, not a missing witness.
  expect
    transfer_dispatch.validate(
      True,
      r.port_token,
      r.module_token,
      "transfer",
      hash(6),
      hash(5),
      hash(10),
      hash(2),
      hash(900),
      None,
      ReclaimModule,
      ref(2),
      tx,
    )
  expect migration.operation_allowed(tx, hash(1), 1, 1)
  let raw: Data = ReclaimModule
  !transfer_wrapper.transfer.spend(
    hash(1),
    1,
    hash(2),
    hash(5),
    hash(6),
    r.port_token,
    r.module_token,
    hash(10),
    None,
    raw,
    ref(2),
    tx,
  )
}

// The independently constructed expected continuation preserves every phase,
// inventory counter and restriction while replacing only emergency authority.
fn emergency_rotation_proposal(source: Registry) -> Case {
  let authority = Authority { signers: [hash(998)], quorum: 1 }
  let old =
    Registry { ..source, emergency: Emergency { ..source.emergency, mask: 9 } }
  let ticket =
    Restoration {
      registry_nonce: old.nonce,
      generation: old.current.generation,
      epoch: old.emergency.epoch,
      mask: None,
      authority,
      ready_at,
      expires_at,
    }
  transition(
    old,
    Registry {
      ..old,
      emergency: Emergency { ..old.emergency, restoration: Some(ticket) },
    },
    ProposeEmergencyRotation { authority, expires_at },
    [],
    [],
    1000,
    approval_upper,
    [hash(11), hash(12)],
  )
}

fn emergency_rotation_after_repeated_restrictions(source: Registry) -> Case {
  let proposal = emergency_rotation_proposal(source)
  expect run(proposal)
  let first = restrict_case(new_registry(proposal), 9, [hash(999)])
  expect run(first)
  let second = restrict_case(new_registry(first), 15, [hash(999)])
  expect run(second)
  let old = new_registry(second)
  let new =
    Registry {
      ..old,
      emergency: Emergency {
        authority: Authority { signers: [hash(998)], quorum: 1 },
        epoch: old.emergency.epoch + 1,
        mask: 15,
        restoration: None,
      },
    }
  transition(old, new, Restore, [], [], ready_at, execution_upper, [])
}

test emergency_authority_removal_survives_restrictions_ready() {
  run(emergency_rotation_after_repeated_restrictions(initial()))
}

test emergency_authority_removal_survives_restrictions_during_delay() {
  run(emergency_rotation_after_repeated_restrictions(approved(proposal())))
}

test emergency_authority_removal_survives_restrictions_moving() {
  run(
    emergency_rotation_after_repeated_restrictions(
      moving(zeros(), tree.empty_hash, False),
    ),
  )
}

test emergency_removed_authority_cannot_restrict() fail {
  let case = emergency_rotation_after_repeated_restrictions(initial())
  expect run(case)
  run(restrict_case(new_registry(case), 15, [hash(999)]))
}

test emergency_incoming_authority_can_restrict() {
  let case = emergency_rotation_after_repeated_restrictions(initial())
  expect run(case)
  run(restrict_case(new_registry(case), 15, [hash(998)]))
}

test emergency_authority_only_rotation_cannot_loosen() fail {
  let case = emergency_rotation_after_repeated_restrictions(initial())
  expect run(case)
  let destination = new_registry(case)
  run(
    with_registry_output(
      case,
      Registry {
        ..destination,
        emergency: Emergency { ..destination.emergency, mask: 0 },
      },
    ),
  )
}

test emergency_authority_only_rotation_cannot_change_phase() fail {
  let case =
    emergency_rotation_after_repeated_restrictions(
      moving(zeros(), tree.empty_hash, False),
    )
  expect run(case)
  run(
    with_registry_output(case, Registry { ..new_registry(case), phase: Ready }),
  )
}

test emergency_authority_only_rotation_cannot_execute_early() fail {
  let case = emergency_rotation_after_repeated_restrictions(initial())
  expect run(case)
  run(
    Case {
      ..case,
      transaction: Transaction {
        ..case.transaction,
        validity_range: interval.between(1000, 2000),
      },
    },
  )
}

test emergency_authority_only_rotation_requires_governance() fail {
  let case = emergency_rotation_proposal(initial())
  expect run(case)
  run(
    Case {
      ..case,
      transaction: Transaction {
        ..case.transaction,
        extra_signatories: [hash(999)],
      },
    },
  )
}

test emergency_authority_only_rotation_rejects_stale_generation() fail {
  let case = emergency_rotation_after_repeated_restrictions(initial())
  expect run(case)
  let old = Registry { ..case.old, current: implementation(2) }
  let new = Registry { ..new_registry(case), current: old.current }
  run(case |> with_registry_input(old) |> with_registry_output(new))
}

// Cost regressions use the retained pre-optimization gate as an equivalence
// reference. This is a decoder optimization check, not an economic oracle.
fn old_operation_gate(tx: Transaction, generation: Int, bit: Int) -> Bool {
  let token = AuthToken { policy_id: hash(1), name: registry_token_name }
  expect [found] =
    list.filter(
      tx.reference_inputs,
      fn(i) { migration.contains(i.output, token) },
    )
  expect InlineDatum(raw) = found.output.datum
  expect [_,
    _, _, _, _, current, phase, emergency] = builtin.un_constr_data(raw).2nd
  expect [current_generation, _, _] = builtin.un_constr_data(current).2nd
  expect [_, _, mask, _] = builtin.un_constr_data(emergency).2nd
  and {
    builtin.un_constr_data(phase).1st <= 1,
    builtin.un_i_data(current_generation) == generation,
    builtin.un_i_data(mask) / bit % 2 == 0,
  }
}

fn operation_gate_context(registry: Registry) -> Transaction {
  Transaction {
    ..placeholder,
    reference_inputs: list.map(
      list.range(1, 12),
      fn(i) {
        if i == 7 {
          input(i, registry_output(registry))
        } else {
          input(
            i,
            object_output(
              from_script(hash(i + 100)),
              AuthToken { policy_id: hash(i + 100), name: "reference" },
              i,
            ),
          )
        }
      },
    ),
  }
}

test migration_budget_old_gate_cost() {
  old_operation_gate(operation_gate_context(initial()), 1, 1)
}

test migration_budget_new_gate_cost() {
  migration.operation_allowed(operation_gate_context(initial()), hash(1), 1, 1)
}

test migration_budget_gate_all_phases_masks_and_generations() {
  list.all(
    [initial(), approved(proposal()), moving(zeros(), tree.empty_hash, False)],
    fn(source) {
      list.all(
        list.range(0, 15),
        fn(mask) {
          let tx =
            operation_gate_context(
              Registry {
                ..source,
                emergency: Emergency { ..source.emergency, mask },
              },
            )
          list.all(
            [1, 2, 4, 8],
            fn(bit) {
              list.all(
                [1, 2],
                fn(generation) {
                  migration.operation_allowed(tx, hash(1), generation, bit) == old_operation_gate(
                    tx,
                    generation,
                    bit,
                  )
                },
              )
            },
          )
        },
      )
    },
  )
}

test migration_budget_gate_duplicate_registry_rejected() fail {
  let tx = operation_gate_context(initial())
  migration.operation_allowed(
    Transaction {
      ..tx,
      reference_inputs: [
        input(99, registry_output(initial())),
        ..tx.reference_inputs
      ],
    },
    hash(1),
    1,
    1,
  )
}

test migration_budget_gate_missing_registry_rejected() fail {
  let tx = operation_gate_context(initial())
  migration.operation_allowed(tx, hash(999), 1, 1)
}

fn malformed_gate(extra: Bool) -> Bool {
  let source = registry_output(initial())
  expect InlineDatum(raw) = source.datum
  let fields = builtin.un_constr_data(raw).2nd
  let changed =
    if extra {
      list.concat(fields, [builtin.i_data(0)])
    } else {
      builtin.tail_list(fields)
    }
  let tx =
    Transaction {
      ..placeholder,
      reference_inputs: [
        input(
          1,
          Output {
            ..source,
            datum: InlineDatum(builtin.constr_data(0, changed)),
          },
        ),
      ],
    }
  migration.operation_allowed(tx, hash(1), 1, 1)
}

test migration_budget_gate_short_registry_rejected() fail {
  malformed_gate(False)
}

test migration_budget_gate_extra_registry_field_rejected() fail {
  malformed_gate(True)
}
