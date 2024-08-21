import { createContext } from 'react';

interface NetworkSelected {
  networkId: number;
  networkName?: string;
  networkLogo?: string;
  isActive?: boolean;
  onClick?: () => void;
}

interface AppContextProps {
  networkSelected: NetworkSelected | null;
  // eslint-disable-next-line no-unused-vars
  setNetworkSelected: (network: string | null) => void;
}

// Tạo context với giá trị ban đầu là undefined
const AppContext = createContext<AppContextProps | undefined>(undefined);

export default AppContext;
