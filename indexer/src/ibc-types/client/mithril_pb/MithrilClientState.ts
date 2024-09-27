import {Data} from '../../plutus/data';
import {CardanoHeightSchema} from './CardanoHeight';
import {MithrilProtocolParametersSchema} from './MithrilProtocolParameters';

export const MithrilClientStateSchema = Data.Object({
  chain_id: Data.Bytes(),
  latest_height: Data.Nullable(CardanoHeightSchema),
  frozen_height: Data.Nullable(CardanoHeightSchema),
  current_epoch: Data.Integer(),
  trusting_period: Data.Integer(),
  protocol_parameters: Data.Nullable(MithrilProtocolParametersSchema),
  upgrade_path: Data.Array(Data.Bytes()),
});
export type MithrilClientState = Data.Static<typeof MithrilClientStateSchema>;
export const MithrilClientState = MithrilClientStateSchema as unknown as MithrilClientState;
