import { createContext, useMemo, useState, useEffect } from 'react';

import {
  RawChannelMapping,
  IBCDenomTrace,
  ChainToChainChannels,
  TransferRoutes,
} from '@/types/IBCParams';
import { fetchOsmosisDenomTraces } from '@/services/Osmosis';
import { fetchAllChannels } from '@/services/CommonCosmosServices';

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
};

type tmpResolveRoutes = {
  [key: number]: {
    [key: string]: string[];
  };
};

const IBCParamsContext = createContext<IBCParamsContextType>(
  {} as IBCParamsContextType,
);

const getPathTrace = (path: string) => {
  const steps = path.split('/');
  if (steps.length % 2 !== 0) {
    return [];
  }
  const tmp = [];
  for (let index = 0; index < steps.length; index += 2) {
    tmp.push(`${steps[index]}/${steps[index + 1]}`);
  }
  return tmp;
};

export const IBCParamsProvider = ({
  children,
}: {
  children?: React.ReactNode;
}) => {
  const [rawChannelMappings, setRawChannelMappings] = useState<
    RawChannelMapping[]
  >([]);
  const [chainToChainMappings, setChainToChainMappings] =
    useState<ChainToChainChannels>({});
  const [osmosisIBCTokenTraces, setOsmosisIBCTokenTraces] =
    useState<IBCDenomTrace>({});

  const updateOsmosisDenomTrace = async () => {
    fetchOsmosisDenomTraces().then((res: IBCDenomTrace) => {
      setOsmosisIBCTokenTraces(res);
    });
  };

  const fetchRawChannelsMapping = async () => {
    fetchAllChannels(
      'sidechain',
      process.env.NEXT_PUBLIC_SIDECHAIN_REST_ENDPOINT!,
    ).then((res: RawChannelMapping[]) => {
      setRawChannelMappings(res);
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

  const calculateTransferRoutes = (
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
      console.timeEnd(`currentDepth:${currentDepth}`);
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
  };

  useEffect(() => {
    // fetch and update channel mappings
    fetchRawChannelsMapping();
  }, []);

  useEffect(() => {
    // update chain to chain mappings
    updateChainToChainChannels();
  }, [JSON.stringify(rawChannelMappings)]);

  useEffect(() => {
    // fetchOsmosisDenomTraces
    updateOsmosisDenomTrace();
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
        }),
        [rawChannelMappings, osmosisIBCTokenTraces],
      )}
    >
      {children}
    </IBCParamsContext.Provider>
  );
};

export default IBCParamsContext;