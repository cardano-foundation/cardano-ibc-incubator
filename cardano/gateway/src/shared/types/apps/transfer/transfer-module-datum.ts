import { type Data } from '@lucid-evolution/lucid';

export type TransferModuleDatum = {
  escrow_shard_registry_root: string;
  live_escrow_shard_count: bigint;
  voucher_supply: bigint;
};

function transferModuleDatumSchema(Lucid: typeof import('@lucid-evolution/lucid')) {
  return Lucid.Data.Object({
    escrow_shard_registry_root: Lucid.Data.Bytes(),
    live_escrow_shard_count: Lucid.Data.Integer(),
    voucher_supply: Lucid.Data.Integer(),
  });
}

export function encodeTransferModuleDatum(
  datum: TransferModuleDatum,
  Lucid: typeof import('@lucid-evolution/lucid'),
): string {
  const schema = transferModuleDatumSchema(Lucid);
  type TTransferModuleDatum = Data.Static<typeof schema>;
  const TTransferModuleDatum = schema as unknown as TTransferModuleDatum;
  return Lucid.Data.to(datum, TTransferModuleDatum, {
    canonical: true,
  });
}

export function decodeTransferModuleDatum(
  encodedDatum: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): TransferModuleDatum {
  const schema = transferModuleDatumSchema(Lucid);
  type TTransferModuleDatum = Data.Static<typeof schema>;
  const TTransferModuleDatum = schema as unknown as TTransferModuleDatum;
  return Lucid.Data.from(encodedDatum, TTransferModuleDatum) as TransferModuleDatum;
}
