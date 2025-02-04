use ibc/client/cardano_client/protos/cardano_pb.{
  AnyCardanoClientState, CardanoClientState, marshal_for_any_client_state,
}

test test_marshal_for_any_client_state_empty() {
  marshal_for_any_client_state(None) == #""
}

test test_marshal_for_any_client_state_some_data_success() {
  let accs_opt =
    Some(
      AnyCardanoClientState(
        #"01",
        Some(
          CardanoClientState(
            #"00",
            None,
            None,
            0,
            1,
            2,
            3,
            4,
            [],
            [],
            5,
            [],
            None,
          ),
        ),
      ),
    )
  marshal_for_any_client_state(accs_opt) == #"0a0101120d0a010028013002380340045805"
}
