import { Beacon } from './common.dto';

export class CardanoTransactionSetSnapshotDTO {
  merkle_root: string;
  epoch: number;
  block_number: number;
  hash: string;
  certificate_hash: string;
  created_at: string;
}
