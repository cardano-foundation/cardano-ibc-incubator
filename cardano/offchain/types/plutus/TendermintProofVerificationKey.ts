import { Data } from "@lucid-evolution/lucid";

const TendermintProofCommitmentKeySchema = Data.Object({
  g: Data.Bytes(),
  g_sigma_neg: Data.Bytes(),
});

export const TendermintProofVerificationKeySchema = Data.Object({
  alpha_g1: Data.Bytes(),
  beta_g2: Data.Bytes(),
  gamma_g2: Data.Bytes(),
  delta_g2: Data.Bytes(),
  ic: Data.Array(Data.Bytes()),
  commitment_key: TendermintProofCommitmentKeySchema,
});

export type TendermintProofVerificationKey = Data.Static<
  typeof TendermintProofVerificationKeySchema
>;
