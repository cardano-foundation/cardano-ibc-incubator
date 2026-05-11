import { Data } from '@lucid-evolution/lucid';
import { Acknowledgement } from '@shared/types/channel/acknowledgement';
import { FungibleTokenPacketDatum } from '../types/fungible-token-packet-data';

export type MintVoucherRedeemer =
  | {
      MintVoucher: {
        packet_source_port: string;
        packet_source_channel: string;
        packet_dest_port: string;
        packet_dest_channel: string;
        data: FungibleTokenPacketDatum;
      };
    }
  | {
      BurnVoucher: {
        packet_source_port: string;
        packet_source_channel: string;
        data: FungibleTokenPacketDatum;
      };
    }
  | {
      RefundVoucher: {
        packet_source_port: string;
        packet_source_channel: string;
        data: FungibleTokenPacketDatum;
        acknowledgement: Acknowledgement | null;
      };
    };

function fungibleTokenPacketDatumSchema(
  DataApi: typeof import('@lucid-evolution/lucid').Data,
) {
  return DataApi.Object({
    denom: DataApi.Bytes(),
    amount: DataApi.Bytes(),
    sender: DataApi.Bytes(),
    receiver: DataApi.Bytes(),
    memo: DataApi.Bytes(),
  });
}

function acknowledgementSchema(
  DataApi: typeof import('@lucid-evolution/lucid').Data,
) {
  const AcknowledgementResponseSchema = DataApi.Enum([
    DataApi.Object({
      AcknowledgementResult: DataApi.Object({
        result: DataApi.Bytes(),
      }),
    }),
    DataApi.Object({
      AcknowledgementError: DataApi.Object({
        err: DataApi.Bytes(),
      }),
    }),
  ]);

  return DataApi.Object({
    response: AcknowledgementResponseSchema,
  });
}

function mintVoucherRedeemerSchema(
  DataApi: typeof import('@lucid-evolution/lucid').Data,
) {
  const FungibleTokenPacketDatumSchema =
    fungibleTokenPacketDatumSchema(DataApi);
  const AcknowledgementSchema = acknowledgementSchema(DataApi);

  return DataApi.Enum([
    DataApi.Object({
      MintVoucher: DataApi.Object({
        packet_source_port: DataApi.Bytes(),
        packet_source_channel: DataApi.Bytes(),
        packet_dest_port: DataApi.Bytes(),
        packet_dest_channel: DataApi.Bytes(),
        data: FungibleTokenPacketDatumSchema,
      }),
    }),
    DataApi.Object({
      BurnVoucher: DataApi.Object({
        packet_source_port: DataApi.Bytes(),
        packet_source_channel: DataApi.Bytes(),
        data: FungibleTokenPacketDatumSchema,
      }),
    }),
    DataApi.Object({
      RefundVoucher: DataApi.Object({
        packet_source_port: DataApi.Bytes(),
        packet_source_channel: DataApi.Bytes(),
        data: FungibleTokenPacketDatumSchema,
        acknowledgement: DataApi.Nullable(AcknowledgementSchema),
      }),
    }),
  ]);
}

export function encodeMintVoucherRedeemer(
  mintVoucherRedeemer: MintVoucherRedeemer,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const MintVoucherRedeemerSchema = mintVoucherRedeemerSchema(Lucid.Data);
  type TMintVoucherRedeemer = Data.Static<typeof MintVoucherRedeemerSchema>;
  const TMintVoucherRedeemer =
    MintVoucherRedeemerSchema as unknown as TMintVoucherRedeemer;

  return Data.to(mintVoucherRedeemer, TMintVoucherRedeemer, {
    canonical: true,
  });
}

export function decodeMintVoucherRedeemer(
  mintVoucherRedeemer: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): MintVoucherRedeemer {
  const MintVoucherRedeemerSchema = mintVoucherRedeemerSchema(Lucid.Data);
  type TMintVoucherRedeemer = Data.Static<typeof MintVoucherRedeemerSchema>;
  const TMintVoucherRedeemer =
    MintVoucherRedeemerSchema as unknown as TMintVoucherRedeemer;

  return Data.from(mintVoucherRedeemer, TMintVoucherRedeemer);
}
