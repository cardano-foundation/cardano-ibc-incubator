'use client';
import { SwapDataType } from '@/types/SwapDataType';
import {
  createContext,
  Dispatch,
  SetStateAction,
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

export const SwapProvider = ({ children }: { children?: React.ReactNode }) => {
  const [swapData, setSwapData] = useState<SwapDataType>({
    receiveAdrress: '',
    slippageTolerance: '1.0',
  } as SwapDataType);

  const getSwapData = () => {
    return swapData;
  };

  const handleResetData = () => {
    setSwapData({} as SwapDataType);
  };

  const handleSwitchToken = () => {
    setSwapData({
      ...swapData,
      fromToken: swapData.toToken,
      toToken: swapData.fromToken,
    });
  };

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
