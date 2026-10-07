import { dappApiPath } from '@/configs/runtime';

export type FundedIntent = {
  hash: string;
  channel: string;
  signer: string;
  outputIndex?: number;
};
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

export async function cancelIntent(
  intent: FundedIntent,
  signer: string,
  signAndSubmit: (unsignedTx: string) => Promise<string>,
): Promise<string> {
  if (!signer || signer !== intent.signer)
    throw new Error('Connect the wallet that funded this request to cancel it');
  const response = await fetch(dappApiPath('/api/cardano/intents/cancel'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel_id: intent.channel,
      intent_tx_hash: intent.hash,
      signer,
      output_index: intent.outputIndex,
    }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.message || 'Unable to build cancellation');
  const unsignedTx = Buffer.from(
    result.unsigned_tx?.value ?? '',
    'base64',
  ).toString('utf8');
  if (!unsignedTx || !/^(?:[0-9a-f]{2})+$/.test(unsignedTx))
    throw new Error('Invalid cancellation transaction');
  return signAndSubmit(unsignedTx);
}
