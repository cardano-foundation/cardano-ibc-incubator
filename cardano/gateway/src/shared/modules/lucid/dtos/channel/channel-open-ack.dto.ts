import { PolicyId, UTxO } from '@dinhbx/lucid-custom';
import { AuthToken } from '~@/shared/types/auth-token';

export type UnsignedChannelOpenAckDto = {
  channelUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  spendChannelRefUtxo: UTxO;
  spendTransferModuleRefUtxo: UTxO;
  transferModuleUtxo: UTxO;
  encodedSpendChannelRedeemer: string;
  encodedSpendTransferModuleRedeemer: string;
  channelTokenUnit: string;
  encodedUpdatedChannelDatum: string;
  constructedAddress: string;
  chanOpenAckPolicyId: PolicyId;
  chanOpenAckRefUtxo: UTxO;
  channelToken: AuthToken;

  verifyProofPolicyId: PolicyId;
  verifyProofRefUTxO: UTxO;
  encodedVerifyProofRedeemer: string;
};
