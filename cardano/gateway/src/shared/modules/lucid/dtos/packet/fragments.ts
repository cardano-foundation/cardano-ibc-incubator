import { PolicyId, UTxO } from '@lucid-evolution/lucid';
import { AuthToken } from '@shared/types/auth-token';

// Composable DTO fragments: packet DTOs are formed via intersection types (`&`)
// so shared tx fields are defined once and reused consistently.
export type WithHostStateUpdate = {
  hostStateUtxo: UTxO;
  encodedHostStateRedeemer: string;
  encodedUpdatedHostStateDatum: string;
};

export type WithChannelContext = {
  channelUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
};

// Legacy naming is kept where call sites still use `*UTxO` keys. This avoids
// broad churn while still allowing new DTOs to compose from one source.
export type WithLegacyChannelContext = {
  channelUTxO: UTxO;
  connectionUTxO: UTxO;
  clientUTxO: UTxO;
};

export type WithTransferModuleUtxo = {
  transferModuleUtxo: UTxO;
};

export type WithMockModuleUtxo = {
  mockModuleUtxo: UTxO;
};

export type WithLegacyTransferModuleUtxo = {
  transferModuleUTxO: UTxO;
};

export type WithChannelSpend = {
  encodedSpendChannelRedeemer: string;
  encodedUpdatedChannelDatum: string;
  channelTokenUnit: string;
};

export type WithTransferModuleSpend = {
  encodedSpendTransferModuleRedeemer: string;
};

export type WithMockModuleSpend = {
  encodedSpendMockModuleRedeemer: string;
};

export type WithMintVoucherRedeemer = {
  encodedMintVoucherRedeemer: string;
};

export type WithVerifyProof = {
  verifyProofPolicyId: PolicyId;
  encodedVerifyProofRedeemer: string;
};

export type WithConstructedAddress = {
  constructedAddress: string;
};

export type WithTransferAmount = {
  transferAmount: bigint;
};

export type WithChannelToken = {
  channelToken: AuthToken;
};

// Generic helper for operation-specific policy-id keys
// (e.g. `ackPacketPolicyId`, `recvPacketPolicyId`, `sendPacketPolicyId`).
export type WithPolicyId<K extends string> = {
  [P in K]: PolicyId;
};

export type WithPacketPolicyAndChannelToken<K extends string> = WithPolicyId<K> & WithChannelToken;
