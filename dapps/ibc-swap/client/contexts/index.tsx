import { TransferProvider } from './TransferContext';
import { IBCParamsProvider } from './IBCParamsContext';
import { SwapProvider } from './SwapContext';

export const CustomAppProvider = ({
  children,
}: {
  children?: React.ReactNode;
}) => {
  return (
    <IBCParamsProvider>
      <SwapProvider>
        <TransferProvider>{children}</TransferProvider>
      </SwapProvider>
    </IBCParamsProvider>
  );
};
