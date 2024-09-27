import {Data} from '../../../plutus/data';
import {HeaderSchema} from '../header/Header';

export const MisbehaviourSchema = Data.Object({
  client_id: Data.Bytes(),
  header1: HeaderSchema,
  header2: HeaderSchema,
});
export type Misbehaviour = Data.Static<typeof MisbehaviourSchema>;
export const Misbehaviour = MisbehaviourSchema as unknown as Misbehaviour;
