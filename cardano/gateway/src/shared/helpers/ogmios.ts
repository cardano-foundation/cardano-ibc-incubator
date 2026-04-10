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

const parseShelleyGenesisConfig = (config: OgmiosShelleyGenesisConfig): number => {
  if (config.era !== 'shelley') {
    throw new Error('Ogmios returned a non-Shelley genesis configuration');
  }

  return parseInteger(config.slotsPerKesPeriod, 'slotsPerKesPeriod');
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
): Promise<OgmiosCurrentEpochVerificationData> => {
  const [currentEpoch, currentNonces, shelleyGenesisConfig] = await Promise.all([
    ogmiosRequest<unknown>(ogmiosUrl, 'queryLedgerState/epoch', {}),
    ogmiosRequest<OgmiosCurrentEpochNonces>(ogmiosUrl, 'queryLedgerState/nonces', {}),
    ogmiosRequest<OgmiosShelleyGenesisConfig>(ogmiosUrl, 'queryNetwork/genesisConfiguration', { era: 'shelley' }),
  ]);

  return {
    currentEpoch: parseInteger(currentEpoch, 'epoch'),
    epochNonce: parseEpochNonce(currentNonces),
    slotsPerKesPeriod: parseShelleyGenesisConfig(shelleyGenesisConfig),
  };
};

export { ogmiosRequest, queryCurrentEpochVerificationData };
