pub type MithrilClientState {
  chain_id: ByteArray,
  latest_height: MithrilHeight,
  frozen_height: MithrilHeight,
  current_epoch: Int,
  trusting_period: Int,
  protocol_parameters: MithrilProtocolParameters,
  upgrade_path: List<ByteArray>,
}

pub type MithrilHeight {
  mithril_height: Int
}

pub type MithrilProtocolParameters {
  k: Int,
  m: Int,
  phi_f: Int,
}

pub type AnyMithrilClientState {
  type_url: ByteArray,
  value: MithrilClientState,
}

pub fn marshal_for_any_client_state(_accs: AnyMithrilClientState) -> ByteArray {
  // TODO: add marshal logic
  ""
}
