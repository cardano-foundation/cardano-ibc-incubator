import { Height } from '../height';

export type Packet = {
  sequence: bigint;
  source_port: string;
  source_channel: string;
  destination_port: string;
  destination_channel: string;
  data: string;
  timeout_height: Height;
  timeout_timestamp: bigint;
};
