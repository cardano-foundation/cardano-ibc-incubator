import { Data } from '@dinhbx/lucid-custom';
import { FungibleTokenPacketDatum } from '../types/fungible-token-packet-data';
export type TransferModuleRedeemer =
  | {
      Transfer: {
        channel_id: string;
        data: FungibleTokenPacketDatum;
      };
    }
  | 'OtherTransferOp';

export function encodeTransferModuleRedeemer(
  transferModuleRedeemer: TransferModuleRedeemer,
  Lucid: typeof import('@dinhbx/lucid-custom'),
) {
  const { Data } = Lucid;

  const FungibleTokenPacketDataSchema = Data.Object({
    denom: Data.Bytes(),
    amount: Data.Bytes(),
    sender: Data.Bytes(),
    receiver: Data.Bytes(),
    memo: Data.Bytes(),
  });

  const TransferModuleRedeemerSchema = Data.Enum([
    Data.Object({
      Transfer: Data.Object({
        channel_id: Data.Bytes(),
        data: FungibleTokenPacketDataSchema,
      }),
    }),
    Data.Literal('OtherTransferOp'),
  ]);
  type TTransferModuleRedeemer = Data.Static<typeof TransferModuleRedeemerSchema>;
  const TTransferModuleRedeemer = TransferModuleRedeemerSchema as unknown as TransferModuleRedeemer;

  return Data.to(transferModuleRedeemer, TTransferModuleRedeemer);
}

// cast to fungibleTokenPacket
export function castToTransferModuleRedeemer(
  transferModuleRedeemer: TransferModuleRedeemer,
  Lucid: typeof import('@dinhbx/lucid-custom'),
) {
  const { Data } = Lucid;

  const FungibleTokenPacketDataSchema = Data.Object({
    denom: Data.Bytes(),
    amount: Data.Bytes(),
    sender: Data.Bytes(),
    receiver: Data.Bytes(),
    memo: Data.Bytes(),
  });

  const TransferModuleRedeemerSchema = Data.Enum([
    Data.Object({
      Transfer: Data.Object({
        channel_id: Data.Bytes(),
        data: FungibleTokenPacketDataSchema,
      }),
    }),
    Data.Literal('OtherTransferOp'),
  ]);
  type TTransferModuleRedeemer = Data.Static<typeof TransferModuleRedeemerSchema>;
  const TTransferModuleRedeemer = TransferModuleRedeemerSchema as unknown as TransferModuleRedeemer;

  return Data.castTo(transferModuleRedeemer, TTransferModuleRedeemer);
}
