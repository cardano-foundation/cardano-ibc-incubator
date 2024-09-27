import {HeightSchema} from '../../../../client/ics_007_tendermint_client/height/Height';
import {Data} from '../../../../plutus/data';

export const PacketSchema = Data.Object({
  sequence: Data.Integer(),
  source_port: Data.Bytes(),
  source_channel: Data.Bytes(),
  destination_port: Data.Bytes(),
  destination_channel: Data.Bytes(),
  data: Data.Bytes(),
  timeout_height: HeightSchema,
  timeout_timestamp: Data.Integer(),
});
export type Packet = Data.Static<typeof PacketSchema>;
export const Packet = PacketSchema as unknown as Packet;
