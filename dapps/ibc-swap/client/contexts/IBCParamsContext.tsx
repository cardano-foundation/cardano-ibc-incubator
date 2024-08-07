import { createContext, useMemo, useState, useEffect } from 'react';

import { RawChannelMapping, IBCDenomTrace } from '@/types/IBCParams';
import { fetchOsmosisDenomTraces } from '@/services/Osmosis';
import { fetchAllChannels } from '@/services/CommonCosmosServices';

type IBCParamsContextType = {
  rawChannelMappings: RawChannelMapping[];
  osmosisIBCTokenTraces: IBCDenomTrace;
  updateOsmosisDenomTrace: () => Promise<void>;
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
  const [osmosisIBCTokenTraces, setOsmosisIBCTokenTraces] =
    useState<IBCDenomTrace>({});

  const updateOsmosisDenomTrace = async () => {
    fetchOsmosisDenomTraces().then((res: IBCDenomTrace) => {
      setOsmosisIBCTokenTraces(res);
    });
  };

  const fetchRawChannelsMapping = async () => {
    // fetchAllChannels(process.env.NEXT_PUBLIC_SIDECHAIN_REST_ENDPOINT!).then((res: RawChannelMapping[]) => {
    fetchAllChannels(
      'sidechain',
      process.env.NEXT_PUBLIC_SIDECHAIN_REST_ENDPOINT!,
    ).then((res: RawChannelMapping[]) => {
      setRawChannelMappings(res);
    });
  };

  useEffect(() => {
    // fetch and update channel mappings
    fetchRawChannelsMapping();
  }, []);

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
        }),
        [rawChannelMappings, osmosisIBCTokenTraces],
      )}
    >
      {children}
    </IBCParamsContext.Provider>
  );
};

export default IBCParamsProvider;
