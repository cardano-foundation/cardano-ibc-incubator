import { dappApiPath } from '@/configs/runtime';

export type FundedIntent = { hash: string; channel: string; signer: string };
export type IntentStatus = {
  stage: 'pending' | 'funded' | 'sent' | 'cancelled';
  packetTxHash?: string;
  packetSequence?: string;
};

export async function intentRequest(
  intent: FundedIntent,
): Promise<IntentStatus> {
  const query = new URLSearchParams({
    channel_id: intent.channel,
    intent_tx_hash: intent.hash,
  });
  const response = await fetch(dappApiPath(`/api/cardano/intents?${query}`));
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.message || 'Unable to read funded request status');
  return result as IntentStatus;
}
