import { createContext, useMemo, useState, useEffect } from 'react';

import { RawChannelMapping, IBCDenomTrace } from '@/types/IBCParams';
import osmosisServices from '@/services/Osmosis';

type IBCParamsContextType = {
  rawChannelMappings: RawChannelMapping[];
  osmosisIBCTokenTraces: IBCDenomTrace;
  updateOsmosisDenomTrace: () => Promise<void>
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
    osmosisServices.fetchOsmosisDenomTraces().then((res: IBCDenomTrace) => {
      setOsmosisIBCTokenTraces(res);
    });
  };

  useEffect(() => {
    // fetch and update channel mappings
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
