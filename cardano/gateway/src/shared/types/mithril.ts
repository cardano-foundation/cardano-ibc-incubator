export type MithrilClientState = {
  chain_id: string;
  latest_height: MithrilHeight;
  frozen_height: MithrilHeight;
  current_epoch: bigint;
  trusting_period: bigint;
  protocol_parameters: MithrilProtocolParameters;
  upgrade_path: string[];
};

export type MithrilHeight = {
  mithril_height: bigint;
};

export type MithrilProtocolParameters = {
  k: bigint;
  m: bigint;
  phi_f: bigint;
};
