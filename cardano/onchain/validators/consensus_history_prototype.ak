// Local emulator prototype, not included in deployment. The fixture seeds the
// initial NFT and trusted checkpoint. This combines the client and its root in
// one output to exercise storage without changing the production HostState ABI.
// It is not a replacement client protocol: creation, recovery, freezing and
// packet handling remain outside this benchmark.
use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/bytearray
use cardano/address.{Credential}
use cardano/assets
use cardano/transaction.{OutputReference, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/consensus_history.{Witness}
use ibc/client/ics_007_tendermint_client/consensus_history_commitment as history
use ibc/client/ics_007_tendermint_client/header.{Header}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/misbehaviour_handle
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase}
use ibc/client/ics_007_tendermint_client/store
use ibc/client/ics_007_tendermint_client/update
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_024_host_requirements/client_keys
use ibc/core/ics_025_handler_interface/ibc_state_commitment as tree
use ibc/utils/string
use ibc/utils/tx_time.{TxTime}
use ibc/utils/validator_utils as utils

pub type State {
  client: ClientDatum,
  ibc_state_root: ByteArray,
}

pub type Update {
  header: Header,
  trusted_witnesses: List<Witness>,
  client_siblings: List<ByteArray>,
  consensus_siblings: List<ByteArray>,
  archive_siblings: List<ByteArray>,
}

pub type Lookup {
  height: Height,
  witness: Option<Witness>,
}

validator consensus_history_prototype(client_token: AuthToken) {
  spend(
    datum: Option<State>,
    redeemer: Update,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(old) = datum
    expect Some(input) = transaction.find_input(tx.inputs, own_ref)
    expect auth.contain_auth_token(input.output, client_token)
    expect old.client.token.policy_id == client_token.policy_id
    expect old.client.token.name == client_token.name
    expect
      assets.quantity_of(tx.mint, client_token.policy_id, client_token.name) == 0
    let output =
      utils.find_unique_continuation_output(
        input.output,
        tx.outputs,
        client_token,
      )
    expect next: State = utils.get_inline_datum(output)
    expect auth.contains_only_auth_tokens(output, [client_token])
    let valid_from = utils.get_tx_valid_from(tx.validity_range)
    let valid_to = utils.get_tx_valid_to(tx.validity_range)
    let now = valid_to * 1_000_000
    expect
      client_state.status(
        old.client.state.client_state,
        now,
        old.client.state.consensus_states,
      ) == Active
    let msg = HeaderCase(redeemer.header)
    let trusted =
      history.consensus_states_for_message(
        old.client,
        old.ibc_state_root,
        redeemer.trusted_witnesses,
        now,
        msg,
      )
    expect
      update.verify_client_message(
        old.client.state.client_state,
        TxTime { valid_from: valid_from * 1_000_000, valid_to: now },
        trusted,
        msg,
      )
    expect !misbehaviour_handle.check_for_misbehaviour(msg, trusted)
    expect
      client_datum.update_state(
        old.client,
        next.client,
        redeemer.header,
        valid_to,
      )
    let client_id =
      bytearray.concat(
        "07-tendermint-",
        auth.extract_token_sequence(client_token.name),
      )
    let after_client =
      tree.apply_update(
        old.ibc_state_root,
        client_keys.full_client_state_path(client_id),
        cbor.serialise(old.client.state.client_state),
        cbor.serialise(next.client.state.client_state),
        redeemer.client_siblings,
      )
    expect [Pair(new_height, new_consensus)] =
      next.client.state.consensus_states
    let after_consensus =
      tree.apply_update(
        after_client,
        client_keys.full_client_consensus_state_path(
          client_id,
          string.int_to_string(new_height.revision_height),
        ),
        "",
        cbor.serialise(new_consensus),
        redeemer.consensus_siblings,
      )
    history.insert(
      after_consensus,
      consensus_history.from_client(old.client),
      redeemer.archive_siblings,
    ) == next.ibc_state_root
  }

  withdraw(redeemer: Lookup, _credential: Credential, tx: Transaction) {
    // Exercise a history lookup and delay metadata, not a full IBC packet.
    expect [input] =
      list.filter(
        tx.reference_inputs,
        fn(input) { auth.contain_auth_token(input.output, client_token) },
      )
    expect state: State = utils.get_inline_datum(input.output)
    expect state.client.token.policy_id == client_token.policy_id
    expect state.client.token.name == client_token.name
    let now = utils.get_tx_valid_to(tx.validity_range) * 1_000_000
    expect
      client_state.status(
        state.client.state.client_state,
        now,
        state.client.state.consensus_states,
      ) == Active
    let hydrated =
      history.with_witness_at_height(
        state.client,
        state.ibc_state_root,
        redeemer.witness,
        now,
        Some(redeemer.height),
      )
    expect Some(_) =
      store.get_consensus_state(
        hydrated.state.consensus_states,
        redeemer.height,
      )
    expect Some(processed_time) =
      pairs.get_first(hydrated.state.processed_times, redeemer.height)
    expect Some(processed_height) =
      pairs.get_first(hydrated.state.processed_heights, redeemer.height)
    let earliest = utils.get_tx_valid_from(tx.validity_range) * 1_000_000
    and {
      earliest >= processed_time + 1_000_000_000,
      client_datum.processed_height_from_time(earliest) >= processed_height + 1,
    }
  }

  else(_) {
    fail
  }
}
