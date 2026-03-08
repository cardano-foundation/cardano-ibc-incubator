import { useChain, useWalletClient } from '@cosmos-kit/react';
import { ChainName } from 'cosmos-kit';
import { defaultChainName } from '@/constants';
import { customChainassets, customChains } from '@/configs/customChainInfo';
import { useCallback, useEffect } from 'react';

export const UseCosmosWallet = (providedChainName?: ChainName) => {
  const {
    connect,
    disconnect,
    openView,
    status,
    username,
    address,
    message,
    wallet,
    chain: chainInfo,
  } = useChain(providedChainName || defaultChainName);

  const { client } = useWalletClient(wallet?.name);

  const addCustomChainWalet = useCallback(async () => {
    const suggestChains = customChains.map((chain) => {
      const assetList = customChainassets.find(
        (chainAsset) => chainAsset.chain_name === chain.chain_name,
      );
      return {
        chain,
        name: chain.chain_name,
        assetList,
      };
    });
    try {
      await Promise.all(
        suggestChains.map((chain) => client?.addChain?.(chain as any)),
      );
    } catch {
      // Some wallet clients do not support custom chain suggestion.
    }
  }, [client]);

  useEffect(() => {
    if (client && status === 'Connected') {
      addCustomChainWalet();
    }
  }, [addCustomChainWalet, client, status]);

  return {
    connect,
    openView,
    status,
    username,
    address,
    message,
    wallet,
    disconnect,
    chainInfo,
  };
};
