/* global BigInt */
import { Coin } from 'cosmjs-types/cosmos/base/v1beta1/coin';
import { MsgTransfer } from 'cosmjs-types/ibc/applications/transfer/v1/tx';

const pfmReceiver = 'pfm';

function buildForwardMemo(routes: string[], receiver: string): string {
  let result = {};
  routes.reverse().forEach((route, index) => {
    const [srcPort, srcChannel] = route.split('/');
    if (index === 0) {
      result = {
        forward: {
          receiver: receiver,
          port: srcPort,
          channel: srcChannel,
        },
      };
    } else {
      result = {
        forward: {
          receiver: pfmReceiver,
          port: srcPort,
          channel: srcChannel,
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
): MsgTransfer[] {
  const currentTimeStamp = BigInt(Date.now()) * BigInt(1000000);

  let msg: MsgTransfer;
  if (routes.length === 1) {
    // normal transfer
    const [route] = routes;
    const [srcPort, srcChannel] = route.split('/');
    msg = MsgTransfer.fromJSON({
      sender,
      receiver,
      token: coin,
      sourcePort: srcPort,
      sourceChannel: srcChannel,
      timeoutTimestamp: (
        currentTimeStamp + BigInt(timeoutTimeOffset)
      ).toString(),
      memo: '',
    });
    return [msg];
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
    timeoutTimestamp: (currentTimeStamp + BigInt(timeoutTimeOffset)).toString(),
    memo: buildForwardMemo(restRoutes, receiver),
  });
  return [msg];
}

export function unsignedTxTransferFromCardano() {}
