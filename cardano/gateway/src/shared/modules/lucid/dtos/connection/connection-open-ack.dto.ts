import { PolicyId, UTxO } from '@lucid-evolution/lucid';

export type UnsignedConnectionOpenAckDto = {
  hostStateUtxo: UTxO;
  encodedHostStateRedeemer: string;
  encodedUpdatedHostStateDatum: string;

  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  constructedAddress: string;

  connectionTokenUnit: string;
  encodedSpendConnectionRedeemer: string;
  encodedUpdatedConnectionDatum: string;

  verifyProofPolicyId: PolicyId;
  encodedVerifyProofRedeemer: string;
};
