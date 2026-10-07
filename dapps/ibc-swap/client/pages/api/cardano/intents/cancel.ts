import type { NextApiRequest, NextApiResponse } from 'next';
import { GATEWAY_TX_BUILDER_ENDPOINT } from '@/configs/runtime';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Method not allowed' });
  }
  const {
    channel_id: channel,
    intent_tx_hash: hash,
    signer,
    output_index: outputIndex,
  } = req.body ?? {};
  if (
    typeof channel !== 'string' ||
    !/^channel-(0|[1-9][0-9]*)$/.test(channel) ||
    typeof hash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(hash) ||
    typeof signer !== 'string' ||
    !signer.trim() ||
    (outputIndex !== undefined &&
      (!Number.isInteger(outputIndex) ||
        outputIndex < 0 ||
        outputIndex > 0xffffffff))
  ) {
    return res
      .status(400)
      .json({ message: 'Invalid intent cancellation request' });
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    const response = await fetch(
      `${GATEWAY_TX_BUILDER_ENDPOINT}/api/cardano/intents/${channel}/${hash}/cancel`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signer, output_index: outputIndex }),
        signal: AbortSignal.timeout(30_000),
        cache: 'no-store',
      },
    );
    return res.status(response.status).json(await response.json());
  } catch (error) {
    return res
      .status(502)
      .json({
        message:
          error instanceof Error
            ? error.message
            : 'Unable to build cancellation',
      });
  }
}
