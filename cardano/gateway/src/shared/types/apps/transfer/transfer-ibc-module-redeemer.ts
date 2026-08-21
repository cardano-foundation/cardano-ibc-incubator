import { decodeIBCModuleRedeemer, encodeIBCModuleRedeemer, IBCModuleRedeemer } from '../../port/ibc_module_redeemer';
import {
  TransferModuleRedeemer,
  transferModuleRedeemerSchema,
} from './transfer_module_redeemer/transfer-module-redeemer';
import { FungibleTokenPacketDatum, fungibleTokenPacketDatumSchema } from './types/fungible-token-packet-data';

export type TransferIBCModuleRedeemer = IBCModuleRedeemer<FungibleTokenPacketDatum, TransferModuleRedeemer>;

function transferSchemas(Lucid: typeof import('@lucid-evolution/lucid')) {
  return {
    moduleData: fungibleTokenPacketDatumSchema(Lucid),
    moduleOperator: transferModuleRedeemerSchema(Lucid),
  };
}

export function encodeTransferIBCModuleRedeemer(
  redeemer: TransferIBCModuleRedeemer,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  return encodeIBCModuleRedeemer(redeemer, Lucid, transferSchemas(Lucid));
}

export function decodeTransferIBCModuleRedeemer(
  redeemer: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): TransferIBCModuleRedeemer {
  return decodeIBCModuleRedeemer<FungibleTokenPacketDatum, TransferModuleRedeemer>(
    redeemer,
    Lucid,
    transferSchemas(Lucid),
  );
}
