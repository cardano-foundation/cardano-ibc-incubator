import { type Data } from '@lucid-evolution/lucid';

export type Height = {
  revisionNumber: bigint;
  revisionHeight: bigint;
};

export async function encodeHeight(height: Height, Lucid: typeof import('@lucid-evolution/lucid')) {
  const { Data } = Lucid;

  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  type THeight = Data.Static<typeof HeightSchema>;
  const THeight = HeightSchema as unknown as Height;
  return Data.to(height, THeight, { canonical: true });
}

// IsRevisionFormat checks if a chainID is in the format required for parsing revisions
// The chainID must be in the form: `{chainID}-{revision}`.
// 24-host may enforce stricter checks on chainID
const revisionRegex = new RegExp(/^.*[^\n-]-{1}[1-9][0-9]*$/);
export function isRevisionFormat(chainID: string): boolean {
  return revisionRegex.test(chainID);
}
