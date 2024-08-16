import {
  createContext,
  Dispatch,
  SetStateAction,
  useMemo,
  useState,
} from 'react';

import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import { TransferTokenItemProps } from '@/components/TransferTokenItem/TransferTokenItem';

type TransferContextType = {
  fromNetwork: NetworkItemProps;
  setFromNetwork: Dispatch<SetStateAction<object>>;
  toNetwork: NetworkItemProps;
  setToNetwork: Dispatch<SetStateAction<object>>;
  selectedToken: TransferTokenItemProps;
  setSelectedToken: Dispatch<SetStateAction<object>>;
  sendAmount: string;
  setSendAmount: Dispatch<SetStateAction<string>>;
  destinationAddress: string;
  setDestinationAddress: Dispatch<SetStateAction<string>>;
  switchNetwork: () => void;
  getDataTransfer: () => {
    fromNetwork: NetworkItemProps;
    toNetwork: NetworkItemProps;
    selectedToken: TransferTokenItemProps;
    sendAmount: string;
    destinationAddress: string;
  };
  handleReset: () => void;
  isLoading: boolean;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  isProcessingTransfer: boolean;
  setIsProcessingTransfer: Dispatch<SetStateAction<boolean>>;
};

const TransferContext = createContext<TransferContextType>(
  {} as TransferContextType,
);

export const TransferProvider = ({
  children,
}: {
  children?: React.ReactNode;
}) => {
  const [fromNetwork, setFromNetwork] = useState<NetworkItemProps>({});
  const [toNetwork, setToNetwork] = useState<NetworkItemProps>({});
  const [selectedToken, setSelectedToken] = useState<TransferTokenItemProps>(
    {},
  );
  const [sendAmount, setSendAmount] = useState<string>('');
  const [destinationAddress, setDestinationAddress] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isProcessingTransfer, setIsProcessingTransfer] =
    useState<boolean>(false);

  const switchNetwork = () => {
    if (!fromNetwork?.networkId && !toNetwork?.networkId) return;
    const tempFromNetwork = fromNetwork;
    const tempToNetwork = toNetwork;
    setFromNetwork(tempToNetwork);
    setToNetwork(tempFromNetwork);
  };

  const getDataTransfer = () => {
    return {
      fromNetwork,
      toNetwork,
      selectedToken,
      sendAmount,
      destinationAddress,
    };
  };

  const handleReset = () => {
    setFromNetwork({});
    setToNetwork({});
    setSelectedToken({});
    setSendAmount('');
    setDestinationAddress('');
    setIsLoading(false);
    setIsProcessingTransfer(false);
  };

  return (
    <TransferContext.Provider
      value={useMemo(
        () => ({
          fromNetwork,
          setFromNetwork,
          toNetwork,
          setToNetwork,
          selectedToken,
          setSelectedToken,
          switchNetwork,
          sendAmount,
          setSendAmount,
          destinationAddress,
          setDestinationAddress,
          getDataTransfer,
          handleReset,
          isLoading,
          setIsLoading,
          isProcessingTransfer,
          setIsProcessingTransfer,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [
          fromNetwork,
          toNetwork,
          selectedToken,
          sendAmount,
          destinationAddress,
          isLoading,
          isProcessingTransfer,
        ],
      )}
    >
      {children}
    </TransferContext.Provider>
  );
};

export default TransferContext;
