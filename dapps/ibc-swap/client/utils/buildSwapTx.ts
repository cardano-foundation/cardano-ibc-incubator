import { transfer } from '@/apis/restapi/cardano';
import apolloClient from '@/apis/apollo/apolloClient';
import { getPublicKeyHashFromAddress } from './address';
import { GET_CARDANO_DENOM_BY_ID } from '@/apis/apollo/query';

const pfmReceiver = 'pfm';
const CROSSCHAIN_SWAPS_ADDRESS =
  process.env.NEXT_PUBLIC_CROSSCHAIN_SWAP_ADDRESS!;

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
          timeout: "60m",
        },
      };
    } else {
      result = {
        forward: {
          receiver: pfmReceiver,
          port: srcPort,
          channel: srcChannel,
          next: result,
          timeout: "60m",
        },
      };
    }
  });
  return result;
};

const buildOsmosisSwapMemo = ({
  tokenOutDenom,
  slippagePercentage,
  nextMemo,
}: {
  tokenOutDenom: string;
  slippagePercentage: string;
  nextMemo: any;
}): any => {
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
          receiver: 'cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6',
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
          next: result,
          timeout: "60m",
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
  const nextMemo = buildNextMemo(
    transferBackRoutes,
    getPublicKeyHashFromAddress(receiver)!,
  );
  const osmosisSwapMemo = buildOsmosisSwapMemo({
    nextMemo,
    tokenOutDenom,
    slippagePercentage,
  });
  const forwardMemo = buildForwardMemo({
    transferRoutes: restRoutes,
    osmosisSwapMemo,
  });
  const cardanoTokenTrace = await apolloClient
    .query({
      query: GET_CARDANO_DENOM_BY_ID,
      variables: { id: tokenIn.denom.replaceAll('.', '') },
      fetchPolicy: 'network-only',
    })
    .then((res) => res.data?.cardanoIbcAsset)
    .catch(() => ({
      denom: '',
      path: '',
    }));
  const sendTokenDenom = cardanoTokenTrace?.denom
    ? `${cardanoTokenTrace?.path}/${cardanoTokenTrace?.denom}`
    : tokenIn.denom;
  const data = await transfer({
    sourcePort: srcPort,
    sourceChannel: srcChannel,
    token: {
      denom: sendTokenDenom,
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
