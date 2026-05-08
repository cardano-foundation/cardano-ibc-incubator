import { type Data } from '@lucid-evolution/lucid';

export type TransferEscrowDatum = {
  channel_id: string;
  denom: string;
};

function transferEscrowDatumSchema(Lucid: typeof import('@lucid-evolution/lucid')) {
  return Lucid.Data.Object({
    channel_id: Lucid.Data.Bytes(),
    denom: Lucid.Data.Bytes(),
  });
}

export function encodeTransferEscrowDatum(
  datum: TransferEscrowDatum,
  Lucid: typeof import('@lucid-evolution/lucid'),
): string {
  const schema = transferEscrowDatumSchema(Lucid);
  type TTransferEscrowDatum = Data.Static<typeof schema>;
  const TTransferEscrowDatum = schema as unknown as TTransferEscrowDatum;
  return Lucid.Data.to(datum, TTransferEscrowDatum, {
    canonical: true,
  });
}

export function decodeTransferEscrowDatum(
  encodedDatum: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): TransferEscrowDatum {
  const schema = transferEscrowDatumSchema(Lucid);
  type TTransferEscrowDatum = Data.Static<typeof schema>;
  const TTransferEscrowDatum = schema as unknown as TTransferEscrowDatum;
  return Lucid.Data.from(encodedDatum, TTransferEscrowDatum) as TransferEscrowDatum;
}
