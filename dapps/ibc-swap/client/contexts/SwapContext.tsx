'use client';
import { SwapDataType } from '@/types/SwapDataType';
import { useAddress } from '@meshsdk/react';
import {
  createContext,
  Dispatch,
  SetStateAction,
  useEffect,
  useMemo,
  useState,
} from 'react';

type SwapContextType = {
  swapData: SwapDataType;
  setSwapData: Dispatch<SetStateAction<SwapDataType>>;
  handleResetData: () => void;
  getSwapData: () => SwapDataType;
  handleSwitchToken: () => void;
};

const SwapContext = createContext<SwapContextType>({} as SwapContextType);

const initSwapData = { receiveAdrress: '', slippageTolerance: '20.0' };

export const SwapProvider = ({ children }: { children?: React.ReactNode }) => {
  const cardanoAddress = useAddress();
  const [swapData, setSwapData] = useState<SwapDataType>(
    initSwapData as SwapDataType,
  );

  const getSwapData = () => {
    return swapData;
  };

  const handleResetData = () => {
    setSwapData(initSwapData as SwapDataType);
  };

  const handleSwitchToken = () => {
    setSwapData({
      ...swapData,
      fromToken: swapData.toToken,
      toToken: swapData.fromToken,
    });
  };

  useEffect(() => {
    if (cardanoAddress) {
      setSwapData((prev) => ({ ...swapData, receiveAdrress: cardanoAddress }));
    }
  }, [cardanoAddress]);

  return (
    <SwapContext.Provider
      value={useMemo(
        () => ({
          swapData,
          setSwapData,
          handleResetData,
          getSwapData,
          handleSwitchToken,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [JSON.stringify(swapData)],
      )}
    >
      {children}
    </SwapContext.Provider>
  );
};

export default SwapContext;
