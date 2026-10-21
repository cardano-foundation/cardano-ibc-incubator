import { createContext, useMemo, useState, useEffect } from 'react';
import { fetchPacketForwardFee } from '@/services/CommonCosmosServices';
import BigNumber from 'bignumber.js';
import { DEFAULT_PFM_FEE, OSMOSIS_CHAIN_ID } from '@/constants';
import { chainsRestEndpoints } from '@/configs/customChainInfo';

type IBCParamsContextType = {
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
  const [pfmFees, setPfmFees] = useState<{ [key: string]: BigNumber }>({});

  const getPfmFee = (chainId: string): BigNumber => {
    return pfmFees[chainId] ?? BigNumber(DEFAULT_PFM_FEE);
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

  return (
    <IBCParamsContext.Provider
      value={useMemo(
        () => ({
          getPfmFee,
        }),
        [getPfmFee],
      )}
    >
      {children}
    </IBCParamsContext.Provider>
  );
};

export default IBCParamsContext;
