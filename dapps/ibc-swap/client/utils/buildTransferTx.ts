/* global BigInt */
import {
  requireCardanoAssetDenomTrace,
  transfer,
  type CardanoWalletUtxo,
} from '@/apis/restapi/cardano';
import { FORWARD_TIMEOUT } from '@/constants';
import { isCardanoChainRef } from '@/configs/runtime';
import { Coin } from 'cosmjs-types/cosmos/base/v1beta1/coin';
import { MsgTransfer } from 'cosmjs-types/ibc/applications/transfer/v1/tx';
import { requirePaymentKeyHashFromCardanoAddress } from './address';
import {
  logCardanoWalletDebug,
  logCardanoWalletError,
} from './cardanoWalletDebug';

const pfmReceiver = 'pfm';

interface Token {
  denom: string;
  amount: string;
}

type UnsignedTxMessage = {
  typeUrl: string;
  value: any;
  unsignedTxCborHex?: string;
  feeLovelace?: string;
};

function stringifyTransferResponse(data: unknown): string {
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function getTransferResponseErrorMessage(data: any): string | undefined {
  const candidates = [
    data?.message,
    data?.error,
    data?.reason,
    data?.details?.message,
    data?.details?.cause?.message,
  ];

  return candidates.find(
    (candidate) => typeof candidate === 'string' && candidate.trim(),
  );
}

export function requireUnsignedCardanoTxCborHex(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(
      'Cardano transfer builder returned an unsigned tx with an empty payload.',
    );
  }

  const unsignedTxCborHex = value.trim();
  if (
    unsignedTxCborHex.length % 2 !== 0 ||
    /[^0-9a-f]/i.test(unsignedTxCborHex)
  ) {
    throw new Error(
      'Cardano transfer builder returned an unsigned tx payload that is not hex-encoded transaction CBOR.',
    );
  }

  return unsignedTxCborHex;
}

function requireUnsignedTx(data: any): UnsignedTxMessage {
  const unsignedTx = data?.unsignedTx;
  if (!unsignedTx?.unsignedTxCborHex) {
    const responseError = getTransferResponseErrorMessage(data);
    const responseSummary =
      responseError ||
      (data?.result !== undefined
        ? `builder result code ${data.result}`
        : stringifyTransferResponse(data));
    throw new Error(
      `Cardano transfer builder did not return an unsigned tx: ${responseSummary}`,
    );
  }

  return {
    typeUrl: unsignedTx.type_url ?? '',
    value: undefined,
    unsignedTxCborHex: requireUnsignedCardanoTxCborHex(
      unsignedTx.unsignedTxCborHex,
    ),
    feeLovelace:
      typeof data?.feeLovelace === 'string' ? data.feeLovelace : undefined,
  };
}

function normalizeMeshWalletUtxo(utxo: any): CardanoWalletUtxo | null {
  const txHash = utxo?.input?.txHash;
  const outputIndex = utxo?.input?.outputIndex;
  const address = utxo?.output?.address;
  const amount = utxo?.output?.amount;

  if (
    typeof txHash !== 'string' ||
    typeof outputIndex !== 'number' ||
    typeof address !== 'string' ||
    !Array.isArray(amount)
  ) {
    return null;
  }

  const assets: Record<string, string> = {};
  amount.forEach((asset) => {
    if (typeof asset?.unit === 'string' && asset.quantity !== undefined) {
      assets[asset.unit] = String(asset.quantity);
    }
  });

  return {
    txHash,
    outputIndex,
    address,
    assets,
    datumHash: utxo.output.dataHash ?? null,
    datum: utxo.output.plutusData ?? null,
    scriptRef: utxo.output.scriptRef ?? null,
  };
}

function dedupeWalletUtxos(utxos: CardanoWalletUtxo[]): CardanoWalletUtxo[] {
  const seen = utxos.reduce((map, utxo) => {
    map.set(`${utxo.txHash}#${utxo.outputIndex}`, utxo);
    return map;
  }, new Map<string, CardanoWalletUtxo>());
  return Array.from(seen.values());
}

export async function getCardanoWalletUtxosForBuilder(
  wallet: any,
): Promise<CardanoWalletUtxo[]> {
  const startedAt = Date.now();
  logCardanoWalletDebug('walletUtxos:load:start', {
    hasWallet: Boolean(wallet),
    hasGetUtxos: typeof wallet?.getUtxos === 'function',
    hasGetCollateral: typeof wallet?.getCollateral === 'function',
  });
  const [walletUtxosResult, collateralUtxosResult] = await Promise.allSettled([
    wallet?.getUtxos?.(),
    wallet?.getCollateral?.(),
  ]);
  if (walletUtxosResult.status === 'rejected') {
    logCardanoWalletError(
      'walletUtxos:getUtxos:error',
      walletUtxosResult.reason,
    );
  }
  if (collateralUtxosResult.status === 'rejected') {
    logCardanoWalletError(
      'walletUtxos:getCollateral:error',
      collateralUtxosResult.reason,
    );
  }

  const rawUtxos = [
    ...(walletUtxosResult.status === 'fulfilled' &&
    Array.isArray(walletUtxosResult.value)
      ? walletUtxosResult.value
      : []),
    ...(collateralUtxosResult.status === 'fulfilled' &&
    Array.isArray(collateralUtxosResult.value)
      ? collateralUtxosResult.value
      : []),
  ];

  const normalizedUtxos = dedupeWalletUtxos(
    rawUtxos
      .map(normalizeMeshWalletUtxo)
      .filter((utxo): utxo is CardanoWalletUtxo => Boolean(utxo)),
  );
  logCardanoWalletDebug('walletUtxos:load:success', {
    elapsedMs: Date.now() - startedAt,
    rawUtxoCount: rawUtxos.length,
    normalizedUtxoCount: normalizedUtxos.length,
    walletUtxosStatus: walletUtxosResult.status,
    collateralUtxosStatus: collateralUtxosResult.status,
  });
  return normalizedUtxos;
}

function buildForwardMemo(routes: string[], receiver: string): string {
  let result = {};
  routes.reverse().forEach((route, index) => {
    const [srcPort, srcChannel] = route.split('/');
    if (index === 0) {
      result = {
        forward: {
          receiver,
          port: srcPort,
          channel: srcChannel,
          timeout: FORWARD_TIMEOUT,
        },
      };
    } else {
      result = {
        forward: {
          receiver: pfmReceiver,
          port: srcPort,
          channel: srcChannel,
          timeout: FORWARD_TIMEOUT,
          next: JSON.stringify(result),
        },
      };
    }
  });
  return JSON.stringify(result);
}

export function unsignedTxTransferFromCosmos(
  chains: string[], // [A, B, C]
  routes: string[], // ["transfer/srcChannelA", "transfer/srcChannelB"]
  sender: string,
  receiver: string,
  timeoutTimeOffset: bigint, // nanosec
  coin: Coin,
): UnsignedTxMessage[] {
  const currentTimeStamp = BigInt(Date.now()) * BigInt(1000000);
  let msg: MsgTransfer;

  let tmpReceiver = receiver;
  if (isCardanoChainRef(chains[chains.length - 1])) {
    tmpReceiver = requirePaymentKeyHashFromCardanoAddress(receiver);
  }

  if (routes.length === 1) {
    // normal transfer
    const [route] = routes;
    const [srcPort, srcChannel] = route.split('/');
    msg = MsgTransfer.fromJSON({
      sender,
      receiver: tmpReceiver,
      token: coin,
      sourcePort: srcPort,
      sourceChannel: srcChannel,
      timeoutHeight: {
        revisionNumber: BigInt(0),
        revisionHeight: BigInt(0),
      },
      timeoutTimestamp: (
        currentTimeStamp + BigInt(timeoutTimeOffset)
      ).toString(),
      memo: '',
    });
    return [{ typeUrl: MsgTransfer.typeUrl, value: msg }];
  }
  // pfm
  const [route, ...restRoutes] = routes;
  const [srcPort, srcChannel] = route.split('/');
  msg = MsgTransfer.fromJSON({
    sender,
    receiver: pfmReceiver,
    token: coin,
    sourcePort: srcPort,
    sourceChannel: srcChannel,
    timeoutHeight: {
      revisionNumber: BigInt(0),
      revisionHeight: BigInt(0),
    },
    timeoutTimestamp: (currentTimeStamp + BigInt(timeoutTimeOffset)).toString(),
    memo: buildForwardMemo(restRoutes, tmpReceiver),
  });
  return [{ typeUrl: MsgTransfer.typeUrl, value: msg }];
}

export async function unsignedTxTransferFromCardano(
  chains: string[], // [A, B, C]
  routes: string[], // ["transfer/srcChannelA", "transfer/srcChannelB"]
  sender: string,
  receiver: string,
  timeoutTimeOffset: bigint, // nanosec
  token: Token,
  walletUtxos?: CardanoWalletUtxo[],
): Promise<UnsignedTxMessage[]> {
  const currentTimeStamp = BigInt(Date.now()) * BigInt(1000000);
  const cardanoTokenTrace = await requireCardanoAssetDenomTrace(token.denom);
  const sendTokenDenom = cardanoTokenTrace.fullDenom;
  let data: any;
  if (routes.length === 1) {
    // normal transfer
    const [route] = routes;
    const [srcPort, srcChannel] = route.split('/');

    data = await transfer({
      sourcePort: srcPort,
      sourceChannel: srcChannel,
      token: {
        denom: sendTokenDenom,
        amount: token.amount,
      },
      sender: requirePaymentKeyHashFromCardanoAddress(sender),
      receiver,
      timeoutHeight: {
        revisionNumber: BigInt(0).toString(),
        revisionHeight: BigInt(0).toString(),
      },
      timeoutTimestamp: (
        currentTimeStamp + BigInt(timeoutTimeOffset)
      ).toString(),
      signer: sender,
      walletUtxos,
      memo: '',
    });
    return [requireUnsignedTx(data)];
  }
  // pfm
  const [route, ...restRoutes] = routes;
  const [srcPort, srcChannel] = route.split('/');
  data = await transfer({
    sourcePort: srcPort,
    sourceChannel: srcChannel,
    token: {
      denom: sendTokenDenom,
      amount: token.amount,
    },
    sender: requirePaymentKeyHashFromCardanoAddress(sender),
    receiver: pfmReceiver,
    timeoutHeight: {
      revisionNumber: BigInt(0).toString(),
      revisionHeight: BigInt(0).toString(),
    },
    timeoutTimestamp: (currentTimeStamp + BigInt(timeoutTimeOffset)).toString(),
    signer: sender,
    walletUtxos,
    memo: buildForwardMemo(restRoutes, receiver),
  });
  return [requireUnsignedTx(data)];
}
