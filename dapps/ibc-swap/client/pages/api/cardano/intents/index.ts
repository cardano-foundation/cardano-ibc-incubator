import type { NextApiRequest, NextApiResponse } from 'next';
import { GATEWAY_TX_BUILDER_ENDPOINT } from '@/configs/runtime';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ message: 'Method not allowed' });
  }
  const { channel_id: channel, intent_tx_hash: hash } = req.query;
  if (
    typeof channel !== 'string' ||
    !/^channel-(0|[1-9][0-9]*)$/.test(channel) ||
    typeof hash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(hash)
  ) {
    return res.status(400).json({ message: 'Invalid channel or intent hash' });
  }
  try {
    const response = await fetch(
      `${GATEWAY_TX_BUILDER_ENDPOINT}/api/cardano/intents/${channel}/${hash}`,
      {
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
      },
    );
    res.setHeader('Cache-Control', 'no-store');
    return res.status(response.status).json(await response.json());
  } catch (error) {
    return res.status(502).json({
      message:
        error instanceof Error ? error.message : 'Intent status unavailable',
    });
  }
}
