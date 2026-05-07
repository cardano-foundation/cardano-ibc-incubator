/* eslint-disable no-console */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createTxBuilderRuntime } from '@cardano-ibc/tx-builder-runtime';
import { CARDANO_BRIDGE_MANIFEST_URL, KUPMIOS_URL } from '@/configs/runtime';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '64kb',
    },
  },
};

const MAX_MEMO_LENGTH = 8192;
const MAX_WALLET_UTXOS = 100;
const MAX_ASSETS_PER_UTXO = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;

const transferBuilderRuntime = createTxBuilderRuntime({
  bridgeManifestUrl: CARDANO_BRIDGE_MANIFEST_URL,
  kupmiosUrl: KUPMIOS_URL,
});

type LocalUnsignedTransferResponse = Awaited<
  ReturnType<typeof transferBuilderRuntime.buildUnsignedTransfer>
>;

type ErrorResponse = {
  code: string;
  message: string;
  requestId: string;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

class ApiRouteError extends Error {
  statusCode: number;

  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();

const splitConfiguredOrigins = (): string[] =>
  [
    process.env.IBC_SWAP_CARDANO_TRANSFER_ALLOWED_ORIGINS,
    process.env.IBC_SWAP_ALLOWED_ORIGINS,
    process.env.NEXT_PUBLIC_APP_ORIGIN,
  ]
    .flatMap((value) => value?.split(',') ?? [])
    .map((value) => value.trim())
    .filter(Boolean);

const configuredAllowedOrigins = new Set(splitConfiguredOrigins());

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRequestId(req: NextApiRequest): string {
  const header = req.headers['x-request-id'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim().slice(0, 128);
  }

  return `cardano-transfer-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function getClientIp(req: NextApiRequest): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.socket.remoteAddress ?? 'unknown';
}

function getRequestOrigin(req: NextApiRequest): string | undefined {
  const { origin } = req.headers;
  return typeof origin === 'string' && origin.trim()
    ? origin.trim()
    : undefined;
}

function isSameHostOrigin(req: NextApiRequest, origin: string): boolean {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const hostValue = Array.isArray(host) ? host[0] : host;
  if (!hostValue) return false;

  try {
    return new URL(origin).host === hostValue;
  } catch {
    return false;
  }
}

function assertAllowedOrigin(req: NextApiRequest, res: NextApiResponse): void {
  const origin = getRequestOrigin(req);
  if (!origin) return;

  if (configuredAllowedOrigins.has(origin) || isSameHostOrigin(req, origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    return;
  }

  throw new ApiRouteError(403, 'origin_not_allowed', 'Origin is not allowed.');
}

function applyPreflightHeaders(res: NextApiResponse): void {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id');
  res.setHeader('Access-Control-Max-Age', '600');
}

function checkRateLimit(req: NextApiRequest, res: NextApiResponse): void {
  const key = getClientIp(req);
  const now = Date.now();
  const existing = rateLimitBuckets.get(key);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - bucket.count);
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS.toString());
  res.setHeader('X-RateLimit-Remaining', remaining.toString());
  res.setHeader(
    'X-RateLimit-Reset',
    Math.ceil(bucket.resetAt / 1000).toString(),
  );

  if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
    res.setHeader(
      'Retry-After',
      Math.ceil((bucket.resetAt - now) / 1000).toString(),
    );
    throw new ApiRouteError(
      429,
      'rate_limited',
      'Too many Cardano transfer build requests. Please retry shortly.',
    );
  }
}

function requireString(
  body: Record<string, unknown>,
  fieldName: string,
  maxLength: number,
): string {
  const value = body[fieldName];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiRouteError(
      400,
      'invalid_request',
      `"${fieldName}" is required.`,
    );
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ApiRouteError(
      400,
      'invalid_request',
      `"${fieldName}" is too long.`,
    );
  }

  return trimmed;
}

function optionalString(
  body: Record<string, unknown>,
  fieldName: string,
  maxLength: number,
): string | undefined {
  const value = body[fieldName];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new ApiRouteError(
      400,
      'invalid_request',
      `"${fieldName}" must be a string.`,
    );
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ApiRouteError(
      400,
      'invalid_request',
      `"${fieldName}" is too long.`,
    );
  }

  return trimmed;
}

function requireDecimalString(
  body: Record<string, unknown>,
  fieldName: string,
  maxLength = 80,
): string {
  const value = requireString(body, fieldName, maxLength);
  if (!/^[0-9]+$/.test(value)) {
    throw new ApiRouteError(
      400,
      'invalid_request',
      `"${fieldName}" must be a decimal integer string.`,
    );
  }

  return value;
}

function optionalDecimalString(
  body: Record<string, unknown>,
  fieldName: string,
  maxLength = 80,
): string | undefined {
  const value = optionalString(body, fieldName, maxLength);
  if (value !== undefined && !/^[0-9]+$/.test(value)) {
    throw new ApiRouteError(
      400,
      'invalid_request',
      `"${fieldName}" must be a decimal integer string.`,
    );
  }

  return value;
}

function parseToken(value: unknown): { denom: string; amount: string } {
  if (!isPlainRecord(value)) {
    throw new ApiRouteError(400, 'invalid_request', '"token" is required.');
  }

  const amount = requireDecimalString(value, 'amount');
  if (/^0+$/.test(amount)) {
    throw new ApiRouteError(
      400,
      'invalid_request',
      '"token.amount" must be greater than zero.',
    );
  }

  return {
    denom: requireString(value, 'denom', 512),
    amount,
  };
}

function parseTimeoutHeight(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (!isPlainRecord(value)) {
    throw new ApiRouteError(
      400,
      'invalid_request',
      '"timeout_height" must be an object.',
    );
  }

  const revisionNumber = optionalDecimalString(value, 'revision_number', 32);
  const revisionHeight = optionalDecimalString(value, 'revision_height', 32);
  if (!revisionNumber && !revisionHeight) return undefined;

  return {
    revision_number: revisionNumber ?? '0',
    revision_height: revisionHeight ?? '0',
  };
}

function parseWalletUtxos(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new ApiRouteError(
      400,
      'invalid_request',
      '"wallet_utxos" must be an array.',
    );
  }
  if (value.length > MAX_WALLET_UTXOS) {
    throw new ApiRouteError(
      400,
      'invalid_request',
      `"wallet_utxos" may include at most ${MAX_WALLET_UTXOS} entries.`,
    );
  }

  return value.map((utxo, index) => {
    if (!isPlainRecord(utxo)) {
      throw new ApiRouteError(
        400,
        'invalid_request',
        `"wallet_utxos[${index}]" must be an object.`,
      );
    }

    const { outputIndex } = utxo;
    if (
      typeof outputIndex !== 'number' ||
      !Number.isSafeInteger(outputIndex) ||
      outputIndex < 0
    ) {
      throw new ApiRouteError(
        400,
        'invalid_request',
        `"wallet_utxos[${index}].outputIndex" must be a non-negative integer.`,
      );
    }

    if (!isPlainRecord(utxo.assets)) {
      throw new ApiRouteError(
        400,
        'invalid_request',
        `"wallet_utxos[${index}].assets" must be an object.`,
      );
    }

    const assetEntries = Object.entries(utxo.assets);
    if (assetEntries.length > MAX_ASSETS_PER_UTXO) {
      throw new ApiRouteError(
        400,
        'invalid_request',
        `"wallet_utxos[${index}].assets" has too many entries.`,
      );
    }

    const assets = assetEntries.reduce<Record<string, string>>(
      (normalizedAssets, [unit, quantity]) => {
        if (!unit || unit.length > 256) {
          throw new ApiRouteError(
            400,
            'invalid_request',
            `"wallet_utxos[${index}].assets" contains an invalid unit.`,
          );
        }
        if (typeof quantity !== 'string' || !/^[0-9]+$/.test(quantity)) {
          throw new ApiRouteError(
            400,
            'invalid_request',
            `"wallet_utxos[${index}].assets.${unit}" must be a decimal string.`,
          );
        }

        return {
          ...normalizedAssets,
          [unit]: quantity,
        };
      },
      {},
    );

    return {
      txHash: requireString(utxo, 'txHash', 128),
      outputIndex,
      address: requireString(utxo, 'address', 256),
      assets,
      datumHash: optionalString(utxo, 'datumHash', 256) ?? null,
      datum: optionalString(utxo, 'datum', 20_000) ?? null,
      scriptRef: utxo.scriptRef ?? null,
    };
  });
}

function validateTransferRequestBody(body: unknown) {
  if (!isPlainRecord(body)) {
    throw new ApiRouteError(
      400,
      'invalid_request',
      'Request body must be a JSON object.',
    );
  }

  const sourceChannel = requireString(body, 'source_channel', 64);
  if (!/^channel-[0-9]+$/.test(sourceChannel)) {
    throw new ApiRouteError(
      400,
      'invalid_request',
      '"source_channel" must match channel-{number}.',
    );
  }

  return {
    source_port: requireString(body, 'source_port', 64),
    source_channel: sourceChannel,
    token: parseToken(body.token),
    sender: optionalString(body, 'sender', 256),
    receiver: requireString(body, 'receiver', 512),
    timeout_height: parseTimeoutHeight(body.timeout_height),
    timeout_timestamp: optionalDecimalString(body, 'timeout_timestamp', 32),
    memo: optionalString(body, 'memo', MAX_MEMO_LENGTH),
    signer: requireString(body, 'signer', 256),
    wallet_utxos: parseWalletUtxos(body.wallet_utxos),
  };
}

function classifyBuildError(error: unknown): ApiRouteError {
  if (error instanceof ApiRouteError) return error;

  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : 'Failed to build local Cardano unsigned transaction.';

  if (
    message.startsWith('Invalid argument:') ||
    message.includes('no spendable UTxOs') ||
    message.includes('Unable to find UTxO with unit')
  ) {
    return new ApiRouteError(400, 'build_rejected', message);
  }

  return new ApiRouteError(
    500,
    'build_failed',
    'Failed to build local Cardano unsigned transaction.',
  );
}

function logTransferBuildEvent(
  level: 'info' | 'warn' | 'error',
  payload: Record<string, unknown>,
): void {
  console[level](
    JSON.stringify({ service: 'cardano-transfer-api', ...payload }),
  );
}

function writeError(
  res: NextApiResponse<ErrorResponse>,
  requestId: string,
  error: ApiRouteError,
) {
  return res.status(error.statusCode).json({
    code: error.code,
    message: error.message,
    requestId,
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LocalUnsignedTransferResponse | ErrorResponse>,
) {
  const requestId = getRequestId(req);
  const startedAt = Date.now();

  try {
    assertAllowedOrigin(req, res);
    applyPreflightHeaders(res);

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS');
      return writeError(
        res,
        requestId,
        new ApiRouteError(405, 'method_not_allowed', 'Method Not Allowed'),
      );
    }

    checkRateLimit(req, res);

    const validatedBody = validateTransferRequestBody(req.body);
    logTransferBuildEvent('info', {
      event: 'build_started',
      requestId,
      sourceChannel: validatedBody.source_channel,
      hasWalletUtxos: Boolean(validatedBody.wallet_utxos?.length),
    });

    const response = await transferBuilderRuntime.buildUnsignedTransfer(
      validatedBody,
    );
    const durationMs = Date.now() - startedAt;
    res.setHeader('Server-Timing', `cardano_transfer_build;dur=${durationMs}`);
    logTransferBuildEvent('info', {
      event: 'build_succeeded',
      requestId,
      durationMs,
      feeLovelace: response.feeLovelace,
    });

    return res.status(200).json(response);
  } catch (error) {
    const routeError = classifyBuildError(error);
    const durationMs = Date.now() - startedAt;
    logTransferBuildEvent(routeError.statusCode >= 500 ? 'error' : 'warn', {
      event: 'build_failed',
      requestId,
      durationMs,
      code: routeError.code,
      statusCode: routeError.statusCode,
      message: routeError.message,
    });
    return writeError(res, requestId, routeError);
  }
}
