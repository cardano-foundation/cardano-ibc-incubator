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
      bound_port: [],
    }
  let new_handler_state =
    HandlerState {
      next_client_sequence: new_next_client_sequence,
      next_connection_sequence,
      next_channel_sequence,
      bound_port: [],
    }
  let auth_token = AuthToken { policy_id: policy_id_sample, name: name_sample }
  let old = HandlerDatum { state: old_handler_state, token: auth_token }
  let new = HandlerDatum { state: new_handler_state, token: auth_token }
  handler_datum.validate_create_client(old, new)
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
      bound_port: [],
    }
  let new_handler_state =
    HandlerState {
      next_client_sequence: new_next_client_sequence,
      next_connection_sequence,
      next_channel_sequence,
      bound_port: [],
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
      bound_port: [],
    }
  let new_handler_state =
    HandlerState {
      next_client_sequence: new_next_client_sequence,
      next_connection_sequence,
      next_channel_sequence,
      bound_port: [],
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
      bound_port: [],
    }
  let new_handler_state =
    HandlerState {
      next_client_sequence: 1,
      next_connection_sequence,
      next_channel_sequence,
      bound_port: [],
    }
  let auth_token = AuthToken { policy_id: policy_id_sample, name: name_sample }
  let old = HandlerDatum { state: old_handler_state, token: auth_token }
  let new = HandlerDatum { state: new_handler_state, token: auth_token }
  handler_datum.validate_create_client(old, new) == False
}

//===========================validate_create_connection============================
fn setup_validate_create_connection() -> (HandlerDatum, HandlerDatum) {
  let old_datum =
    HandlerDatum {
      state: HandlerState {
        next_client_sequence,
        next_connection_sequence,
        next_channel_sequence,
        bound_port: [],
      },
      token: AuthToken { policy_id: policy_id_sample, name: name_sample },
    }

  let new_datum =
    HandlerDatum {
      state: HandlerState {
        next_client_sequence,
        next_connection_sequence: old_datum.state.next_connection_sequence + 1,
        next_channel_sequence,
        bound_port: [],
      },
      token: AuthToken { policy_id: policy_id_sample, name: name_sample },
    }

  (old_datum, new_datum)
}

test validate_create_connection_succeed() {
  let (old_datum, new_datum) = setup_validate_create_connection()

  handler_datum.validate_create_connection(old_datum, new_datum)
}

test validate_create_connection_fail_if_next_conn_seq_not_updated() {
  let (old_datum, new_datum) = setup_validate_create_connection()

  let new_datum =
    HandlerDatum {
      ..new_datum,
      state: HandlerState {
        ..new_datum.state,
        next_connection_sequence: old_datum.state.next_connection_sequence,
      },
    }

  handler_datum.validate_create_connection(old_datum, new_datum) == False
}

//===========================validate_create_channel============================
fn setup_validate_create_channel() -> (HandlerDatum, HandlerDatum) {
  let old_datum =
    HandlerDatum {
      state: HandlerState {
        next_client_sequence,
        next_connection_sequence,
        next_channel_sequence,
        bound_port: [],
      },
      token: AuthToken { policy_id: policy_id_sample, name: name_sample },
    }

  let new_datum =
    HandlerDatum {
      state: HandlerState {
        next_client_sequence,
        next_connection_sequence,
        next_channel_sequence: old_datum.state.next_channel_sequence + 1,
        bound_port: [],
      },
      token: AuthToken { policy_id: policy_id_sample, name: name_sample },
    }

  (old_datum, new_datum)
}

test validate_create_channel_succeed() {
  let (old_datum, new_datum) = setup_validate_create_channel()

  handler_datum.validate_create_channel(old_datum, new_datum)
}

test validate_create_channel_fail_if_next_chan_seq_not_updated() {
  let (old_datum, new_datum) = setup_validate_create_channel()

  let new_datum =
    HandlerDatum {
      ..new_datum,
      state: HandlerState {
        ..new_datum.state,
        next_channel_sequence: old_datum.state.next_channel_sequence,
      },
    }

  handler_datum.validate_create_channel(old_datum, new_datum) == False
}

//==========================is_initialized_valid============================
test is_initialized_valid_succeed() {
  let token = AuthToken { policy_id: policy_id_sample, name: name_sample }

  let datum =
    HandlerDatum {
      state: HandlerState {
        next_client_sequence: 0,
        next_connection_sequence: 0,
        next_channel_sequence: 0,
        bound_port: [],
      },
      token,
    }

  handler_datum.is_initialized_valid(datum, token)
}
