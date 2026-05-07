import type { NextApiRequest, NextApiResponse } from 'next';
import type { CardanoAssetDenomTrace } from '@/types/cardanoTrace';
import { lookupCardanoAssetDenomTraceFromRegistry } from '@/services/cardanoTraceRegistry';

type ErrorResponse = {
  message: string;
};

function getAssetId(req: NextApiRequest): string {
  const { assetId } = req.query;
  const value = Array.isArray(assetId) ? assetId[0] : assetId;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Cardano asset id is required.');
  }

  const normalized = value.trim();
  if (normalized.length > 256) {
    throw new Error('Cardano asset id is too long.');
  }

  return normalized;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Failed to resolve Cardano asset denom trace.';
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CardanoAssetDenomTrace | ErrorResponse>,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const trace = await lookupCardanoAssetDenomTraceFromRegistry(
      getAssetId(req),
    );
    return res.status(200).json(trace);
  } catch (error) {
    const statusCode =
      error instanceof Error &&
      (error.message.includes('required') || error.message.includes('too long'))
        ? 400
        : 500;
    return res.status(statusCode).json({ message: getErrorMessage(error) });
  }
}
