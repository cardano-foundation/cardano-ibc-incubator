import {Data} from '../../../../plutus/data';

export const StateSchema = Data.Enum([
  Data.Literal('Uninitialized'),
  Data.Literal('Init'),
  Data.Literal('TryOpen'),
  Data.Literal('Open'),
]);
export type State = Data.Static<typeof StateSchema>;
export const State = StateSchema as unknown as State;
