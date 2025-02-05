use ibc/client/mithril_client/protos/mithril_pb.{
  CardanoHeight, Fraction, MithrilClientState, MithrilProtocolParameters,
  marshal_for_client_state, size_for_protocol_parameters,
}

test test_marshal_for_client_state() {
  let cs =
    Some(
      MithrilClientState {
        chain_id: "chain-id",
        latest_height: Some(
          CardanoHeight { revision_height: 11, revision_number: 0 },
        ),
        frozen_height: Some(
          CardanoHeight { revision_height: 12, revision_number: 0 },
        ),
        current_epoch: 2,
        trusting_period: 10000,
        protocol_parameters: Some(
          MithrilProtocolParameters {
            k: 2,
            m: 3,
            phi_f: Some(Fraction { numerator: 20, denominator: 100 }),
          },
        ),
        upgrade_path: ["abc", "xyz"],
      },
    )
  marshal_for_client_state(cs) == #"0a08636861696e2d69641202100b1a02100c20022a0310904e320a080210031a04081410643a036162633a0378797a"
}

test test_size_for_protocol_parameters_succeed() {
  size_for_protocol_parameters(
    Some(
      MithrilProtocolParameters {
        k: 222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222,
        m: 333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333,
        phi_f: Some(Fraction { numerator: 20, denominator: 100 }),
      },
    ),
  ) == 10
}
