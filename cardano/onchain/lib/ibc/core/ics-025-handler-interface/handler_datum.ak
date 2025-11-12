use aiken/collection/list
use aiken/primitive/int
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/handler.{HandlerState}

pub const handler_token_name = "handler"

pub type HandlerDatum {
  state: HandlerState,
  token: AuthToken,
}

pub fn is_initialized_valid(datum: HandlerDatum, auth_token: AuthToken) -> Bool {
  let HandlerDatum { state, token } = datum

  and {
    state.next_client_sequence == 0,
    state.next_connection_sequence == 0,
    state.next_channel_sequence == 0,
    state.bound_port == [],
    // ibc_state_root should be initialized to empty tree root (all zeros for now)
    state.ibc_state_root == #"0000000000000000000000000000000000000000000000000000000000000000",
    token == auth_token,
  }
}

// Validates client creation: increments sequence and allows root update
// The ibc_state_root is recomputed off-chain by the Gateway
pub fn validate_create_client(old: HandlerDatum, new: HandlerDatum) -> Bool {
  and {
    new.token == old.token,
    new.state.next_client_sequence == old.state.next_client_sequence + 1,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence,
    new.state.bound_port == old.state.bound_port,
    // ibc_state_root is allowed to change (computed by Gateway)
  }
}

// Validates connection creation: increments sequence and allows root update
pub fn validate_create_connection(old: HandlerDatum, new: HandlerDatum) -> Bool {
  and {
    new.token == old.token,
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence + 1,
    new.state.next_channel_sequence == old.state.next_channel_sequence,
    new.state.bound_port == old.state.bound_port,
    // ibc_state_root is allowed to change (computed by Gateway)
  }
}

// Validates channel creation: increments sequence and allows root update
pub fn validate_create_channel(old: HandlerDatum, new: HandlerDatum) -> Bool {
  and {
    new.token == old.token,
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence + 1,
    new.state.bound_port == old.state.bound_port,
    // ibc_state_root is allowed to change (computed by Gateway)
  }
}

// Validates port binding: adds port to bound_port list and allows root update
pub fn validate_bind_port(
  old: HandlerDatum,
  new: HandlerDatum,
  port: Int,
) -> Bool {
  // Port must not already be bound
  expect !list.has(old.state.bound_port, port)

  let expected_bound_port =
    list.push(old.state.bound_port, port)
      |> list.sort(int.compare)

  and {
    new.token == old.token,
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence,
    new.state.bound_port == expected_bound_port,
    // ibc_state_root is allowed to change (computed by Gateway)
  }
}
