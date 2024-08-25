import { createContext, useMemo, useState, useEffect } from 'react';

import {
  RawChannelMapping,
  IBCDenomTrace,
  ChainToChainChannels,
  TransferRoutes,
} from '@/types/IBCParams';
import {
  fetchOsmosisDenomTraces,
} from '@/services/Osmosis';
import {
  fetchAllChannels,
  fetchPacketForwardFee,
} from '@/services/CommonCosmosServices';
import BigNumber from 'bignumber.js';
import { DEFAULT_PFM_FEE } from '@/constants';
import { chainsRestEndpoints } from '@/configs/customChainInfo';
import { getPathTrace } from '@/utils/string';

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
  const [allChannelMappings, setAllChannelMappings] = useState<any>({});
  const [availableChannelsMappings, setAvailableChannelsMappings] = useState<any>({});
  const [chainToChainMappings, setChainToChainMappings] =
    useState<ChainToChainChannels>({});
  const [osmosisIBCTokenTraces, setOsmosisIBCTokenTraces] =
    useState<IBCDenomTrace>({});

  const [pfmFees, setPfmFees] = useState<{ [key: string]: BigNumber }>({});

  const getPfmFee = (chainId: string): BigNumber => {
    return pfmFees[chainId] ?? BigNumber(DEFAULT_PFM_FEE);
  };

  const updateOsmosisDenomTrace = async () => {
    fetchOsmosisDenomTraces().then((res: IBCDenomTrace) => {
      setOsmosisIBCTokenTraces(res);
    });
  };

  const fetchRawChannelsMapping = async () => {
    fetchAllChannels(
      'sidechain',
      process.env.NEXT_PUBLIC_SIDECHAIN_REST_ENDPOINT!,
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

  const fetchPFMs = async () => {
    const chains = Object.keys(chainsRestEndpoints);
    // await getTokenDenomTrace('localosmosis', 'ibc/1CF1A8C0379496090EF4157A25C51A9FEB7A8878EE8984778AE740D19295CB1C').then(console.log);
    // await getEstimateSwapWithPoolId(
    //   process.env.NEXT_PUBLIC_LOCALOSMOIS_REST_ENDPOINT!,
    //   { amount: '10', denom: 'ibc/7B9F4A53934CF0F06242E9C8B6D7076A10BFF47A9AA3A540B3FA525013DFF003' },
    //   'uion',
    //   '1',
    // );
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

  useEffect(() => {
    // fetch and update channel mappings
    fetchPFMs();
  }, []);

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
          getPfmFee,
        }),
        [rawChannelMappings, osmosisIBCTokenTraces],
      )}
    >
      {children}
    </IBCParamsContext.Provider>
  );
};

export default IBCParamsContext;
