import {
  createContext,
  useMemo,
  useState,
  useEffect,
} from 'react';
import {
  RawChannelMapping,
  ChainToChainChannels,
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

type IBCParamsContextType = {
  rawChannelMappings: RawChannelMapping[];
  chainToChainMappings: ChainToChainChannels;
  getPfmFee: (chainId: string) => BigNumber;
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
          getPfmFee,
        }),
        [
          rawChannelMappings,
          chainToChainMappings,
          getPfmFee,
        ],
      )}
    >
      {children}
    </IBCParamsContext.Provider>
  );
};

export default IBCParamsContext;
