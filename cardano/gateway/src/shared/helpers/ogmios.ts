import WebSocket from 'ws';

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

const openOgmiosConnection = async (ogmiosUrl: string): Promise<WebSocket> => {
  const client = new WebSocket(ogmiosUrl);

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

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
};

const lcm = (a: bigint, b: bigint): bigint => {
  if (a === 0n || b === 0n) {
    return 0n;
  }
  return (a / gcd(a, b)) * b;
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

  const commonDenominator = rows.reduce((acc, row) => lcm(acc, row.denominator), 1n);

  return rows
    .map((row) => ({
      poolId: row.poolId,
      stake: row.numerator * (commonDenominator / row.denominator),
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
  const { client, session } = await createOgmiosSession(ogmiosUrl);
  try {
    return await session.request<T>(methodname, args);
  } finally {
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      client.close();
    }
  }
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
