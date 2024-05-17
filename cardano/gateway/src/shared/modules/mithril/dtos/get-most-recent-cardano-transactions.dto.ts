import { Beacon } from './common.dto';

export class CardanoTransactionSetSnapshotDTO {
  merkle_root: string;
  beacon: Beacon;
  hash: string;
  certificate_hash: string;
  created_at: string;
}
