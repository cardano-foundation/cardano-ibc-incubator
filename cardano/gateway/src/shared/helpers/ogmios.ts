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

const openOgmiosConnection = async (ogmiosUrl: string): Promise<WebSocket> => {
  const client = new WebSocket(ogmiosUrl);
  await new Promise((resolve) => {
    client.addEventListener(
      'open',
      () => {
        resolve(undefined);
      },
      { once: true },
    );
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

const ogmiosRequest = async <T>(ogmiosUrl: string, methodname: string, args: unknown): Promise<T> => {
  const client = await openOgmiosConnection(ogmiosUrl);
  try {
    return await new Promise<T>((resolve, reject) => {
      client.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method: methodname,
          params: args,
        }),
      );

      client.addEventListener(
        'message',
        (msg: MessageEvent<string>) => {
          try {
            const payload = JSON.parse(msg.data);
            if (payload?.error) {
              reject(new Error(payload.error.message ?? JSON.stringify(payload.error)));
              return;
            }
            resolve(payload.result as T);
          } catch (error) {
            reject(error);
          } finally {
            client.close();
          }
        },
        { once: true },
      );

      client.addEventListener(
        'error',
        (event: ErrorEvent) => {
          client.close();
          reject(event.error ?? new Error(`Ogmios request ${methodname} failed`));
        },
        { once: true },
      );
    });
  } finally {
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      client.close();
    }
  }
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
    const currentNonces = await ogmiosRequest<OgmiosCurrentEpochNonces>(
      ogmiosUrl,
      'queryLedgerState/nonces',
      {},
    );
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

  const commonDenominator = rows.reduce(
    (acc, row) => lcm(acc, row.denominator),
    1n,
  );

  return rows
    .map((row) => ({
      poolId: row.poolId,
      stake: row.numerator * (commonDenominator / row.denominator),
      vrfKeyHash: row.vrfKeyHash,
    }))
    .filter((row) => row.stake > 0n);
};

export { ogmiosRequest, queryCurrentEpochStakeDistribution, queryCurrentEpochVerificationData };
