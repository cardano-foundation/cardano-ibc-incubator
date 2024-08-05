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
  switchNetwork: () => void;
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

  const switchNetwork = () => {
    if (!fromNetwork?.networkId && !toNetwork?.networkId) return;
    const tempFromNetwork = fromNetwork;
    const tempToNetwork = toNetwork;
    setFromNetwork(tempToNetwork);
    setToNetwork(tempFromNetwork);
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
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [fromNetwork, toNetwork, selectedToken],
      )}
    >
      {children}
    </TransferContext.Provider>
  );
};

export default TransferContext;
