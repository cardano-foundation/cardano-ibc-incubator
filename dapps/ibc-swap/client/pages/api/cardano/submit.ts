import type { NextApiRequest, NextApiResponse } from 'next';
import { createTxBuilderRuntime } from '@cardano-ibc/tx-builder-runtime';
import {
  CARDANO_BRIDGE_MANIFEST_URL,
  KUPMIOS_AUTH_HEADERS,
  KUPMIOS_URL,
} from '@/configs/runtime';

const submitRuntime = createTxBuilderRuntime({
  bridgeManifestUrl: CARDANO_BRIDGE_MANIFEST_URL,
  kupmiosUrl: KUPMIOS_URL,
  kupmiosHeaders: KUPMIOS_AUTH_HEADERS,
});

type LocalSubmitSignedTransactionResponse = Awaited<
  ReturnType<typeof submitRuntime.submitSignedTransaction>
>;

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
    const response = await submitRuntime.submitSignedTransaction(req.body);
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
