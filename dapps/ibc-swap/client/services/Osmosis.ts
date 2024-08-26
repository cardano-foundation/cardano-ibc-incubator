// import type { Pool } from 'osmojs';
import { Coin } from 'cosmjs-types/cosmos/base/v1beta1/coin';
import { IBCDenomTrace } from '@/types/IBCParams';
import { fetchAllDenomTraces } from './CommonCosmosServices';
import {
  OSMOSIS_MAINNET_REST_ENDPOINT,
  OSMOSIS_MAINNET_SQS_ENDPOINT,
  osmosisEstimateSwapWithPoolId,
  querySwapRouterState,
  sqsQueryPoolsUrl,
} from '@/constants';
import { EstimateSwapExactAmountInResponse } from 'osmojs/osmosis/poolmanager/v1beta1/query';

const routeTableStrPrefix = '\x00\rrouting_table\x00D';

export async function fetchOsmosisDenomTraces(): Promise<IBCDenomTrace> {
  const restUrl =
    process.env.NEXT_PUBLIC_LOCALOSMOIS_REST_ENDPOINT ||
    OSMOSIS_MAINNET_REST_ENDPOINT;
  return fetchAllDenomTraces(restUrl);
}

function hex2a(hexx: string): string {
  var hex = hexx.toString(); //force conversion
  var str = '';
  for (var i = 0; i < hex.length; i += 2)
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  return str;
}

export async function fetchCrossChainSwapRouterState() {
  const restUrl =
    process.env.NEXT_PUBLIC_LOCALOSMOIS_REST_ENDPOINT ||
    OSMOSIS_MAINNET_REST_ENDPOINT;
  const fetchUrl = `${restUrl}${querySwapRouterState.replace(
    'SWAP_ROUTER_ADDRESS',
    process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS!,
  )}`;
  const data = await fetch(fetchUrl).then((res) => res.json());
  const rawRoutes = data.models;
  const routes = rawRoutes.reduce((acc: any, cur: any) => {
    const { key, value } = cur;
    let keyStr = hex2a(key);
    if (keyStr.startsWith(routeTableStrPrefix)) {
      keyStr = keyStr.replace(routeTableStrPrefix, '');
      const valueData = JSON.parse(
        Buffer.from(value, 'base64').toString('ascii'),
      );
      const lastPool = valueData[valueData.length - 1];
      const outToken = lastPool.token_out_denom;
      const inToken = keyStr.replace(outToken, '');
      if (isValidTokenInPool(inToken) && isValidTokenInPool(outToken))
        acc.push({ route: valueData, inToken, outToken });
    }
    return acc;
  }, []);
  return routes;
}

function isValidTokenInPool(tokenString: string) {
  if (tokenString.startsWith('ibc/')) return true;
  return !tokenString.includes('/');
}

export async function getOsmosisPools(IDs: string[] = []) {
  const restUrl =
    process.env.NEXT_PUBLIC_SQS_REST_ENDPOINT || OSMOSIS_MAINNET_SQS_ENDPOINT;
  const fetchUrl = `${restUrl}${sqsQueryPoolsUrl}${
    IDs.length === 0 ? '' : `?IDs=${IDs.join(',')}`
  }`;
  const rawPoolsData = await fetch(fetchUrl).then((res) => res.json());
  const loppedPools = rawPoolsData.reduce((acc: any, pool: any) => {
    const { chain_model, balances, liquidity_cap } = pool;
    if (liquidity_cap === '0') return acc;
    let tmpPool: any = {};
    const { pool_assets, pool_liquidity, id, pool_id } = chain_model;
    const { address, contract_address } = chain_model;

    if (typeof pool_assets !== 'undefined') {
      const [token0, token1] = pool_assets;
      if (
        token0?.token?.amount &&
        token0?.token?.amount !== '0' &&
        token1?.token?.amount &&
        token1?.token?.amount !== '0'
      ) {
        tmpPool = {
          token0: token0?.token?.denom,
          token1: token1?.token?.denom,
          address,
          id,
        };
      }
    } else if (typeof pool_liquidity !== 'undefined') {
      const [token0, token1] = pool_liquidity;
      if (
        token0?.amount &&
        token0?.amount !== '0' &&
        token1?.amount &&
        token1?.amount !== '0'
      ) {
        tmpPool = {
          token0: token0?.denom,
          token1: token1?.denom,
          address,
          id: id || pool_id,
        };
      }
    } else {
      const [token0, token1] = balances;
      if (
        token0?.amount &&
        token0?.amount !== '0' &&
        token1?.amount &&
        token1?.amount !== '0'
      ) {
        const { token0: chainModelToken0, token1: chainModelToken1 } =
          chain_model;
        const token0Denom = token0?.denom || chainModelToken0;
        const token1Denom = token1?.denom || chainModelToken1;
        if (
          typeof token0Denom !== 'undefined' &&
          typeof token1Denom !== 'undefined'
        ) {
          tmpPool = {
            token0: token0Denom,
            token1: token1Denom,
            address: address || contract_address,
            id: id || pool_id,
          };
        }
      }
    }
    if (tmpPool?.token0 === undefined || tmpPool?.token1 === undefined) {
      return acc;
    }
    if (
      isValidTokenInPool(tmpPool?.token0) &&
      isValidTokenInPool(tmpPool?.token1)
    ) {
      acc.push(tmpPool);
    }
    return acc;
  }, []);

  return loppedPools;
}

export async function getEstimateSwapWithPoolId(
  restUrl: string,
  tokenIn: Coin,
  tokenOut: string,
  poolId: string,
  useSqs: boolean = false,
) {
  // call poolManager
  // https://lcd.osmosis.zone/osmosis/poolmanager/v1beta1/1/estimate/swap_exact_amount_in_with_primitive_types
  // ?token_in=588453650ibc/442A08C33AE9875DF90792FFA73B5728E1CAECE87AB4F26AE9B422F1E682ED23
  // &routes_token_out_denom=uosmo
  // &routes_pool_id=1380
  const fetchUrl = `${restUrl}${osmosisEstimateSwapWithPoolId}?token_in=${
    tokenIn.amount
  }${encodeURIComponent(
    tokenIn.denom,
  )}&routes_token_out_denom=${tokenOut}&routes_pool_id=${poolId}`;
  let tokenData = {};
  try {
    const tokenDataFetch = await fetch(fetchUrl).then((res) => res.json());
    tokenData = {
      message: tokenDataFetch?.message || '',
      tokenOutAmount: tokenDataFetch?.token_out_amount || '0',
    };
  } catch (e: any) {
    tokenData = {
      message: e?.message || '',
      tokenOutAmount: '0',
    };
  }

  console.log(tokenData);
}

export async function getEstimateSwapRPC(
  osmosisRpcClient: any,
  tokenInAmount: string,
  tokenInDenom: string,
  routes: { pool_id: string; token_out_denom: string }[],
): Promise<{
  message: string;
  tokenOutAmount: bigint;
  tokenSwapAmount: bigint;
}> {
  let msg = '';
  let output = BigInt(0);
  const [firstRoute] = routes;
  await osmosisRpcClient.osmosis.poolmanager.v1beta1
    .estimateSwapExactAmountIn({
      poolId: BigInt(firstRoute.pool_id),
      tokenIn: `${tokenInAmount}${tokenInDenom}`,
      routes: (routes || []).map((route) => ({
        poolId: route.pool_id,
        tokenOutDenom: route.token_out_denom,
      })),
    })
    .then((res: EstimateSwapExactAmountInResponse) => {
      output = BigInt(res.tokenOutAmount);
    })
    .catch((e: any) => {
      let msgError = e?.message!;
      if (
        msgError.includes('expected tokensB to be of length one') ||
        msgError.includes('token amount must be positive')
      ) {
        msg = 'Input amount too small, not enough to swap, please increase!';
      } else {
        msg = e.message;
      }
    });
  return {
    message: msg,
    tokenOutAmount: output,
    tokenSwapAmount: BigInt(tokenInAmount),
  };
}
