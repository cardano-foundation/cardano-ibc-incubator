import { Counterparty } from 'src/shared/types/connection/counterparty';
import { Version } from 'src/shared/types/connection/version';

export type ConnectionOpenInitOperator = {
  clientId: string;
  counterparty: Counterparty;
  versions: Version[];
};
