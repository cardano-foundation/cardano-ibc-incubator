import {
  createContext,
  useMemo,
  useState,
  useEffect,
  useCallback,
} from 'react';
import {
  RawChannelMapping,
  ChainToChainChannels,
  TransferRoutes,
} from '@/types/IBCParams';
import {
  fetchAllChannels,
  fetchPacketForwardFee,
} from '@/services/CommonCosmosServices';
import BigNumber from 'bignumber.js';
import {
  DEFAULT_PFM_FEE,
  ENTRYPOINT_CHAIN_ID,
  OSMOSIS_CHAIN_ID,
} from '@/constants';
import { chainsRestEndpoints } from '@/configs/customChainInfo';
import {
  ENTRYPOINT_REST_ENDPOINT,
} from '@/configs/runtime';
import { getPathTrace } from '@/utils/string';

type IBCParamsContextType = {
  rawChannelMappings: RawChannelMapping[];
  chainToChainMappings: ChainToChainChannels;
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
  const [chainToChainMappings, setChainToChainMappings] =
    useState<ChainToChainChannels>({});

  const [pfmFees, setPfmFees] = useState<{ [key: string]: BigNumber }>({});

  const getPfmFee = (chainId: string): BigNumber => {
    return pfmFees[chainId] ?? BigNumber(DEFAULT_PFM_FEE);
  };

  const fetchRawChannelsMapping = async () => {
    fetchAllChannels(
      ENTRYPOINT_CHAIN_ID,
      ENTRYPOINT_REST_ENDPOINT,
    ).then((res: any) => {
      setRawChannelMappings(res.bestChannel);
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
        failureCode: 'no-route-found',
        failureMessage: `No IBC transfer route found from ${srcChainId} to ${destChainId}.`,
      } as TransferRoutes;

      if (srcChainId === destChainId) {
        return {
          ...tmpReturn,
          foundRoute: true,
          failureCode: undefined,
          failureMessage: undefined,
        };
      }
      const chainNames = Object.keys(chainToChainMappings);

      if (chainNames.length === 0) {
        return {
          ...tmpReturn,
          failureCode: 'channels-not-loaded',
          failureMessage:
            'IBC channel mappings have not loaded yet. Wait for channel discovery to complete and ensure the local bridge stack is up.',
        };
      }

      if (!chainNames.includes(srcChainId)) {
        return {
          ...tmpReturn,
          failureCode: 'source-chain-unavailable',
          failureMessage: `No discovered transfer channels start from ${srcChainId}.`,
        };
      }

      if (!chainNames.includes(destChainId)) {
        return {
          ...tmpReturn,
          failureCode: 'destination-chain-unavailable',
          failureMessage: `No discovered transfer channels reach ${destChainId}.`,
        };
      }

      const fromChain = chainToChainMappings[srcChainId];
      if (!fromChain || Object.keys(fromChain).length === 0) {
        return {
          ...tmpReturn,
          failureCode: 'no-outbound-channels',
          failureMessage: `Source chain ${srcChainId} has no outbound IBC transfer channels.`,
        };
      }
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
        const directlyReachableChains = Object.keys(fromChain);
        const reachableHint =
          directlyReachableChains.length === 0
            ? ''
            : ` Directly reachable chains from ${srcChainId}: ${directlyReachableChains.join(', ')}.`;
        return {
          ...tmpReturn,
          failureCode: 'no-route-found',
          failureMessage: `No IBC transfer route found from ${srcChainId} to ${destChainId} within ${depth} hops.${reachableHint}`,
        };
      }
      return {
        foundRoute: true,
        chains: routesResult[routesResultKey[0]],
        routes: getPathTrace(routesResultKey[0]),
        failureCode: undefined,
        failureMessage: undefined,
      };
    },
    [JSON.stringify(chainToChainMappings)],
  );

  const fetchPFMs = async () => {
    const chains = Object.keys(chainsRestEndpoints);
    await Promise.all(
      chains.map((chainId) => {
        if (chainId === OSMOSIS_CHAIN_ID) {
          return Promise.resolve({
            chainId,
            fee: BigNumber(DEFAULT_PFM_FEE),
          });
        }
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
    // fetch pfm fee
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

  return (
    <IBCParamsContext.Provider
      value={useMemo(
        () => ({
          rawChannelMappings,
          chainToChainMappings,
          calculateTransferRoutes,
          getPfmFee,
        }),
        [
          rawChannelMappings,
          calculateTransferRoutes,
        ],
      )}
    >
      {children}
    </IBCParamsContext.Provider>
  );
};

export default IBCParamsContext;
