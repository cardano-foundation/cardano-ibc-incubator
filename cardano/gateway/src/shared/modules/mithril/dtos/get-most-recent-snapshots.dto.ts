import { Beacon } from './common.dto';

export class SnapshotDTO {
  digest: string;
  beacon: Beacon;
  certificate_hash: string;
  size: number;
  created_at: string;
  locations: string[];
  compression_algorithm: string;
  cardano_node_version: string;
}
