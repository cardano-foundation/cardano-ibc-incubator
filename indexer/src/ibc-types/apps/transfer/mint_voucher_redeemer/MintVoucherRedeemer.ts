import {Data} from '../../../plutus/data';

export const MintVoucherRedeemerSchema = Data.Enum([
  Data.Object({
    MintVoucher: Data.Object({
      packet_source_port: Data.Bytes(),
      packet_source_channel: Data.Bytes(),
      packet_dest_port: Data.Bytes(),
      packet_dest_channel: Data.Bytes(),
    }),
  }),
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
  Data.Object({
    RefundVoucher: Data.Object({
      packet_source_port: Data.Bytes(),
      packet_source_channel: Data.Bytes(),
    }),
  }),
]);
export type MintVoucherRedeemer = Data.Static<typeof MintVoucherRedeemerSchema>;
export const MintVoucherRedeemer = MintVoucherRedeemerSchema as unknown as MintVoucherRedeemer;
