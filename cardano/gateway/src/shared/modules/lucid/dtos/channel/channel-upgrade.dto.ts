import { UTxO } from '@lucid-evolution/lucid';
import { AuthToken } from '~@/shared/types/auth-token';

export type ChannelUpgradeOperation = 'channelUpgrade' | 'channelUpgradeHandshake' | 'channelUpgradeFinish';

export type UnsignedChannelUpgradeDto = {
  hostStateUtxo: UTxO;
  encodedHostStateRedeemer: string;
  encodedUpdatedHostStateDatum: string;

  channelUtxo: UTxO;
  channelToken: AuthToken;
  encodedSpendChannelRedeemer: string;
  encodedUpdatedChannelDatum: string;

  // The upgrade operation that validates this step, minted once.
  operation: ChannelUpgradeOperation;
  operationPolicyId: string;
  // Connections, the proof client, packet configuration, send sequencer and lanes.
  referenceInputs: UTxO[];
  proof?: { policyId: string; encodedRedeemer: string };
  // The deployment authority's key hash, for INIT and an unproven CANCEL.
  authorityKeyHash?: string;
};
