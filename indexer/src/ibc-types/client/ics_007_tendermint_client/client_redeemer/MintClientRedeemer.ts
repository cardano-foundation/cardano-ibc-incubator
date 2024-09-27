import {AuthTokenSchema} from '../../../auth/AuthToken';
import {Data} from '../../../plutus/data';

export const MintClientRedeemerSchema = Data.Object({
  handler_auth_token: AuthTokenSchema,
});
export type MintClientRedeemer = Data.Static<typeof MintClientRedeemerSchema>;
export const MintClientRedeemer = MintClientRedeemerSchema as unknown as MintClientRedeemer;
