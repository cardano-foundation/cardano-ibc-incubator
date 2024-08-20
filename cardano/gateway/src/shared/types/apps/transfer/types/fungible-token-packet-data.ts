import { Data } from '@cuonglv0297/lucid-custom';
export type FungibleTokenPacketDatum = {
  denom: string;
  amount: string;
  sender: string;
  receiver: string;
  memo: string;
};

export function encodeFungibleTokenPacketDatum(
  fungibleTokenPacketDatum: FungibleTokenPacketDatum,
  Lucid: typeof import('@cuonglv0297/lucid-custom'),
): string {
  const { Data } = Lucid;

  const FungibleTokenPacketDatumSchema = Data.Object({
    denom: Data.Bytes(),
    amount: Data.Bytes(),
    sender: Data.Bytes(),
    receiver: Data.Bytes(),
    memo: Data.Bytes(),
  });
  type TFungibleTokenPacketDatum = Data.Static<typeof FungibleTokenPacketDatumSchema>;
  const TFungibleTokenPacketDatum = FungibleTokenPacketDatumSchema as unknown as FungibleTokenPacketDatum;

  return Data.to(fungibleTokenPacketDatum, TFungibleTokenPacketDatum);
}

export function decodeFungibleTokenPacketDatum(
  fungibleTokenPacketDatum: string,
  Lucid: typeof import('@cuonglv0297/lucid-custom'),
): FungibleTokenPacketDatum {
  const { Data } = Lucid;

  const FungibleTokenPacketDatumSchema = Data.Object({
    denom: Data.Bytes(),
    amount: Data.Bytes(),
    sender: Data.Bytes(),
    receiver: Data.Bytes(),
    memo: Data.Bytes(),
  });
  type TFungibleTokenPacketDatum = Data.Static<typeof FungibleTokenPacketDatumSchema>;
  const TFungibleTokenPacketDatum = FungibleTokenPacketDatumSchema as unknown as FungibleTokenPacketDatum;

  return Data.from(fungibleTokenPacketDatum, TFungibleTokenPacketDatum);
}

// cast to fungibleTokenPacket
export function castToFungibleTokenPacket(
  fungibleTokenPacket: FungibleTokenPacketDatum,
  Lucid: typeof import('@cuonglv0297/lucid-custom'),
) {
  const { Data } = Lucid;
  const FungibleTokenPacketDatumSchema = Data.Object({
    denom: Data.Bytes(),
    amount: Data.Bytes(),
    sender: Data.Bytes(),
    receiver: Data.Bytes(),
    memo: Data.Bytes(),
  });
  type TFungibleTokenPacketDatum = Data.Static<typeof FungibleTokenPacketDatumSchema>;
  const TFungibleTokenPacketDatum = FungibleTokenPacketDatumSchema as unknown as FungibleTokenPacketDatum;

  return Data.castTo(fungibleTokenPacket, TFungibleTokenPacketDatum);
}
