export type CardanoClientState = {
  chain_id: string;
  latest_height: CardanoHeight;
  frozen_height: CardanoHeight;
  valid_after: bigint;
  genesis_time: bigint;
  current_epoch: bigint;
  epoch_length: bigint;
  slot_per_kes_period: bigint;
  current_validator_set: CardanoValidator[];
  next_validator_set: CardanoValidator[];
  trusting_period: bigint;
  upgrade_path: string[];
  token_configs: TokenConfigs;
};

export type TokenConfigs = {
  handler_token_unit: string;
  client_policy_id: string;
  connection_policy_id: string;
  channel_policy_id: string;
};
export type CardanoValidator = {
  vrf_key_hash: string;
  pool_id: string;
};
export type CardanoHeight = {
  revision_number: bigint;
  revision_height: bigint;
};
