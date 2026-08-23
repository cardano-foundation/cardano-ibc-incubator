import { Data } from '@lucid-evolution/lucid';
import { FungibleTokenPacketDatum, fungibleTokenPacketDatumSchema } from '../types/fungible-token-packet-data';
export type TransferModuleRedeemer =
  | {
      Transfer: {
        channel_id: string;
        data: FungibleTokenPacketDatum;
      };
    }
  | 'OtherTransferOp'
  | {
      ReclaimEscrowShard: {
        channel_id: string;
        denom: string;
      };
    };

export function transferModuleRedeemerSchema(Lucid: typeof import('@lucid-evolution/lucid')) {
  const { Data } = Lucid;
  return Data.Enum([
    Data.Object({
      Transfer: Data.Object({
        channel_id: Data.Bytes(),
        data: fungibleTokenPacketDatumSchema(Lucid),
      }),
    }),
    Data.Literal('OtherTransferOp'),
    Data.Object({
      ReclaimEscrowShard: Data.Object({
        channel_id: Data.Bytes(),
        denom: Data.Bytes(),
      }),
    }),
  ]);
}

export function encodeTransferModuleRedeemer(
  transferModuleRedeemer: TransferModuleRedeemer,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;

  const TransferModuleRedeemerSchema = transferModuleRedeemerSchema(Lucid);
  type TTransferModuleRedeemer = Data.Static<typeof TransferModuleRedeemerSchema>;
  const TTransferModuleRedeemer = TransferModuleRedeemerSchema as unknown as TransferModuleRedeemer;

  return Data.to(transferModuleRedeemer, TTransferModuleRedeemer, { canonical: true });
}

// cast to fungibleTokenPacket
export function castToTransferModuleRedeemer(
  transferModuleRedeemer: TransferModuleRedeemer,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;

  const TransferModuleRedeemerSchema = transferModuleRedeemerSchema(Lucid);
  type TTransferModuleRedeemer = Data.Static<typeof TransferModuleRedeemerSchema>;
  const TTransferModuleRedeemer = TransferModuleRedeemerSchema as unknown as TransferModuleRedeemer;

  return Data.castTo(transferModuleRedeemer, TTransferModuleRedeemer);
}
