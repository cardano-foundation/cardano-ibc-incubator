import { Data } from '@cuonglv0297/lucid-custom';
export type MockModuleDatum = {
  opened_channels: Map<string, boolean>;
  received_packets: string[];
};

export async function decodeMockModuleDatum(
  mockModuleDatum: string,
  Lucid: typeof import('@cuonglv0297/lucid-custom'),
) {
  const { Data } = Lucid;

  const MockModuleDatumSchema = Data.Object({
    opened_channels: Data.Map(Data.Bytes(), Data.Boolean()),
    received_packets: Data.Array(Data.Bytes()),
  });
  type TMockModuleDatum = Data.Static<typeof MockModuleDatumSchema>;
  const TMockModuleDatum = MockModuleDatumSchema as unknown as MockModuleDatum;

  return Data.from(mockModuleDatum, TMockModuleDatum);
}

export async function encodeMockModuleDatum(
  mockModuleDatum: MockModuleDatum,
  Lucid: typeof import('@cuonglv0297/lucid-custom'),
) {
  const { Data } = Lucid;

  const MockModuleDatumSchema = Data.Object({
    opened_channels: Data.Map(Data.Bytes(), Data.Boolean()),
    received_packets: Data.Array(Data.Bytes()),
  });
  type TMockModuleDatum = Data.Static<typeof MockModuleDatumSchema>;
  const TMockModuleDatum = MockModuleDatumSchema as unknown as MockModuleDatum;

  return Data.to(mockModuleDatum, TMockModuleDatum);
}
