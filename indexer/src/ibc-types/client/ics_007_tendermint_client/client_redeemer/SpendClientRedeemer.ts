import {Data} from '../../../plutus/data';
import {ClientMessageSchema} from '../msgs/ClientMessage';

export const SpendClientRedeemerSchema = Data.Enum([
  Data.Object({UpdateClient: Data.Object({msg: ClientMessageSchema})}),
  Data.Literal('Other'),
]);
export type SpendClientRedeemer = Data.Static<typeof SpendClientRedeemerSchema>;
export const SpendClientRedeemer = SpendClientRedeemerSchema as unknown as SpendClientRedeemer;
