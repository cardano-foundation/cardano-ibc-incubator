import { Data } from "@lucid-evolution/lucid";

export const BridgeDeploymentSchema = Data.Object({
  host_state_nft_policy_id: Data.Bytes(),
  channel_minting_policy_id: Data.Bytes(),
});

export type BridgeDeployment = Data.Static<typeof BridgeDeploymentSchema>;
export const BridgeDeployment =
  BridgeDeploymentSchema as unknown as BridgeDeployment;

export const BridgeRegistryDatumSchema = Data.Object({
  active_deployment: BridgeDeploymentSchema,
  active_voucher_policy_id: Data.Bytes(),
  legacy_voucher_policy_ids: Data.Array(Data.Bytes()),
  governance_key_hash: Data.Bytes(),
});

export type BridgeRegistryDatum = Data.Static<typeof BridgeRegistryDatumSchema>;
export const BridgeRegistryDatum =
  BridgeRegistryDatumSchema as unknown as BridgeRegistryDatum;

export const BridgeRegistryRedeemerSchema = Data.Enum([
  Data.Literal("UpdateBridgeRegistry"),
]);

export type BridgeRegistryRedeemer = Data.Static<
  typeof BridgeRegistryRedeemerSchema
>;
export const BridgeRegistryRedeemer =
  BridgeRegistryRedeemerSchema as unknown as BridgeRegistryRedeemer;
