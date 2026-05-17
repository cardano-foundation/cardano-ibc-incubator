/* global BigInt */
import {
  requireCardanoAssetDenomTrace,
  transfer,
} from '@/apis/restapi/cardano';
import { CROSSCHAIN_SWAP_ADDRESS } from '@/configs/runtime';
import { FORWARD_TIMEOUT } from '@/constants';
import { requirePaymentKeyHashFromCardanoAddress } from './address';
import { requireUnsignedCardanoTxCborHex } from './buildTransferTx';

const pfmReceiver = 'pfm';

const buildDirectIbcReceiver = (route: string, receiver: string): string => {
  const [, srcChannel] = route.split('/');
  return `ibc:${srcChannel}/${requirePaymentKeyHashFromCardanoAddress(receiver)}`;
};

const buildNextMemo = (transferBackRoutes: string[], receiver: string): any => {
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
          timeout: FORWARD_TIMEOUT,
        },
      };
    } else {
      result = {
        forward: {
          receiver: pfmReceiver,
          port: srcPort,
          channel: srcChannel,
          next: result,
          timeout: FORWARD_TIMEOUT,
        },
      };
    }
  });
  return result;
};

const buildOsmosisSwapMemo = ({
  tokenOutDenom,
  slippagePercentage,
  receiver,
  nextMemo,
}: {
  tokenOutDenom: string;
  slippagePercentage: string;
  receiver: string;
  nextMemo: any;
}): any => {
  const result = {
    wasm: {
      contract: CROSSCHAIN_SWAP_ADDRESS,
      msg: {
        osmosis_swap: {
          output_denom: tokenOutDenom,
          slippage: {
            twap: {
              slippage_percentage: slippagePercentage,
              window_seconds: 10,
            },
          },
          receiver,
          on_failed_delivery: 'do_nothing',
          next_memo: nextMemo,
        },
      },
    },
  };
  return result;
};

const buildForwardMemo = ({
  transferRoutes,
  osmosisSwapMemo,
}: {
  transferRoutes: string[];
  osmosisSwapMemo: any;
}) => {
  let result = {};
  transferRoutes.reverse().forEach((route, index) => {
    const [srcPort, srcChannel] = route.split('/');
    if (index === 0) {
      result = {
        forward: {
          receiver: CROSSCHAIN_SWAP_ADDRESS,
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
          next: result,
          timeout: FORWARD_TIMEOUT,
        },
      };
    }
  });
  return JSON.stringify(result);
};

const buildSwapTransfer = ({
  transferRoutes,
  transferBackRoutes,
  receiver,
  tokenOutDenom,
  slippagePercentage,
}: {
  transferRoutes: string[];
  transferBackRoutes: string[];
  receiver: string;
  tokenOutDenom: string;
  slippagePercentage: string;
}): { sourceRoute: string; packetReceiver: string; memo: string } => {
  const [sourceRoute, ...restRoutes] = transferRoutes;
  if (!sourceRoute) {
    throw new Error('Swap transfer route is missing.');
  }

  if (restRoutes.length === 0) {
    const [returnRoute] = transferBackRoutes;
    if (!returnRoute) {
      throw new Error('Direct swap return route is missing.');
    }
    const osmosisSwapMemo = buildOsmosisSwapMemo({
      nextMemo: {},
      receiver: buildDirectIbcReceiver(returnRoute, receiver),
      tokenOutDenom,
      slippagePercentage,
    });
    return {
      sourceRoute,
      packetReceiver: CROSSCHAIN_SWAP_ADDRESS!,
      memo: JSON.stringify(osmosisSwapMemo),
    };
  }

  const nextMemo = buildNextMemo(
    transferBackRoutes,
    requirePaymentKeyHashFromCardanoAddress(receiver),
  );
  const osmosisSwapMemo = buildOsmosisSwapMemo({
    nextMemo,
    receiver: 'cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6',
    tokenOutDenom,
    slippagePercentage,
  });
  return {
    sourceRoute,
    packetReceiver: pfmReceiver,
    memo: buildForwardMemo({
      transferRoutes: restRoutes,
      osmosisSwapMemo,
    }),
  };
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
}): Promise<{ typeUrl: string; unsignedTxCborHex: string }[]> {
  if (!CROSSCHAIN_SWAP_ADDRESS) {
    throw new Error(
      'NEXT_PUBLIC_CROSSCHAIN_SWAP_ADDRESS is required to build swap transactions.',
    );
  }
  const currentTimeStamp = BigInt(Date.now()) * BigInt(1000000);
  const { sourceRoute, packetReceiver, memo } = buildSwapTransfer({
    transferRoutes,
    transferBackRoutes,
    receiver,
    tokenOutDenom,
    slippagePercentage,
  });
  const [srcPort, srcChannel] = sourceRoute.split('/');
  const cardanoTokenTrace = await requireCardanoAssetDenomTrace(tokenIn.denom);
  const sendTokenDenom = cardanoTokenTrace.fullDenom;
  const data = await transfer({
    sourcePort: srcPort,
    sourceChannel: srcChannel,
    token: {
      denom: sendTokenDenom,
      amount: tokenIn.amount,
    },
    sender: requirePaymentKeyHashFromCardanoAddress(sender),
    receiver: packetReceiver,
    timeoutHeight: {
      revisionNumber: BigInt(0).toString(),
      revisionHeight: BigInt(0).toString(),
    },
    timeoutTimestamp: (currentTimeStamp + BigInt(timeoutTimeOffset)).toString(),
    signer: sender,
    memo,
  });
  return [
    {
      typeUrl: data?.unsignedTx?.type_url ?? '',
      unsignedTxCborHex: requireUnsignedCardanoTxCborHex(
        data?.unsignedTx?.unsignedTxCborHex,
      ),
    },
  ];
}
