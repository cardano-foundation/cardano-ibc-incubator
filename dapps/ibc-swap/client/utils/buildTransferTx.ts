/* global BigInt */
import { transfer } from '@/apis/restapi/cardano';
import { lookupCardanoAssetDenomTrace } from '@/apis/restapi/cardano';
import { CARDANO_IBC_CHAIN_ID } from '@/configs/runtime';
import { Coin } from 'cosmjs-types/cosmos/base/v1beta1/coin';
import { MsgTransfer } from 'cosmjs-types/ibc/applications/transfer/v1/tx';
import { getPublicKeyHashFromAddress } from './address';
import { FORWARD_TIMEOUT } from '@/constants';

const pfmReceiver = 'pfm';

interface Token {
  denom: string;
  amount: string;
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
): { typeUrl: string; value: any }[] {
  const currentTimeStamp = BigInt(Date.now()) * BigInt(1000000);
  let msg: MsgTransfer;

  let tmpReceiver = receiver;
  if (chains[chains.length - 1] === CARDANO_IBC_CHAIN_ID) {
    tmpReceiver = getPublicKeyHashFromAddress(receiver)!;
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
): Promise<{ typeUrl: string; value: any }[]> {
  const currentTimeStamp = BigInt(Date.now()) * BigInt(1000000);
  const cardanoTokenTrace = await lookupCardanoAssetDenomTrace(token.denom);
  const sendTokenDenom = cardanoTokenTrace?.fullDenom
    ? cardanoTokenTrace.fullDenom
    : token.denom;
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
      sender: getPublicKeyHashFromAddress(sender),
      receiver,
      timeoutHeight: {
        revisionNumber: BigInt(0).toString(),
        revisionHeight: BigInt(0).toString(),
      },
      timeoutTimestamp: (
        currentTimeStamp + BigInt(timeoutTimeOffset)
      ).toString(),
      signer: sender,
      memo: '',
    });
    return [
      { typeUrl: data?.unsignedTx?.type_url, value: data?.unsignedTx?.value },
    ];
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
    sender: getPublicKeyHashFromAddress(sender),
    receiver: pfmReceiver,
    timeoutHeight: {
      revisionNumber: BigInt(0).toString(),
      revisionHeight: BigInt(0).toString(),
    },
    timeoutTimestamp: (currentTimeStamp + BigInt(timeoutTimeOffset)).toString(),
    signer: sender,
    memo: buildForwardMemo(restRoutes, receiver),
  });
  return [
    { typeUrl: data?.unsignedTx?.type_url, value: data?.unsignedTx?.value },
  ];
}
