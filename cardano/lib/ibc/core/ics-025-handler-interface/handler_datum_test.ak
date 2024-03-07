use aiken/dict
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/handler.{HandlerState}
use ibc/core/ics_025_handler_interface/handler_datum.{HandlerDatum}

const policy_id_sample =
  #"505d7e26586b54e1f54cbe5f5854254d559549f9d5a3ba3545515831"

const name_sample = "auth_token"

const next_client_sequence = 1

const next_connection_sequence = 0

const next_channel_sequence = 0

// Test to check if client creation is valid, expecting return true
test validate_create_client_succeed() {
  let new_next_client_sequence = next_client_sequence + 1
  let old_handler_state =
    HandlerState {
      next_client_sequence,
      next_connection_sequence,
      next_channel_sequence,
      bound_port: dict.new(),
    }
  let new_handler_state =
    HandlerState {
      next_client_sequence: new_next_client_sequence,
      next_connection_sequence,
      next_channel_sequence,
      bound_port: dict.new(),
    }
  let auth_token = AuthToken { policy_id: policy_id_sample, name: name_sample }
  let old = HandlerDatum { state: old_handler_state, token: auth_token }
  let new = HandlerDatum { state: new_handler_state, token: auth_token }
  handler_datum.validate_create_client(old, new) == True
}

// Test to check if client creation fails with an invalid token name
test validate_create_client_fail_with_invalid_token_name() {
  let name_sample_wrong = "auth_token_wrong"
  let new_next_client_sequence = next_client_sequence + 1
  let old_handler_state =
    HandlerState {
      next_client_sequence,
      next_connection_sequence,
      next_channel_sequence,
      bound_port: dict.new(),
    }
  let new_handler_state =
    HandlerState {
      next_client_sequence: new_next_client_sequence,
      next_connection_sequence,
      next_channel_sequence,
      bound_port: dict.new(),
    }
  let old_auth_token =
    AuthToken { policy_id: policy_id_sample, name: name_sample }
  let new_auth_token =
    AuthToken { policy_id: policy_id_sample, name: name_sample_wrong }
  let old = HandlerDatum { state: old_handler_state, token: new_auth_token }
  let new = HandlerDatum { state: new_handler_state, token: old_auth_token }
  handler_datum.validate_create_client(old, new) == False
}

// Test to check if client creation fails with an invalid policy ID
test validate_create_client_fail_with_invalid_policy_id() {
  let policy_id_sample_wrong =
    #"a4a054a554354a85a54a054a554354a854a054a554a054a554a054a554a054a5"
  let new_next_client_sequence = next_client_sequence + 1
  let old_handler_state =
    HandlerState {
      next_client_sequence,
      next_connection_sequence,
      next_channel_sequence,
      bound_port: dict.new(),
    }
  let new_handler_state =
    HandlerState {
      next_client_sequence: new_next_client_sequence,
      next_connection_sequence,
      next_channel_sequence,
      bound_port: dict.new(),
    }
  let old_auth_token =
    AuthToken { policy_id: policy_id_sample, name: name_sample }
  let new_auth_token =
    AuthToken { policy_id: policy_id_sample_wrong, name: name_sample }
  let old = HandlerDatum { state: old_handler_state, token: new_auth_token }
  let new = HandlerDatum { state: new_handler_state, token: old_auth_token }
  handler_datum.validate_create_client(old, new) == False
}

// Test to check if client creation fails with an invalid state
test validate_create_client_fail_with_invalid_state() {
  let old_handler_state =
    HandlerState {
      next_client_sequence: 1,
      next_connection_sequence,
      next_channel_sequence,
      bound_port: dict.new(),
    }
  let new_handler_state =
    HandlerState {
      next_client_sequence: 1,
      next_connection_sequence,
      next_channel_sequence,
      bound_port: dict.new(),
    }
  let auth_token = AuthToken { policy_id: policy_id_sample, name: name_sample }
  let old = HandlerDatum { state: old_handler_state, token: auth_token }
  let new = HandlerDatum { state: new_handler_state, token: auth_token }
  handler_datum.validate_create_client(old, new) == False
}
