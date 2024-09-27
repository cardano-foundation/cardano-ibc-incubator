import {Data} from '../../../plutus/data';
import {HeaderSchema} from '../header/Header';
import {MisbehaviourSchema} from '../misbehaviour/Misbehaviour';

export const ClientMessageSchema = Data.Enum([
  Data.Object({HeaderCase: Data.Tuple([HeaderSchema])}),
  Data.Object({MisbehaviourCase: Data.Tuple([MisbehaviourSchema])}),
]);
export type ClientMessage = Data.Static<typeof ClientMessageSchema>;
export const ClientMessage = ClientMessageSchema as unknown as ClientMessage;
