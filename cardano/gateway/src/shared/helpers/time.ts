import WebSocket from 'ws';
import { ogmiosRequest } from './ogmios';

type OgmiosPoint = { slot: number; id: string };
type SlotConfig = { zeroTime: number; zeroSlot: number; slotLength: number };

const querySystemStart = async (ogmiosUrl: string) => {
  const systemStart = await ogmiosRequest<string>(ogmiosUrl, 'queryNetwork/startTime', {});
  const parsedSystemTime = Date.parse(systemStart);

  return parsedSystemTime;
};

const queryNetworkTipPoint = async (ogmiosUrl: string): Promise<OgmiosPoint | 'origin'> => {
  const result = await ogmiosRequest<OgmiosPoint | 'origin'>(ogmiosUrl, 'queryNetwork/tip', {});
  if (result === 'origin') {
    return 'origin';
  }

  if (typeof result?.slot !== 'number' || typeof result?.id !== 'string') {
    throw new Error('Ogmios queryNetwork/tip returned an invalid point');
  }

  return {
    slot: result.slot,
    id: result.id,
  };
};

const computeLedgerAnchoredValidityWindow = async (
  ogmiosUrl: string,
  slotConfig: SlotConfig,
  ttlMs: number,
  options?: { backdateMs?: number },
): Promise<{
  currentSlot: number;
  currentLedgerTime: number;
  validFromTime: number;
  validToSlot: number;
  validToTime: number;
}> => {
  if (!Number.isFinite(slotConfig.zeroTime) || !Number.isFinite(slotConfig.slotLength) || slotConfig.slotLength <= 0) {
    throw new Error('Invalid Cardano slot configuration');
  }

  const tip = await queryNetworkTipPoint(ogmiosUrl);
  const currentSlot = tip === 'origin' ? 0 : tip.slot;

  // Anchor the validity window to the live chain tip rather than host wallclock time. Local
  // devnet regularly lags the host clock, and wallclock-derived validity can push tx bounds
  // beyond Ogmios' era forecast horizon (`PastHorizon`).
  const currentLedgerTime =
    slotConfig.zeroTime + (currentSlot - slotConfig.zeroSlot) * slotConfig.slotLength;
  const ttlSlots = Math.max(1, Math.ceil(ttlMs / slotConfig.slotLength));
  const validToSlot = currentSlot + ttlSlots;
  const validToTime =
    slotConfig.zeroTime + (validToSlot + 1 - slotConfig.zeroSlot) * slotConfig.slotLength - 1;
  const backdateMs = Math.max(0, options?.backdateMs ?? 0);
  const validFromTime = Math.max(slotConfig.zeroTime, currentLedgerTime - backdateMs);

  return {
    currentSlot,
    currentLedgerTime,
    validFromTime,
    validToSlot,
    validToTime,
  };
};

const queryTransactionInclusionBlockHeight = async (
  ogmiosUrl: string,
  txHash: string,
  fromPoint: OgmiosPoint | 'origin',
  timeoutMs: number = 60000,
): Promise<number> => {
  const client = new WebSocket(ogmiosUrl);
  const txHashLower = txHash.toLowerCase();
  // Start from the pre-submit point when available so the inclusion scan only watches
  // the block window that could actually contain the submitted transaction.
  const points = fromPoint === 'origin' ? ['origin'] : [fromPoint, 'origin'];

  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish(new Error(`Timed out waiting for tx ${txHash} to appear in Ogmios chain sync`));
    }, timeoutMs);

    const finish = (error?: Error, height?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close();
      }

      if (error) {
        reject(error);
        return;
      }

      resolve(height!);
    };

    const sendRequest = (method: string, params?: unknown) => {
      client.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method,
          params,
        }),
      );
    };

    client.once('open', () => {
      sendRequest('findIntersection', { points });
    });

    client.on('message', (rawMessage) => {
      if (settled) return;

      try {
        const payload = JSON.parse(rawMessage.toString());

        if (payload?.error) {
          finish(new Error(payload.error.message ?? JSON.stringify(payload.error)));
          return;
        }

        if (payload?.method === 'findIntersection') {
          sendRequest('nextBlock');
          return;
        }

        if (payload?.method !== 'nextBlock') {
          return;
        }

        const result = payload.result;
        if (result?.direction === 'forward') {
          const blockHeight = result?.block?.height;
          const transactions = Array.isArray(result?.block?.transactions) ? result.block.transactions : [];
          const foundTx = transactions.some(
            (transaction: { id?: string }) =>
              typeof transaction?.id === 'string' && transaction.id.toLowerCase() === txHashLower,
          );

          if (foundTx) {
            if (typeof blockHeight !== 'number') {
              finish(new Error(`Ogmios returned a tx match for ${txHash} without a block height`));
              return;
            }

            finish(undefined, blockHeight);
            return;
          }
        }

        sendRequest('nextBlock');
      } catch (error) {
        finish(error as Error);
      }
    });

    client.once('error', (event: ErrorEvent) => {
      finish(event.error ?? new Error('Ogmios chain sync websocket request failed'));
    });

    client.once('close', () => {
      if (!settled) {
        finish(new Error('Ogmios chain sync websocket closed before tx inclusion was observed'));
      }
    });
  });
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const getNanoseconds = (d) => {
  let nanoSeconds = d.split('.')[1].split('Z')[0];
  nanoSeconds = Number(nanoSeconds).toString();
  return parseInt(nanoSeconds);
};

export {
  querySystemStart,
  queryNetworkTipPoint,
  queryTransactionInclusionBlockHeight,
  computeLedgerAnchoredValidityWindow,
  sleep,
  getNanoseconds,
};
