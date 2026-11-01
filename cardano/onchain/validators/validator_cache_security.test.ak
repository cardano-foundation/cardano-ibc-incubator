use cardano/address.{Script, from_script}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Spend, Transaction,
  Withdraw, placeholder,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cached/identity
use ibc/client/ics_007_tendermint_client/cached/types.{
  CacheDatum, CachedUpdate, Record, Update,
}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit
use ibc/client/ics_007_tendermint_client/cometbft/block/header
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/height
use ibc/core/ics_002_client_semantics/types/keys.{client_prefix}
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateControl, HostStateDatum, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{CreateClient}
use spending_validator_cache

const client_script =
  #"11111111111111111111111111111111111111111111111111111111"

const cache_script = #"22222222222222222222222222222222222222222222222222222222"

const update_script =
  #"33333333333333333333333333333333333333333333333333333333"

const policy = #"44444444444444444444444444444444444444444444444444444444"

const host_policy = #"55555555555555555555555555555555555555555555555555555555"

fn ref(index: Int) -> OutputReference {
  OutputReference {
    transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    output_index: index,
  }
}

fn subject() -> AuthToken {
  AuthToken { policy_id: policy, name: "client" }
}

fn datum() -> CacheDatum {
  CacheDatum {
    token: AuthToken {
      policy_id: cache_script,
      name: identity.token_name(subject()),
    },
    client_token: subject(),
    client_address: from_script(client_script),
    records: [
      Record {
        root: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        count: 45,
        total_power: 100,
      },
    ],
  }
}

fn cache_tx(cache: CacheDatum) -> Transaction {
  let cache_output =
    Output {
      address: from_script(cache_script),
      value: assets.from_asset(cache.token.policy_id, cache.token.name, 1),
      datum: InlineDatum(cache),
      reference_script: None,
    }
  let client_output =
    Output {
      address: cache.client_address,
      value: assets.from_asset(
        cache.client_token.policy_id,
        cache.client_token.name,
        1,
      ),
      datum: NoDatum,
      reference_script: None,
    }
  let raw: Data =
    CachedUpdate {
      update: Update {
        cache_token: cache.token,
        signed_header: SignedHeader {
          header: header.null_tm_header(),
          commit: commit.null_commit(),
        },
        trusted_height: height.zero_height(),
        target: [],
        target_siblings: [],
        trusted: [],
        trusted_siblings: [],
        sets: [],
        history_siblings: [],
      },
    }
  let subject_data: Data = cache.client_token
  Transaction {
    ..placeholder,
    inputs: [
      Input { output_reference: ref(0), output: cache_output },
      Input { output_reference: ref(1), output: client_output },
    ],
    outputs: [cache_output],
    withdrawals: [Pair(Script(update_script), 0)],
    redeemers: [
      Pair(Spend(ref(1)), raw),
      Pair(Withdraw(Script(update_script)), subject_data),
    ],
  }
}

// These call the cache guard alone. No client guard or update verifier runs
// here, so a failure proves the cache itself enforces the tested condition.
test cache_guard_requires_pinned_verifier_even_for_captured_client() fail {
  let cache = datum()
  let tx = cache_tx(cache)
  spending_validator_cache.spend_validator_cache.spend(
    policy,
    update_script,
    policy,
    Some(cache),
    Void,
    ref(0),
    Transaction { ..tx, withdrawals: [] },
  )
}

test cache_guard_accepts_authorized_unchanged_identity() {
  let cache = datum()
  spending_validator_cache.spend_validator_cache.spend(
    policy,
    update_script,
    policy,
    Some(cache),
    Void,
    ref(0),
    cache_tx(cache),
  )
}

test cache_guard_rejects_changed_client_token_without_client_guard() fail {
  let cache = datum()
  let tx = cache_tx(cache)
  expect [output] = tx.outputs
  spending_validator_cache.spend_validator_cache.spend(
    policy,
    update_script,
    policy,
    Some(cache),
    Void,
    ref(0),
    Transaction {
      ..tx,
      outputs: [
        Output {
          ..output,
          datum: InlineDatum(
            CacheDatum {
              ..cache,
              client_token: AuthToken { policy_id: policy, name: "other" },
            },
          ),
        },
      ],
    },
  )
}

test cache_guard_rejects_changed_client_address_without_client_guard() fail {
  let cache = datum()
  let tx = cache_tx(cache)
  expect [output] = tx.outputs
  spending_validator_cache.spend_validator_cache.spend(
    policy,
    update_script,
    policy,
    Some(cache),
    Void,
    ref(0),
    Transaction {
      ..tx,
      outputs: [
        Output {
          ..output,
          datum: InlineDatum(
            CacheDatum { ..cache, client_address: from_script(policy) },
          ),
        },
      ],
    },
  )
}

test cache_guard_rejects_changed_cache_identity_without_client_guard() fail {
  let cache = datum()
  let tx = cache_tx(cache)
  expect [output] = tx.outputs
  spending_validator_cache.spend_validator_cache.spend(
    policy,
    update_script,
    policy,
    Some(cache),
    Void,
    ref(0),
    Transaction {
      ..tx,
      outputs: [
        Output {
          ..output,
          datum: InlineDatum(
            CacheDatum {
              ..cache,
              token: AuthToken { policy_id: cache_script, name: "other" },
            },
          ),
        },
      ],
    },
  )
}

test cache_guard_rejects_unrelated_name_claiming_subject() fail {
  let original = datum()
  let cache =
    CacheDatum {
      ..original,
      token: AuthToken {
        policy_id: original.token.policy_id,
        name: identity.token_name(
          AuthToken { policy_id: policy, name: "unrelated" },
        ),
      },
    }
  spending_validator_cache.spend_validator_cache.spend(
    policy,
    update_script,
    policy,
    Some(cache),
    Void,
    ref(0),
    cache_tx(cache),
  )
}

fn admission_tx() -> (AuthToken, Transaction) {
  let host =
    HostStateDatum {
      state: HostState {
        version: 0,
        ibc_state_root: #"0000000000000000000000000000000000000000000000000000000000000000",
        next_client_sequence: 0,
        next_connection_sequence: 0,
        next_channel_sequence: 0,
        bound_port: [],
        last_update_time: 0,
      },
      nft_policy: host_policy,
      deployer: client_script,
      control: HostStateControl {
        port_registry: [],
        shutdown: Active,
        live_clients: 0,
        live_connections: 0,
        live_channels: 0,
        last_heartbeat_time: 0,
      },
    }
  let token =
    AuthToken {
      policy_id: policy,
      name: auth.generate_token_name(
        AuthToken { policy_id: host_policy, name: host_state_token_name },
        client_prefix,
        "0",
      ),
    }
  let client =
    Output {
      address: from_script(client_script),
      value: assets.from_asset(policy, token.name, 1),
      datum: NoDatum,
      reference_script: None,
    }
  let host_output =
    Output {
      address: from_script(host_policy),
      value: assets.from_asset(host_policy, host_state_token_name, 1),
      datum: InlineDatum(host),
      reference_script: None,
    }
  let raw: Data =
    CreateClient { client_state_siblings: [], consensus_state_siblings: [] }
  (
    token,
    Transaction {
      ..placeholder,
      inputs: [Input { output_reference: ref(0), output: host_output }],
      outputs: [client],
      redeemers: [Pair(Spend(ref(0)), raw)],
    },
  )
}

test admission_identifies_the_host_created_client() {
  let (token, tx) = admission_tx()
  identity.admitted_client(host_policy, token, tx).address == from_script(
    client_script,
  )
}

test admission_rejects_arbitrary_client_without_host_creation() fail {
  let (token, tx) = admission_tx()
  expect _ =
    identity.admitted_client(
      host_policy,
      token,
      Transaction { ..tx, inputs: [] },
    )
}

test admission_rejects_shadow_token_at_an_unrelated_script() fail {
  let (token, tx) = admission_tx()
  let impostor = AuthToken { policy_id: cache_script, name: token.name }
  let extra =
    Output {
      address: from_script(cache_script),
      value: assets.from_asset(impostor.policy_id, impostor.name, 1),
      datum: NoDatum,
      reference_script: None,
    }
  expect _ =
    identity.admitted_client(
      host_policy,
      impostor,
      Transaction { ..tx, outputs: [extra, ..tx.outputs] },
    )
}
