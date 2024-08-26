import { transfer } from '@/apis/restapi/cardano';
import { getPublicKeyHashFromAddress } from './address';

const pfmReceiver = 'pfm';
const CROSSCHAIN_SWAPS_ADDRESS =
  process.env.NEXT_PUBLIC_CROSSCHAIN_SWAP_ADDRESS!;

const buildNextMemo = (
  transferBackRoutes: string[],
  receiver: string,
): string => {
  let result = {};
  const transBackRoutes = transferBackRoutes.reverse().slice(1);
  transBackRoutes.forEach((route, index) => {
    const [srcPort, srcChannel] = route.split('/');
    if (index === 0) {
      result = {
        forward: {
          receiver,
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
};

const buildOsmosisSwapMemo = ({
  tokenOutDenom,
  slippagePercentage,
  nextMemo,
}: {
  tokenOutDenom: string;
  slippagePercentage: string;
  nextMemo: string;
}): string => {
  const result = {
    wasm: {
      contract: CROSSCHAIN_SWAPS_ADDRESS,
      msg: {
        osmosis_swap: {
          output_denom: tokenOutDenom,
          slippage: {
            twap: {
              slippage_percentage: slippagePercentage,
              window_seconds: 10,
            },
          },
          receiver: pfmReceiver,
          on_failed_delivery: 'do_nothing',
          next_memo: nextMemo,
        },
      },
    },
  };
  return JSON.stringify(result);
};

const buildForwardMemo = ({
  transferRoutes,
  osmosisSwapMemo,
}: {
  transferRoutes: string[];
  osmosisSwapMemo: string;
}) => {
  let result = {};
  transferRoutes.reverse().forEach((route, index) => {
    const [srcPort, srcChannel] = route.split('/');
    if (index === 0) {
      result = {
        forward: {
          receiver: CROSSCHAIN_SWAPS_ADDRESS,
          port: srcPort,
          channel: srcChannel,
          next: osmosisSwapMemo,
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
};

interface Token {
  denom: string;
  amount: string;
}

export async function unsignedTxSwapFromCardano({
  sender,
  tokenIn,
  tokenOutDenom,
  receiver,
  transferRoutes,
  transferBackRoutes,
  slippagePercentage,
  timeoutTimeOffset,
}: {
  sender: string;
  tokenIn: Token;
  tokenOutDenom: string;
  receiver: string;
  transferRoutes: string[];
  transferBackRoutes: string[];
  slippagePercentage: string;
  timeoutTimeOffset: bigint; // nanosec
}): Promise<{ typeUrl: string; value: any }[]> {
  const currentTimeStamp = BigInt(Date.now()) * BigInt(1000000);
  // pfm
  const [route, ...restRoutes] = transferRoutes;
  const [srcPort, srcChannel] = route.split('/');
  const nextMemo = buildNextMemo(transferBackRoutes, receiver);
  const osmosisSwapMemo = buildOsmosisSwapMemo({
    nextMemo,
    tokenOutDenom,
    slippagePercentage,
  });
  const forwardMemo = buildForwardMemo({
    transferRoutes: restRoutes,
    osmosisSwapMemo,
  });
  const data = await transfer({
    sourcePort: srcPort,
    sourceChannel: srcChannel,
    token: {
      denom: tokenIn.denom,
      amount: tokenIn.amount,
    },
    sender: getPublicKeyHashFromAddress(sender),
    receiver: pfmReceiver,
    timeoutHeight: {
      revisionNumber: BigInt(0).toString(),
      revisionHeight: BigInt(0).toString(),
    },
    timeoutTimestamp: (currentTimeStamp + BigInt(timeoutTimeOffset)).toString(),
    signer: sender,
    memo: forwardMemo,
  });
  return [
    { typeUrl: data?.unsignedTx?.type_url!, value: data?.unsignedTx?.value },
  ];
}
