import type { NextApiRequest, NextApiResponse } from 'next';
import { createTxBuilderRuntime } from '@cardano-ibc/tx-builder-runtime';
import { CARDANO_BRIDGE_MANIFEST_URL, KUPMIOS_URL } from '@/configs/runtime';

const transferBuilderRuntime = createTxBuilderRuntime({
  bridgeManifestUrl: CARDANO_BRIDGE_MANIFEST_URL,
  kupmiosUrl: KUPMIOS_URL,
});

type LocalUnsignedTransferResponse = Awaited<
  ReturnType<typeof transferBuilderRuntime.buildUnsignedTransfer>
>;

type ErrorResponse = {
  message: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LocalUnsignedTransferResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const response = await transferBuilderRuntime.buildUnsignedTransfer(
      req.body,
    );
    return res.status(200).json(response);
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'Failed to build local Cardano unsigned transaction.';
    return res.status(500).json({ message });
  }
}
