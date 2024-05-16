import { Data } from '@dinhbx/lucid-custom';
import { Packet } from '@plus/proto-types/build/ibc/core/channel/v1/channel';
export type MockModuleDatum = {
  // opened_channels: Map<string, boolean>;
  received_packets: Packet[];
};

export async function decodeMockModuleDatum(mockModuleDatum: string, Lucid: typeof import('@dinhbx/lucid-custom')) {
  const { Data } = Lucid;

  const HeightSchema = Data.Object({
    revision_number: Data.Integer(),
    revision_height: Data.Integer(),
  });

  const PacketSchema = Data.Object({
    sequence: Data.Integer(),
    source_port: Data.Bytes(),
    source_channel: Data.Bytes(),
    destination_port: Data.Bytes(),
    destination_channel: Data.Bytes(),
    data: Data.Bytes(),
    timeout_height: HeightSchema,
    timeout_timestamp: Data.Integer(),
  });
  const MockModuleDatumSchema = Data.Object({
    received_packets: Data.Array(PacketSchema),
  });
  type TMockModuleDatum = Data.Static<typeof MockModuleDatumSchema>;
  const TMockModuleDatum = MockModuleDatumSchema as unknown as MockModuleDatum;

  return Data.from(mockModuleDatum, TMockModuleDatum);
}

export async function encodeMockModuleDatum(
  mockModuleDatum: MockModuleDatum,
  Lucid: typeof import('@dinhbx/lucid-custom'),
) {
  const { Data } = Lucid;
  const HeightSchema = Data.Object({
    revision_number: Data.Integer(),
    revision_height: Data.Integer(),
  });

  const PacketSchema = Data.Object({
    sequence: Data.Integer(),
    source_port: Data.Bytes(),
    source_channel: Data.Bytes(),
    destination_port: Data.Bytes(),
    destination_channel: Data.Bytes(),
    data: Data.Bytes(),
    timeout_height: HeightSchema,
    timeout_timestamp: Data.Integer(),
  });
  const MockModuleDatumSchema = Data.Object({
    received_packets: Data.Array(PacketSchema),
  });
  type TMockModuleDatum = Data.Static<typeof MockModuleDatumSchema>;
  const TMockModuleDatum = MockModuleDatumSchema as unknown as MockModuleDatum;

  return Data.to(mockModuleDatum, TMockModuleDatum);
}
