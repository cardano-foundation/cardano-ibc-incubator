import { osmosis } from 'osmojs';

import { CARDANO_LOVELACE_HEX_STRING, OSMOSIS_CHAIN_ID } from '@/constants';
import { getTokenDenomTraceCosmos } from './CommonCosmosServices';
import { chainsRestEndpoints } from '@/configs/customChainInfo';
import {
  fetchCrossChainSwapRouterState,
  fetchOsmosisDenomTraces,
  getEstimateSwapRPC,
  getOsmosisPools,
} from './Osmosis';
import { getPathTrace } from '@/utils/string';

export async function getTokenDenomTrace(chainId: string, tokenString: string) {
  if (!tokenString.startsWith('ibc/')) {
    if (chainId === process.env.NEXT_PUBLIC_CARDANO_CHAIN_ID) {
      return {
        path: '',
        base_denom:
          tokenString.toLowerCase() === 'lovelace'
            ? CARDANO_LOVELACE_HEX_STRING
            : tokenString,
      };
    } else {
      return {
        path: '',
        base_denom: tokenString,
      };
    }
  }
  let trace: any = {};
  if (chainId !== process.env.NEXT_PUBLIC_CARDANO_CHAIN_ID) {
    // cosmos
    trace = await getTokenDenomTraceCosmos(
      chainsRestEndpoints[chainId],
      tokenString.replace('ibc/', ''),
    ).then((res) => {
      const {
        denom_trace: { path, base_denom },
      } = res;
      return {
        path,
        base_denom,
      };
    });
  } else {
    // fetch from cardano
  }

  return trace;
}

export const swapChain = OSMOSIS_CHAIN_ID;

function traceBackRoutesFrom(
  chainId: string,
  tokenInPoolTrace: any,
  channelsMap: any,
) {
  const paths = getPathTrace(tokenInPoolTrace?.path);
  let tmpChainId = chainId;
  let chains = [chainId];
  let routes: string[] = [];
  let counterRoutes: string[] = [];
  paths.forEach((path) => {
    let pairPortChannel = path.split('/');
    const [port, channel] = pairPortChannel;
    const counterChannelPair = channelsMap[`${tmpChainId}_${port}_${channel}`];
    if (counterChannelPair) {
      routes.push(`${port}/${channel}`);
      counterRoutes.push(
        `${counterChannelPair.destPort}/${counterChannelPair.destChannel}`,
      );
      chains.push(counterChannelPair.destChain);
      tmpChainId = counterChannelPair.destChain;
    }
  });
  // paths: PA/CA/PB/CB/PC/CC => ['PA/CA', 'PB/CB', 'PC/CC]
  // chains: [A <= B <= C <= D]
  // routes: [A <=(PA/CA)= B <=(PB/CB)= C <=(PC/CC)= D]
  // counterRoutes: [A =counter(PA/CA)=> B =counter(PB/CB)=> C =counter(PC/CC)=> D]
  return {
    chains,
    routes,
    counterRoutes,
    paths,
  };
}

function tryMatchToken(
  tokenChainId: string,
  tokenTrace: any,
  tokenInPoolTrace: any,
  allChannelMappings: any,
) {
  // not match base denom
  if (tokenTrace.base_denom !== tokenInPoolTrace.base_denom) {
    return {
      match: false,
      chains: [],
      routes: [],
      fromToken: null,
      toToken: null,
    };
  }

  // exact match osmo
  if (tokenChainId === swapChain && tokenTrace.path === tokenInPoolTrace.path) {
    return {
      match: true,
      chains: [swapChain],
      routes: [],
      fromToken: tokenTrace,
      toToken: tokenInPoolTrace,
    };
  }

  // tokenTrace is native (not IBC) => tokenInPoolTrace IBC
  if (tokenTrace?.path === '' && tokenInPoolTrace?.path !== '') {
    // try resolve tokenInPoolTrace, if it could reach tokenChainId, then resolve
    let traceBack = traceBackRoutesFrom(
      swapChain,
      tokenInPoolTrace,
      allChannelMappings,
    );
    const { chains, routes, paths } = traceBack;
    if (
      paths.length === routes.length &&
      chains[chains.length - 1] === tokenChainId
    ) {
      return {
        match: true,
        chains: chains.reverse(),
        routes: routes.reverse(),
        fromToken: tokenTrace,
        toToken: tokenInPoolTrace,
      };
    }
  }

  // tokenTrace is IBC => tokenInPoolTrace is native
  if (tokenTrace?.path !== '' && tokenInPoolTrace?.path === '') {
    // try resolve tokenInPoolTrace, if it could reach tokenChainId, then resolve
    let traceBack = traceBackRoutesFrom(
      tokenChainId,
      tokenTrace,
      allChannelMappings,
    );
    const { chains, counterRoutes, paths } = traceBack;
    if (
      paths.length === counterRoutes.length &&
      chains[chains.length - 1] === swapChain
    ) {
      return {
        match: true,
        chains: chains,
        routes: counterRoutes,
        fromToken: tokenTrace,
        toToken: tokenInPoolTrace,
      };
    }
  }

  // tokenTrace is IBC => tokenInPoolTrace is IBC
  // paths: PA/CA/PB/CB/PC/CC => ['PA/CA', 'PB/CB', 'PC/CC]
  // chains: [A <= B <= C <= D]
  // routes: [A <=(PA/CA)= B <=(PB/CB)= C <=(PC/CC)= D]
  // counterRoutes: [A =counter(PA/CA)=> B =counter(PB/CB)=> C =counter(PC/CC)=> D]
  let traceBackInPool = traceBackRoutesFrom(
    swapChain,
    tokenInPoolTrace,
    allChannelMappings,
  );
  const {
    chains: chainsInPool,
    routes: routesInPool,
    paths: pathsInPool,
  } = traceBackInPool;
  if (pathsInPool.length !== routesInPool.length) {
    return {
      match: false,
      chains: [],
      routes: [],
      fromToken: [],
      toToken: [],
    };
  }
  let traceBackInput = traceBackRoutesFrom(
    tokenChainId,
    tokenTrace,
    allChannelMappings,
  );
  const {
    chains: chainsInput,
    routes: routesInput,
    counterRoutes: counterRoutesInput,
    paths: pathsInput,
  } = traceBackInput;
  if (pathsInput.length !== routesInput.length) {
    return {
      match: false,
      chains: [],
      routes: [],
      fromToken: [],
      toToken: [],
    };
  }
  if (
    chainsInPool.length > 0 &&
    chainsInput.length > 0 &&
    chainsInPool[chainsInPool.length - 1] ===
    chainsInput[chainsInput.length - 1]
  ) {
    const reverseRoutesInPool = routesInPool.reverse();
    const reverseRoutesInput = routesInput.reverse();
    const minLength = Math.min(
      reverseRoutesInPool.length,
      reverseRoutesInput.length,
    );
    // try to find intersect
    let bestMatchIntersectIndex = -1;
    while (bestMatchIntersectIndex < minLength) {
      if (
        reverseRoutesInPool[bestMatchIntersectIndex + 1] !==
        reverseRoutesInput[bestMatchIntersectIndex + 1]
      ) {
        break;
      } else bestMatchIntersectIndex++;
    }
    // example: noble => cosmoshub (from transfer/channel-4 => transfer/channel-536 to unwrap)
    const chainStep1: string[] = chainsInput.slice(
      0,
      chainsInput.length - 1 - bestMatchIntersectIndex,
    );
    const routesStep1: string[] = counterRoutesInput.slice(
      0,
      counterRoutesInput.length - 1 - bestMatchIntersectIndex,
    );

    // example: cosmoshub => osmo
    const chainStep2 = chainsInPool
      .slice(0, chainsInPool.length - 2 - bestMatchIntersectIndex)
      .reverse();
    const routesStep2 = routesInPool
      .slice(0, routesInPool.length - 1 - bestMatchIntersectIndex)
      .reverse();
    const chains: string[] = ([] as string[]).concat(chainStep1, chainStep2);
    const routes: string[] = ([] as string[]).concat(routesStep1, routesStep2);
    if (chains[0] !== tokenChainId || chains[chains.length - 1] !== swapChain) {
      return {
        match: false,
        chains: [],
        routes: [],
        fromToken: null,
        toToken: null,
      };
    }

    return {
      match: true,
      chains: chains,
      routes: routes,
      fromToken: tokenTrace,
      toToken: tokenInPoolTrace,
    };
  }

  return {
    match: false,
    chains: [],
    routes: [],
    fromToken: null,
    toToken: null,
  };
}

export async function checkSwap(allChannelMappings: any) {
  const token0ChainId = '42';
  const token0String = 'lovelace';
  const token1ChainId = 'localosmosis';
  const token1String = 'uion';
  const [pools, osmosisDenomTraces, token0Trace, token1Trace] =
    await Promise.all([
      getOsmosisPools(),
      fetchOsmosisDenomTraces(),
      getTokenDenomTrace(token0ChainId, token0String),
      getTokenDenomTrace(token1ChainId, token1String),
    ]);
  // quick filter, just mapping with base_denom
  const preFilterPools = pools.reduce((acc: any, pool: any) => {
    const { token0, token1 } = pool;
    const token0PoolTrace = token0.startsWith('ibc/')
      ? {
        path: osmosisDenomTraces[token0].path,
        base_denom: osmosisDenomTraces[token0].baseDenom,
      }
      : {
        path: '',
        base_denom: token0 as string,
      };
    const token1PoolTrace = token1.startsWith('ibc/')
      ? {
        path: osmosisDenomTraces[token1].path,
        base_denom: osmosisDenomTraces[token1].baseDenom,
      }
      : {
        path: '',
        base_denom: token1 as string,
      };
    if (!token0PoolTrace?.base_denom || !token1PoolTrace?.base_denom)
      return acc;
    if (
      (token0PoolTrace?.base_denom === token0Trace?.base_denom &&
        token1PoolTrace?.base_denom === token1Trace?.base_denom) ||
      (token0PoolTrace?.base_denom === token1Trace?.base_denom &&
        token1PoolTrace?.base_denom === token0Trace?.base_denom)
    ) {
      acc.push({ ...pool, token0PoolTrace, token1PoolTrace });
      return acc;
    } else return acc;
  }, []);
  // more advanced filter
  const advancedFilter = (preFilterPools || []).reduce(
    (acc: any, pool: any) => {
      const { token0PoolTrace, token1PoolTrace } = pool;
      const token0PoolTraceWToken0 = tryMatchToken(
        token0ChainId,
        token0Trace,
        token0PoolTrace,
        allChannelMappings,
      );
      const token0PoolTraceWToken1 = tryMatchToken(
        token1ChainId,
        token1Trace,
        token0PoolTrace,
        allChannelMappings,
      );
      const token1PoolTraceWToken0 = tryMatchToken(
        token0ChainId,
        token0Trace,
        token1PoolTrace,
        allChannelMappings,
      );
      const token1PoolTraceWToken1 = tryMatchToken(
        token1ChainId,
        token1Trace,
        token1PoolTrace,
        allChannelMappings,
      );
      if (token0PoolTraceWToken0.match && token1PoolTraceWToken1.match) {
        // ok
        acc.push({
          ...pool,
          in: token0PoolTraceWToken0,
          out: token1PoolTraceWToken1,
        });
      } else if (token0PoolTraceWToken1.match && token1PoolTraceWToken0.match) {
        // ok
        acc.push({
          ...pool,
          in: token1PoolTraceWToken0,
          out: token0PoolTraceWToken1,
        });
      }

      return acc;
    },
    [],
  );
  return advancedFilter;
}

function checkTransferRoute(chains: string[], arrayDestChannelPort: string[], availableChannelsMap: any): {
  canTransfer: boolean,
  transferRoutes: string[]
} {
  const defaultResult = {
    canTransfer: false,
    transferRoutes: []
  }
  if (chains.length <= 1) {
    return { ...defaultResult, canTransfer: chains.length === 1 }
  }

  if (chains.length !== arrayDestChannelPort.length + 1) {
    return defaultResult
  }
  let canTransfer = true;
  let transferRoutes: string[] = []

  arrayDestChannelPort.forEach((pair, index) => {
    const [destPort, destChannel] = pair.split('/')
    const srcChain = chains[index]
    const destChain = chains[index + 1]
    const mapp = availableChannelsMap[`${destChain}_${destPort}_${destChannel}`]
    if (typeof mapp === 'undefined' || mapp.destChain !== srcChain) {
      canTransfer = false
    } else {
      transferRoutes.push(`${mapp.destPort}/${mapp.destChannel}`)
    }
  })
  return {
    canTransfer,
    transferRoutes
  }
}

export async function findRouteAndPools(allChannelMappings: any, availableChannelsMap: any) {
  const token0ChainId = '42';
  const token0String = 'lovelace';
  const token1ChainId = 'localosmosis';
  const token1String = 'uion';
  const swapAmount = '123'
  const [routeMap, osmosisDenomTraces, token0Trace, token1Trace] =
    await Promise.all([
      fetchCrossChainSwapRouterState(),
      fetchOsmosisDenomTraces(),
      getTokenDenomTrace(token0ChainId, token0String),
      getTokenDenomTrace(token1ChainId, token1String),
    ]);

  // quick filter, just mapping with base_denom
  const preFilterPools = routeMap.reduce((acc: any, pool: any) => {
    const { inToken: token0, outToken: token1 } = pool;
    const token0PoolTrace = token0.startsWith('ibc/')
      ? {
        path: osmosisDenomTraces[token0].path,
        base_denom: osmosisDenomTraces[token0].baseDenom,
      }
      : {
        path: '',
        base_denom: token0 as string,
      };
    const token1PoolTrace = token1.startsWith('ibc/')
      ? {
        path: osmosisDenomTraces[token1].path,
        base_denom: osmosisDenomTraces[token1].baseDenom,
      }
      : {
        path: '',
        base_denom: token1 as string,
      };
    if (!token0PoolTrace?.base_denom || !token1PoolTrace?.base_denom)
      return acc;
    if (
      token0PoolTrace?.base_denom === token0Trace?.base_denom &&
      token1PoolTrace?.base_denom === token1Trace?.base_denom
    ) {
      acc.push({ ...pool, token0PoolTrace, token1PoolTrace });
      return acc;
    } else return acc;
  }, []);
  const advancedFilter = (preFilterPools || []).reduce(
    (acc: any, pool: any) => {
      const { token0PoolTrace, token1PoolTrace } = pool;
      const token0PoolTraceWToken0 = tryMatchToken(
        token0ChainId,
        token0Trace,
        token0PoolTrace,
        allChannelMappings,
      );

      const token1PoolTraceWToken1 = tryMatchToken(
        token1ChainId,
        token1Trace,
        token1PoolTrace,
        allChannelMappings,
      );
      if (token0PoolTraceWToken0.match && token1PoolTraceWToken1.match) {
        // ok
        acc.push({
          ...pool,
          in: token0PoolTraceWToken0,
          out: token1PoolTraceWToken1,
        });
      }
      return acc;
    },
    [],
  );
  // filter can reach
  const ableToTransferFilter = (advancedFilter || []).reduce((acc: any, pool: any) => {
    const { in: inTokenPool } = pool
    const { chains, routes: arrayDestChannelPort } = inTokenPool
    const { canTransfer,
      transferRoutes } = checkTransferRoute(chains, arrayDestChannelPort, availableChannelsMap)
    if (!canTransfer) return acc
    acc.push({ ...pool, transferRoutes })
    return acc
  }, [])
  const rpcEndpoint = process.env.NEXT_PUBLIC_LOCALOSMOIS_RPC_ENDPOINT!
  const rpcClient = await osmosis.ClientFactory.createRPCQueryClient({ rpcEndpoint })
  // query amount out
  // TODO: handle error
  let poolsWithAmount = await Promise.all(
    ableToTransferFilter.map((pool: any) => {
      const { route, inToken } = pool
      return getEstimateSwapRPC(rpcClient, `${swapAmount}${inToken}`, route)
    })
  ).then(res => {
    return res.map((data, index) => {
      const { message, tokenOutAmount } = data
      return { ...ableToTransferFilter[index], tokenOutAmount, message }
    })
  })
  // sort 
  poolsWithAmount = poolsWithAmount.sort((a: { tokenOutAmount: bigint }, b: { tokenOutAmount: bigint }) => {
    if (b.tokenOutAmount === a.tokenOutAmount) return 0
    if (b.tokenOutAmount > a.tokenOutAmount) return 1
    return -1
  })

  console.log(poolsWithAmount)
}
