import { TransferProvider } from './TransferContext';
import { IBCParamsProvider } from './IBCParamsContext';

export const CustomAppProvider = ({
  children,
}: {
  children?: React.ReactNode;
}) => {
  return (
    <IBCParamsProvider>
      <TransferProvider>{children}</TransferProvider>
    </IBCParamsProvider>
  );
};
