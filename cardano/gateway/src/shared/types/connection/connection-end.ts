import { Counterparty } from './counterparty';
import { State } from './state';
import { Version } from './version';

export type ConnectionEnd = {
  client_id: string;
  versions: Version[];
  state: State;
  counterparty: Counterparty;
  delay_period: bigint;
};
