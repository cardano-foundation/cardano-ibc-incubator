import {Data} from '../../plutus/data';

export const TokenConfigsSchema = Data.Object({
  handler_token_unit: Data.Bytes(),
  client_policy_id: Data.Bytes(),
  connection_policy_id: Data.Bytes(),
  channel_policy_id: Data.Bytes(),
});
export type TokenConfigs = Data.Static<typeof TokenConfigsSchema>;
export const TokenConfigs = TokenConfigsSchema as unknown as TokenConfigs;
