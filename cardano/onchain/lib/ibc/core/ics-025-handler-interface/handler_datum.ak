use aiken/collection/list
use aiken/primitive/int
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/handler.{
  HandlerState, empty_ibc_state_root,
}

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
    // ibc_state_root should be initialized to empty tree root (32 bytes of 0x00)
    state.ibc_state_root == empty_ibc_state_root,
    token == auth_token,
  }
}

pub fn validate_create_client(old: HandlerDatum, new: HandlerDatum) -> Bool {
  // Validate that next_client_sequence increments and token stays the same
  // ibc_state_root is allowed to change (computed off-chain by Gateway)
  and {
    new.state.next_client_sequence == old.state.next_client_sequence + 1,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence,
    new.state.bound_port == old.state.bound_port,
    new.token == old.token,
  }
}

pub fn validate_create_connection(old: HandlerDatum, new: HandlerDatum) -> Bool {
  // Validate that next_connection_sequence increments and token stays the same
  // ibc_state_root is allowed to change (computed off-chain by Gateway)
  and {
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence + 1,
    new.state.next_channel_sequence == old.state.next_channel_sequence,
    new.state.bound_port == old.state.bound_port,
    new.token == old.token,
  }
}

pub fn validate_create_channel(old: HandlerDatum, new: HandlerDatum) -> Bool {
  // Validate that next_channel_sequence increments and token stays the same
  // ibc_state_root is allowed to change (computed off-chain by Gateway)
  and {
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence + 1,
    new.state.bound_port == old.state.bound_port,
    new.token == old.token,
  }
}

pub fn validate_bind_port(
  old: HandlerDatum,
  new: HandlerDatum,
  port: Int,
) -> Bool {
  expect
    if list.has(old.state.bound_port, port) {
      False
    } else {
      True
    }

  // Validate that bound_port adds the new port and token stays the same
  // ibc_state_root is allowed to change (computed off-chain by Gateway)
  and {
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence,
    new.state.bound_port == (
      list.push(old.state.bound_port, port)
        |> list.sort(int.compare)
    ),
    new.token == old.token,
  }
}
