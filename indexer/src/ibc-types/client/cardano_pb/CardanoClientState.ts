import {Data} from '../../plutus/data';
import {CardanoHeightSchema} from './CardanoHeight';
import {CardanoValidatorSchema} from './CardanoValidator';
import {TokenConfigsSchema} from './TokenConfigs';

export const CardanoClientStateSchema = Data.Object({
  chain_id: Data.Bytes(),
  latest_height: Data.Nullable(CardanoHeightSchema),
  frozen_height: Data.Nullable(CardanoHeightSchema),
  valid_after: Data.Integer(),
  genesis_time: Data.Integer(),
  current_epoch: Data.Integer(),
  epoch_length: Data.Integer(),
  slot_per_kes_period: Data.Integer(),
  current_validator_set: Data.Array(Data.Nullable(CardanoValidatorSchema)),
  next_validator_set: Data.Array(Data.Nullable(CardanoValidatorSchema)),
  trusting_period: Data.Integer(),
  upgrade_path: Data.Array(Data.Bytes()),
  token_configs: Data.Nullable(TokenConfigsSchema),
});
export type CardanoClientState = Data.Static<typeof CardanoClientStateSchema>;
export const CardanoClientState = CardanoClientStateSchema as unknown as CardanoClientState;
