import { PolicyId, UTxO } from '@lucid-evolution/lucid';
import { AuthToken } from '@shared/types/auth-token';
import { GatewayModuleKey } from '@shared/helpers/module-port';

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

export type WithModuleContext = {
  moduleKey: GatewayModuleKey;
  moduleUtxo: UTxO;
};

export type WithChannelSpend = {
  encodedSpendChannelRedeemer: string;
  encodedUpdatedChannelDatum: string;
  channelTokenUnit: string;
};

export type WithModuleSpend = {
  encodedSpendModuleRedeemer: string;
};

export type WithVerifyProof = {
  verifyProofPolicyId: PolicyId;
  encodedVerifyProofRedeemer: string;
};

export type WithConstructedAddress = {
  constructedAddress: string;
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
