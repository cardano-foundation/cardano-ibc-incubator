import {PacketSchema} from '../../../core/ics_004/types/packet/Packet.js';
import {Data} from '../../../plutus/data.js';

export const MockModuleDatumSchema = Data.Object({
  received_packets: Data.Array(PacketSchema),
});
export type MockModuleDatum = Data.Static<typeof MockModuleDatumSchema>;
export const MockModuleDatum = MockModuleDatumSchema as unknown as MockModuleDatum;
