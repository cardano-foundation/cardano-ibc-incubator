import { Data } from '@lucid-evolution/lucid';
import { FungibleTokenPacketDatum } from '../types/fungible-token-packet-data';
export type MintVoucherRedeemer =
  | {
      MintVoucher: {
        packet_source_port: string;
        packet_source_channel: string;
        packet_dest_port: string;
        packet_dest_channel: string;
      };
    }
  | {
      BurnVoucher: {
        packet_source_port: string;
        packet_source_channel: string;
      };
    }
  | {
      RefundVoucher: {
        packet_source_port: string;
        packet_source_channel: string;
      };
    };

export function encodeMintVoucherRedeemer(
  mintVoucherRedeemer: MintVoucherRedeemer,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;

  const MintVoucherRedeemerSchema = Data.Enum([
    Data.Object({
      MintVoucher: Data.Object({
        packet_source_port: Data.Bytes(),
        packet_source_channel: Data.Bytes(),
        packet_dest_port: Data.Bytes(),
        packet_dest_channel: Data.Bytes(),
      }),
    }),
    Data.Object({
      BurnVoucher: Data.Object({
        packet_source_port: Data.Bytes(),
        packet_source_channel: Data.Bytes(),
      }),
    }),
    Data.Object({
      RefundVoucher: Data.Object({
        packet_source_port: Data.Bytes(),
        packet_source_channel: Data.Bytes(),
      }),
    }),
  ]);
  type TMintVoucherRedeemer = Data.Static<typeof MintVoucherRedeemerSchema>;
  const TMintVoucherRedeemer = MintVoucherRedeemerSchema as unknown as MintVoucherRedeemer;

  return Data.to(mintVoucherRedeemer, TMintVoucherRedeemer);
}
