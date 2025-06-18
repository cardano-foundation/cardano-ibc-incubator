import { PolicyId, UTxO } from '@lucid-evolution/lucid';

export type UnsignedConnectionOpenAckDto = {
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  constructedAddress: string;

  connectionTokenUnit: string;
  encodedSpendConnectionRedeemer: string;
  encodedUpdatedConnectionDatum: string;

  verifyProofPolicyId: PolicyId;
  encodedVerifyProofRedeemer: string;
};
