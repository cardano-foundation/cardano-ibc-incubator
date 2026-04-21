import WebSocket from 'ws';
import { resolveManagedOgmiosWsEndpoint, resolveManagedOgmiosWsOptions } from './managed-cardano-endpoints';

type OgmiosCurrentEpochNonces = {
  epochNonce?: unknown;
};

type OgmiosShelleyGenesisConfig = {
  era?: unknown;
  slotsPerKesPeriod?: unknown;
};

type OgmiosCurrentEpochVerificationData = {
  currentEpoch: number;
  epochNonce: string;
  slotsPerKesPeriod: number;
};

type OgmiosStakePool = {
  id?: unknown;
  vrfVerificationKeyHash?: unknown;
};

type OgmiosStakePools = Record<string, OgmiosStakePool>;

type OgmiosLiveStakeDistributionEntry = {
  stake?: unknown;
  vrf?: unknown;
};

type OgmiosLiveStakeDistribution = Record<string, OgmiosLiveStakeDistributionEntry>;

type OgmiosCurrentEpochStakeDistributionEntry = {
  poolId: string;
  stake: bigint;
  vrfKeyHash: string;
};

type OgmiosLedgerPoint = {
  slot: bigint | number | string;
  hash: string;
};

type OgmiosEpochContextAtPoint = OgmiosCurrentEpochVerificationData & {
  stakeDistribution: OgmiosCurrentEpochStakeDistributionEntry[];
};

type OgmiosSession = {
  request<T>(methodname: string, args?: unknown): Promise<T>;
};

const STAKE_DISTRIBUTION_WEIGHT_SCALE = 1_000_000_000_000n;
const OGMIOS_TRANSIENT_MAX_ATTEMPTS = 10;
const OGMIOS_TRANSIENT_BASE_DELAY_MS = 500;
const OGMIOS_TRANSIENT_MAX_DELAY_MS = 5_000;
const TRANSIENT_OGMIOS_ERROR_MARKERS = [
  'unexpected server response: 401',
  'unauthorized',
  'http 401',
  'econnreset',
  'econnrefused',
  'etimedout',
  'socket hang up',
  'network timeout',
  'failed to fetch',
  'temporarily unavailable',
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientOgmiosError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return TRANSIENT_OGMIOS_ERROR_MARKERS.some((marker) => normalized.includes(marker));
};

const retryOgmiosOperation = async <T>(operationName: string, operation: () => Promise<T>): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= OGMIOS_TRANSIENT_MAX_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientOgmiosError(error) || attempt === OGMIOS_TRANSIENT_MAX_ATTEMPTS) {
        throw error;
      }

      const delayMs = Math.min(
        OGMIOS_TRANSIENT_MAX_DELAY_MS,
        OGMIOS_TRANSIENT_BASE_DELAY_MS * 2 ** (attempt - 1),
      );
      // Bounded retry for managed-endpoint transport/auth races; deterministic failure after the budget.
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Ogmios operation ${operationName} failed`);
};

const openOgmiosConnection = async (ogmiosUrl: string): Promise<WebSocket> => {
  const resolvedUrl =
    resolveManagedOgmiosWsEndpoint(ogmiosUrl, process.env.OGMIOS_API_KEY) ?? ogmiosUrl;
  const client = new WebSocket(
    resolvedUrl,
    resolveManagedOgmiosWsOptions(ogmiosUrl, process.env.OGMIOS_API_KEY),
  );

  await new Promise<void>((resolve, reject) => {
    const handleOpen = () => {
      client.off('error', handleError);
      resolve();
    };
    const handleError = (error: Error) => {
      client.off('open', handleOpen);
      reject(error);
    };

    client.once('open', handleOpen);
    client.once('error', handleError);
  });

  return client;
};

const normalizeHex = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
};

const parseInteger = (value: unknown, field: string): number => {
  let parsed: number;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'bigint') {
    parsed = Number(value);
  } else if (typeof value === 'string') {
    parsed = Number(value);
  } else {
    throw new Error(`Ogmios returned invalid ${field}`);
  }

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Ogmios returned invalid ${field}`);
  }

  return parsed;
};

const parseEpochNonce = (nonces: OgmiosCurrentEpochNonces): string => {
  if (typeof nonces.epochNonce !== 'string') {
    throw new Error('Ogmios returned an invalid epoch nonce');
  }

  const normalized = normalizeHex(nonces.epochNonce);
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('Ogmios returned an invalid epoch nonce');
  }

  return normalized;
};

const parseFallbackEpochNonce = (fallback?: string): string | null => {
  if (typeof fallback !== 'string') {
    return null;
  }

  const normalized = normalizeHex(fallback);
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    return null;
  }

  return normalized;
};

const parseShelleyGenesisConfig = (config: OgmiosShelleyGenesisConfig): number => {
  if (config.era !== 'shelley') {
    throw new Error('Ogmios returned a non-Shelley genesis configuration');
  }

  return parseInteger(config.slotsPerKesPeriod, 'slotsPerKesPeriod');
};

const parseStakeFraction = (value: unknown): { numerator: bigint; denominator: bigint } => {
  if (typeof value !== 'string') {
    throw new Error('Ogmios returned an invalid live stake fraction');
  }

  const parts = value.split('/');
  if (parts.length !== 2) {
    throw new Error('Ogmios returned an invalid live stake fraction');
  }

  const numerator = BigInt(parts[0]);
  const denominator = BigInt(parts[1]);
  if (numerator < 0n || denominator <= 0n) {
    throw new Error('Ogmios returned an invalid live stake fraction');
  }

  return { numerator, denominator };
};

const stakeFractionToWeight = (numerator: bigint, denominator: bigint): bigint => {
  if (numerator === 0n) {
    return 0n;
  }
  if (numerator > denominator) {
    throw new Error('Ogmios returned an invalid live stake fraction');
  }

  const rounded = (numerator * STAKE_DISTRIBUTION_WEIGHT_SCALE + denominator / 2n) / denominator;
  return rounded > 0n ? rounded : 1n;
};

const parseStakePoolId = (poolId: string): string => {
  if (!poolId.startsWith('pool1')) {
    throw new Error(`Ogmios returned an invalid stake pool id: ${poolId}`);
  }
  return poolId;
};

const parseStakeDistributionRows = (
  stakePools: OgmiosStakePools,
  liveStakeDistribution: OgmiosLiveStakeDistribution,
): OgmiosCurrentEpochStakeDistributionEntry[] => {
  const rows = Object.entries(liveStakeDistribution).map(([poolId, entry]) => {
    const normalizedPoolId = parseStakePoolId(poolId);
    const { numerator, denominator } = parseStakeFraction(entry?.stake);
    const vrfKeyHash = normalizeHex(
      typeof entry?.vrf === 'string'
        ? entry.vrf
        : typeof stakePools[poolId]?.vrfVerificationKeyHash === 'string'
          ? stakePools[poolId].vrfVerificationKeyHash
          : '',
    );
    if (!/^[0-9a-f]{64}$/.test(vrfKeyHash)) {
      throw new Error(`Ogmios returned an invalid VRF key hash for pool ${normalizedPoolId}`);
    }
    return {
      poolId: normalizedPoolId,
      numerator,
      denominator,
      vrfKeyHash,
    };
  });

  if (rows.length === 0) {
    return [];
  }

  return rows
    .map((row) => ({
      poolId: row.poolId,
      stake: stakeFractionToWeight(row.numerator, row.denominator),
      vrfKeyHash: row.vrfKeyHash,
    }))
    .filter((row) => row.stake > 0n);
};

const createOgmiosSession = async (ogmiosUrl: string): Promise<{ client: WebSocket; session: OgmiosSession }> => {
  const client = await openOgmiosConnection(ogmiosUrl);
  let nextId = 0;

  const session: OgmiosSession = {
    request<T>(methodname: string, args: unknown = {}): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const requestId = `${methodname}-${++nextId}`;

        const cleanup = () => {
          client.off('message', handleMessage);
          client.off('error', handleError);
        };

        const handleError = (error: Error) => {
          cleanup();
          reject(error ?? new Error(`Ogmios request ${methodname} failed`));
        };

        const handleMessage = (raw: WebSocket.RawData) => {
          try {
            const payload = JSON.parse(raw.toString());
            if (payload?.id !== requestId) {
              return;
            }

            cleanup();
            if (payload?.error) {
              const errorMessage = [payload.error.message, payload.error.data]
                .filter((part) => typeof part === 'string' && part.trim().length > 0)
                .join(' ');
              reject(new Error(errorMessage || JSON.stringify(payload.error)));
              return;
            }
            resolve(payload.result as T);
          } catch (error) {
            cleanup();
            reject(error);
          }
        };

        client.on('message', handleMessage);
        client.on('error', handleError);
        client.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: requestId,
            method: methodname,
            params: args,
          }),
        );
      });
    },
  };

  return { client, session };
};

const ogmiosRequest = async <T>(ogmiosUrl: string, methodname: string, args: unknown): Promise<T> => {
  return retryOgmiosOperation(methodname, async () => {
    const { client, session } = await createOgmiosSession(ogmiosUrl);
    try {
      return await session.request<T>(methodname, args);
    } finally {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close();
      }
    }
  });
};

const normalizeLedgerPoint = (point: OgmiosLedgerPoint): { slot: number; id: string } => {
  const slot = parseInteger(point.slot, 'point.slot');
  if (!Number.isSafeInteger(slot)) {
    throw new Error(`Ogmios point slot ${slot} exceeds JavaScript safe integer range`);
  }

  const id = normalizeHex(point.hash);
  if (!/^[0-9a-f]{64}$/.test(id)) {
    throw new Error('Ogmios point hash must be a 32-byte block hash');
  }

  return { slot, id };
};

const withAcquiredLedgerState = async <T>(
  ogmiosUrl: string,
  point: OgmiosLedgerPoint,
  callback: (session: OgmiosSession) => Promise<T>,
): Promise<T> => {
  return retryOgmiosOperation('acquireLedgerState', async () => {
    const { client, session } = await createOgmiosSession(ogmiosUrl);

    try {
      await session.request('acquireLedgerState', { point: normalizeLedgerPoint(point) });
      return await callback(session);
    } finally {
      try {
        if (client.readyState === WebSocket.OPEN) {
          await session.request('releaseLedgerState', {});
        }
      } catch {
        // Best-effort cleanup only.
      }

      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close();
      }
    }
  });
};

const queryEpochContextAtPoint = async (
  ogmiosUrl: string,
  point: OgmiosLedgerPoint,
  epochNonceFallback?: string,
): Promise<OgmiosEpochContextAtPoint> => {
  return withAcquiredLedgerState(ogmiosUrl, point, async (session) => {
    const currentEpoch = await session.request<unknown>('queryLedgerState/epoch', {});
    const shelleyGenesisConfig = await session.request<OgmiosShelleyGenesisConfig>(
      'queryNetwork/genesisConfiguration',
      { era: 'shelley' },
    );

    let epochNonce: string;
    try {
      const currentNonces = await session.request<OgmiosCurrentEpochNonces>('queryLedgerState/nonces', {});
      epochNonce = parseEpochNonce(currentNonces);
    } catch (error) {
      const fallback = parseFallbackEpochNonce(epochNonceFallback);
      const message = error instanceof Error ? error.message : String(error);
      if (!fallback || !message.includes('unknown query name')) {
        throw error;
      }
      epochNonce = fallback;
    }

    const stakePools = await session.request<OgmiosStakePools>('queryLedgerState/stakePools', {});
    const liveStakeDistribution = await session.request<OgmiosLiveStakeDistribution>(
      'queryLedgerState/liveStakeDistribution',
      {},
    );

    return {
      currentEpoch: parseInteger(currentEpoch, 'epoch'),
      epochNonce,
      slotsPerKesPeriod: parseShelleyGenesisConfig(shelleyGenesisConfig),
      stakeDistribution: parseStakeDistributionRows(stakePools, liveStakeDistribution),
    };
  });
};

const queryCurrentEpochVerificationData = async (
  ogmiosUrl: string,
  epochNonceFallback?: string,
): Promise<OgmiosCurrentEpochVerificationData> => {
  const [currentEpoch, shelleyGenesisConfig] = await Promise.all([
    ogmiosRequest<unknown>(ogmiosUrl, 'queryLedgerState/epoch', {}),
    ogmiosRequest<OgmiosShelleyGenesisConfig>(ogmiosUrl, 'queryNetwork/genesisConfiguration', { era: 'shelley' }),
  ]);

  let epochNonce: string;
  try {
    const currentNonces = await ogmiosRequest<OgmiosCurrentEpochNonces>(ogmiosUrl, 'queryLedgerState/nonces', {});
    epochNonce = parseEpochNonce(currentNonces);
  } catch (error) {
    const fallback = parseFallbackEpochNonce(epochNonceFallback);
    const message = error instanceof Error ? error.message : String(error);
    if (!fallback || !message.includes('unknown query name')) {
      throw error;
    }
    epochNonce = fallback;
  }

  return {
    currentEpoch: parseInteger(currentEpoch, 'epoch'),
    epochNonce,
    slotsPerKesPeriod: parseShelleyGenesisConfig(shelleyGenesisConfig),
  };
};

const queryCurrentEpochStakeDistribution = async (
  ogmiosUrl: string,
): Promise<OgmiosCurrentEpochStakeDistributionEntry[]> => {
  const [stakePools, liveStakeDistribution] = await Promise.all([
    ogmiosRequest<OgmiosStakePools>(ogmiosUrl, 'queryLedgerState/stakePools', {}),
    ogmiosRequest<OgmiosLiveStakeDistribution>(ogmiosUrl, 'queryLedgerState/liveStakeDistribution', {}),
  ]);

  return parseStakeDistributionRows(stakePools, liveStakeDistribution);
};

export {
  ogmiosRequest,
  queryCurrentEpochStakeDistribution,
  queryCurrentEpochVerificationData,
  queryEpochContextAtPoint,
  type OgmiosCurrentEpochStakeDistributionEntry,
  type OgmiosCurrentEpochVerificationData,
  type OgmiosEpochContextAtPoint,
  type OgmiosLedgerPoint,
};
