import {VersionSchema} from '../version/Version';
import {StateSchema} from '../state/State';
import {CounterpartySchema} from '../counterparty/Counterparty';
import {Data} from '../../../../plutus/data';

export const ConnectionEndSchema = Data.Object({
  client_id: Data.Bytes(),
  versions: Data.Array(VersionSchema),
  state: StateSchema,
  counterparty: CounterpartySchema,
  delay_period: Data.Integer(),
});
export type ConnectionEnd = Data.Static<typeof ConnectionEndSchema>;
export const ConnectionEnd = ConnectionEndSchema as unknown as ConnectionEnd;
