import {
  activeRuntimeConfig,
  type RuntimeConfig,
} from '@/configs/runtimeConfig';
import { createContext, useContext, useMemo } from 'react';

const RuntimeConfigContext = createContext<RuntimeConfig>(activeRuntimeConfig);

export const RuntimeConfigProvider = ({
  children,
}: {
  children?: React.ReactNode;
}) => {
  const value = useMemo(() => activeRuntimeConfig, []);

  return (
    <RuntimeConfigContext.Provider value={value}>
      {children}
    </RuntimeConfigContext.Provider>
  );
};

export const useRuntimeConfig = () => useContext(RuntimeConfigContext);
