import { PolicyId, UTxO } from '@cuonglv0297/lucid-custom';

export type UnsignedConnectionOpenAckDto = {
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  constructedAddress: string;

  spendConnectionRefUtxo: UTxO;
  verifyProofRefUTxO: UTxO;

  connectionTokenUnit: string;
  encodedSpendConnectionRedeemer: string;
  encodedUpdatedConnectionDatum: string;

  verifyProofPolicyId: PolicyId;
  encodedVerifyProofRedeemer: string;
};
