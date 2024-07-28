import { useChain } from '@cosmos-kit/react';
import { ChainName } from 'cosmos-kit';
import { defaultChainName } from '@/constants';

export const UseCosmosWallet = (providedChainName?: ChainName) => {
  const {
    connect,
    openView,
    status,
    username,
    address,
    message,
    wallet,
    chain: chainInfo,
  } = useChain(providedChainName || defaultChainName);

  return {
    connect,
    openView,
    status,
    username,
    address,
    message,
    wallet,
    chainInfo,
  };
};
