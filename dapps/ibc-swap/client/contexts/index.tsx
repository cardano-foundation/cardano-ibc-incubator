import { TransferProvider } from './TransferContext';

export const CustomAppProvider = ({
  children,
}: {
  children?: React.ReactNode;
}) => {
  return <TransferProvider>{children}</TransferProvider>;
};
