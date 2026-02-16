import {
  createContext,
  useMemo,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { osmosis } from 'osmojs';
import {
  RawChannelMapping,
  IBCDenomTrace,
  ChainToChainChannels,
  TransferRoutes,
} from '@/types/IBCParams';
import {
  fetchCrossChainSwapRouterState,
  fetchOsmosisDenomTraces,
} from '@/services/Osmosis';
import {
  fetchAllChannels,
  fetchPacketForwardFee,
} from '@/services/CommonCosmosServices';
import BigNumber from 'bignumber.js';
import { DEFAULT_PFM_FEE, ENTRYPOINT_CHAIN_ID } from '@/constants';
import { chainsRestEndpoints } from '@/configs/customChainInfo';
import { getPathTrace } from '@/utils/string';
import { findRouteAndPools } from '@/services/Common';

type IBCParamsContextType = {
  rawChannelMappings: RawChannelMapping[];
  osmosisIBCTokenTraces: IBCDenomTrace;
  chainToChainMappings: ChainToChainChannels;
  updateOsmosisDenomTrace: () => Promise<void>;
  calculateTransferRoutes: (
    srcChainId: string,
    destChainId: string,
    depth: number,
  ) => TransferRoutes;
  getPfmFee: (chainId: string) => BigNumber;
  calculateSwapEst: (data: {
    fromChain: string;
    tokenInDenom: string;
    tokenInAmount: string;
    toChain: string;
    tokenOutDenom: string;
  }) => Promise<any>;
};

type tmpResolveRoutes = {
  [key: number]: {
    [key: string]: string[];
  };
};

const IBCParamsContext = createContext<IBCParamsContextType>(
  {} as IBCParamsContextType,
);

export const IBCParamsProvider = ({
  children,
}: {
  children?: React.ReactNode;
}) => {
  const [rawChannelMappings, setRawChannelMappings] = useState<
    RawChannelMapping[]
  >([]);
  const [crossChainSwapRouterState, setCrossChainSwapRouterState] = useState<
    any[]
  >([]);
  const [allChannelMappings, setAllChannelMappings] = useState<any>({});
  const [availableChannelsMappings, setAvailableChannelsMappings] =
    useState<any>({});
  const [chainToChainMappings, setChainToChainMappings] =
    useState<ChainToChainChannels>({});
  const [osmosisIBCTokenTraces, setOsmosisIBCTokenTraces] =
    useState<IBCDenomTrace>({});

  const [osmosisRPCQueryClient, setOsmosisRPCQueryClient] = useState<any>(null);

  const [pfmFees, setPfmFees] = useState<{ [key: string]: BigNumber }>({});

  const getPfmFee = (chainId: string): BigNumber => {
    return pfmFees[chainId] ?? BigNumber(DEFAULT_PFM_FEE);
  };

  const initRPCClient = async () => {
    const rpcEndpoint = process.env.NEXT_PUBLIC_LOCALOSMOIS_RPC_ENDPOINT!;
    const rpcClient = await osmosis.ClientFactory.createRPCQueryClient({
      rpcEndpoint,
    });
    setOsmosisRPCQueryClient(rpcClient);
  };

  const updateOsmosisDenomTrace = async () => {
    fetchOsmosisDenomTraces().then((res: IBCDenomTrace) => {
      setOsmosisIBCTokenTraces(res);
    });
  };

  const fetchRawChannelsMapping = async () => {
    const entrypointRestEndpoint =
      process.env.NEXT_PUBLIC_ENTRYPOINT_REST_ENDPOINT!;
    fetchAllChannels(
      ENTRYPOINT_CHAIN_ID,
      entrypointRestEndpoint,
    ).then((res: any) => {
      setRawChannelMappings(res.bestChannel);
      setAllChannelMappings(res.channelsMap);
      setAvailableChannelsMappings(res.availableChannelsMap);
    });
  };

  const updateChainToChainChannels = () => {
    if (rawChannelMappings.length !== 0) {
      const channels = rawChannelMappings.reduce(
        (acc: ChainToChainChannels, cur) => {
          const {
            srcChain,
            srcChannel,
            srcPort,
            destChannel,
            destPort,
            destChain,
          } = cur;
          if (acc[srcChain] === undefined) {
            acc[srcChain] = {};
          }
          if (acc[srcChain][destChain!] === undefined) {
            acc[srcChain][destChain!] = [];
          }
          if (acc[destChain!] === undefined) {
            acc[destChain!] = {};
          }
          if (acc[destChain!][srcChain] === undefined) {
            acc[destChain!][srcChain] = [];
          }
          const tmpObj = {
            channel: srcChannel,
            port: srcPort,
            counterChannel: destChannel,
            counterPort: destPort,
          };
          acc[srcChain][destChain!] =
            acc[srcChain][destChain!].length === 0
              ? [tmpObj]
              : [...acc[srcChain][destChain!], tmpObj];
          const tmpCounterObj = {
            channel: destChannel,
            port: destPort,
            counterChannel: srcChannel,
            counterPort: srcPort,
          };
          acc[destChain!][srcChain] =
            acc[destChain!][srcChain].length === 0
              ? [tmpCounterObj]
              : [...acc[destChain!][srcChain], tmpCounterObj];
          return acc;
        },
        {} as ChainToChainChannels,
      );
      setChainToChainMappings(channels);
    }
  };

  const calculateTransferRoutes = useCallback(
    (
      srcChainId: string,
      destChainId: string,
      depth: number = 4,
    ): TransferRoutes => {
      const tmpReturn = {
        foundRoute: false,
        chains: [srcChainId],
        routes: [],
      } as TransferRoutes;

      if (srcChainId === destChainId) {
        return { ...tmpReturn, foundRoute: true };
      }
      const chainNames = Object.keys(chainToChainMappings);

      const fromChain = chainToChainMappings[srcChainId];
      const tmp: tmpResolveRoutes = {};
      let currentDepth = 1;
      tmp[currentDepth] = {};
      Object.keys(fromChain || {}).forEach((chain) => {
        fromChain[chain].forEach((channelPair) => {
          const channelPort = `${channelPair.port}/${channelPair.channel}`;
          tmp[currentDepth][`${channelPort}`] = [srcChainId, chain];
        });
      });
      while (currentDepth <= depth) {
        currentDepth += 1;
        tmp[currentDepth] = {};
        // eslint-disable-next-line no-loop-func
        Object.keys(tmp[currentDepth - 1]).forEach((path) => {
          const data = tmp[currentDepth - 1][path];
          const processedChains = data;
          const sourceChainName = processedChains[processedChains.length - 1];
          if (sourceChainName !== destChainId) {
            const chainAvail = chainNames.filter(
              (i) => !processedChains.includes(i),
            );
            const sourceChain = chainToChainMappings[sourceChainName];
            Object.keys(sourceChain)
              .filter((nextChainName) => chainAvail.includes(nextChainName))
              .forEach((chainName) => {
                sourceChain[chainName].forEach((channelPair) => {
                  const channelPort = `${channelPair.port}/${channelPair.channel}`;
                  const tokenPath = `${path}/${channelPort}`;
                  tmp[currentDepth][`${tokenPath}`] = [...data, chainName];
                });
              });
          }
        });
      }
      const routesResult = Object.keys(tmp).reduce((acc, thisDepth) => {
        const thisCurrentDepth = parseInt(thisDepth, 10);
        const filferData = Object.keys(tmp[thisCurrentDepth]).reduce(
          (accData, itemKey) => {
            if (
              tmp[thisCurrentDepth][itemKey][
                tmp[thisCurrentDepth][itemKey].length - 1
              ] === destChainId
            ) {
              accData[itemKey] = tmp[thisCurrentDepth][itemKey];
              return accData;
            }
            return accData;
          },
          {} as any,
        );
        acc = Object.assign(acc, filferData);
        return acc;
      }, {} as any);
      const routesResultKey = Object.keys(routesResult);
      if (routesResultKey.length === 0) {
        return tmpReturn;
      }
      return {
        foundRoute: true,
        chains: routesResult[routesResultKey[0]],
        routes: getPathTrace(routesResultKey[0]),
      };
    },
    [JSON.stringify(chainToChainMappings)],
  );

  const getCrossChainSwapRouterState = async () => {
    fetchCrossChainSwapRouterState().then((res) =>
      setCrossChainSwapRouterState(res),
    );
  };
  const fetchPFMs = async () => {
    const chains = Object.keys(chainsRestEndpoints);
    await Promise.all(
      chains.map((chainId) => {
        return fetchPacketForwardFee(chainsRestEndpoints[chainId]).then(
          (res) => ({ chainId, fee: res }),
        );
      }),
    ).then((fees: { chainId: string; fee: BigNumber }[]) => {
      const dataFees = fees.reduce((acc: { [key: string]: BigNumber }, cur) => {
        const { chainId, fee } = cur;
        acc[chainId] = fee;
        return acc;
      }, {});
      setPfmFees(dataFees);
    });
  };
  const calculateSwapEst = useCallback(
    async ({
      fromChain,
      tokenInDenom,
      tokenInAmount,
      toChain,
      tokenOutDenom,
    }: {
      fromChain: string;
      tokenInDenom: string;
      tokenInAmount: string;
      toChain: string;
      tokenOutDenom: string;
    }): Promise<any> => {
      if (
        Object.keys(allChannelMappings).length > 0 &&
        Object.keys(availableChannelsMappings).length > 0 &&
        Object.keys(pfmFees).length > 0 &&
        Object.keys(osmosisIBCTokenTraces).length > 0 &&
        osmosisRPCQueryClient?.osmosis &&
        crossChainSwapRouterState.length > 0
      ) {
        return findRouteAndPools(
          fromChain,
          tokenInDenom,
          tokenInAmount,
          toChain,
          tokenOutDenom,
          allChannelMappings,
          availableChannelsMappings,
          getPfmFee,
          osmosisIBCTokenTraces,
          crossChainSwapRouterState,
          osmosisRPCQueryClient,
        );
      }
      return {
        message: 'Loading services, pls wait!',
        tokenOutAmount: BigInt(0),
        tokenOutTransferBackAmount: BigInt(0),
      };
    },
    [
      JSON.stringify(allChannelMappings),
      JSON.stringify(availableChannelsMappings),
      JSON.stringify(pfmFees),
      JSON.stringify(osmosisIBCTokenTraces),
      osmosisRPCQueryClient,
      JSON.stringify(crossChainSwapRouterState),
    ],
  );

  useEffect(() => {
    // fetch pfm fee
    fetchPFMs();
  }, []);

  useEffect(() => {
    // fetch and update channel mappings
    fetchRawChannelsMapping();
  }, []);

  useEffect(() => {
    // getCrossChainSwapRouterState
    getCrossChainSwapRouterState();
  }, []);

  useEffect(() => {
    // update chain to chain mappings
    updateChainToChainChannels();
  }, [JSON.stringify(rawChannelMappings)]);

  useEffect(() => {
    // fetchOsmosisDenomTraces
    updateOsmosisDenomTrace();
  }, []);

  useEffect(() => {
    // initRPCClient
    initRPCClient();
  }, []);

  return (
    <IBCParamsContext.Provider
      value={useMemo(
        () => ({
          rawChannelMappings,
          osmosisIBCTokenTraces,
          updateOsmosisDenomTrace,
          chainToChainMappings,
          calculateTransferRoutes,
          getPfmFee,
          calculateSwapEst,
        }),
        [
          rawChannelMappings,
          osmosisIBCTokenTraces,
          allChannelMappings,
          osmosisRPCQueryClient,
          calculateTransferRoutes,
        ],
      )}
    >
      {children}
    </IBCParamsContext.Provider>
  );
};

export default IBCParamsContext;
