import { Counterparty } from 'src/shared/types/connection/counterparty';
import { Version } from 'src/shared/types/connection/version';
import { Height } from 'src/shared/types/height';

export type ConnectionOpenTryOperator = {
  clientId: string;
  counterparty: Counterparty;
  versions: Version[];
  counterpartyClientState: string;
  proofInit: string;
  proofClient: string;
  proofHeight: Height;
};
