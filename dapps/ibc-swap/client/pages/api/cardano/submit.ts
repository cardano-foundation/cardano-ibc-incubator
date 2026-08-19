import type { NextApiRequest, NextApiResponse } from 'next';
import { GATEWAY_TX_BUILDER_ENDPOINT } from '@/configs/runtime';
import { fetchCardanoResource } from '@/services/validatedBridgeManifestFetch';

type LocalSubmitSignedTransactionResponse = { txHash: string };

type GatewaySubmitResponse = { tx_hash?: unknown };

type ErrorResponse = {
  message: string;
  details?: unknown;
};

let submitRequestCounter = 0;

function startTimer(): bigint {
  return process.hrtime.bigint();
}

function elapsedMs(start: bigint): string {
  const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
  return `${Math.round(elapsed)}ms`;
}

function serializeError(error: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';

  if (error instanceof Error) {
    const errorWithCause = error as Error & { cause?: unknown };
    return {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
      cause:
        errorWithCause.cause === undefined
          ? undefined
          : serializeError(errorWithCause.cause, depth + 1),
    };
  }

  if (typeof error !== 'object' || error === null) {
    return error;
  }

  const details: Record<string, unknown> = {};
  [
    'name',
    'message',
    'reason',
    'method',
    'url',
    'request',
    'response',
    'status',
    'cause',
  ].forEach((key) => {
    const value = (error as Record<string, unknown>)[key];
    if (value !== undefined) {
      details[key] = key === 'cause' ? serializeError(value, depth + 1) : value;
    }
  });

  return Object.keys(details).length > 0 ? details : String(error);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LocalSubmitSignedTransactionResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  submitRequestCounter += 1;
  const requestId = submitRequestCounter;
  const startedAt = startTimer();
  console.log(`[cardano-submit:${requestId}] submitting signed transfer`);

  try {
    const signedTxCbor = req.body?.signed_tx_cbor;
    if (
      typeof signedTxCbor !== 'string' ||
      signedTxCbor.length === 0 ||
      signedTxCbor.length % 2 !== 0 ||
      !/^[0-9a-f]+$/i.test(signedTxCbor)
    ) {
      return res.status(400).json({
        message:
          '"signed_tx_cbor" must be non-empty, even-length hexadecimal CBOR.',
      });
    }
    const gatewayResponse = await fetchCardanoResource(
      `${GATEWAY_TX_BUILDER_ENDPOINT}/api/cardano/submit`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          signed_tx_cbor: signedTxCbor,
          description:
            typeof req.body?.description === 'string'
              ? req.body.description
              : 'IBC transfer signed by browser wallet',
        }),
      },
    );
    const gatewayBody =
      (await gatewayResponse.json()) as GatewaySubmitResponse & {
        message?: string;
      };
    if (!gatewayResponse.ok) {
      throw new Error(
        gatewayBody.message ||
          `Gateway submission failed: ${gatewayResponse.status} ${gatewayResponse.statusText}`,
      );
    }
    if (typeof gatewayBody.tx_hash !== 'string' || !gatewayBody.tx_hash) {
      throw new Error('Gateway submission response did not contain tx_hash');
    }
    const response = { txHash: gatewayBody.tx_hash };
    console.log(
      `[cardano-submit:${requestId}] submitted signed transfer in ${elapsedMs(
        startedAt,
      )}`,
    );
    return res.status(200).json(response);
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'Failed to submit signed Cardano transaction.';
    console.error(
      `[cardano-submit:${requestId}] failed to submit signed transfer in ${elapsedMs(
        startedAt,
      )}`,
      error,
    );
    return res.status(500).json({
      message,
      ...(process.env.NODE_ENV === 'production'
        ? {}
        : { details: serializeError(error) }),
    });
  }
}
