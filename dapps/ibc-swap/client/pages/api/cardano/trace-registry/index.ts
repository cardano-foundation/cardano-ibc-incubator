import type { NextApiRequest, NextApiResponse } from 'next';
import type { CardanoAssetDenomTrace } from '@/types/cardanoTrace';
import { listCardanoIbcAssetsFromRegistry } from '@/services/cardanoTraceRegistry';

type ErrorResponse = {
  message: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Failed to list Cardano IBC assets.';
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CardanoAssetDenomTrace[] | ErrorResponse>,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const assets = await listCardanoIbcAssetsFromRegistry();
    return res.status(200).json(assets);
  } catch (error) {
    return res.status(500).json({ message: getErrorMessage(error) });
  }
}
