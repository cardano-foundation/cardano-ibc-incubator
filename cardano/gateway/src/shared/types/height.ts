import { type Data } from 'lucid-cardano';

export type Height = {
  revisionNumber: bigint;
  revisionHeight: bigint;
};

export async function encodeHeight(height: Height, Lucid: typeof import('lucid-cardano')) {
  const { Data } = Lucid;

  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  type THeight = Data.Static<typeof HeightSchema>;
  const THeight = HeightSchema as unknown as Height;
  return Data.to(height, THeight);
}
