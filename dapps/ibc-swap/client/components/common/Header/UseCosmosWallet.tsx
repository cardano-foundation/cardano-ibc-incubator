import { useChain, useWalletClient } from '@cosmos-kit/react';
import { ChainName } from 'cosmos-kit';
import { defaultChainName } from '@/constants';
import { customChainassets, customChains } from '@/configs/customChainInfo';
import { useEffect } from 'react';

export const UseCosmosWallet = (providedChainName?: ChainName) => {
  const {
    connect,
    openView,
    status,
    username,
    address,
    message,
    wallet,
    disconnect,
    chain: chainInfo,
  } = useChain(providedChainName || defaultChainName);

  const { client } = useWalletClient(wallet?.name);

  const addCustomChainWalet = async () => {
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
    // eslint-disable-next-line no-restricted-syntax
    for (const chain of suggestChains) {
      // eslint-disable-next-line no-await-in-loop
      await client?.addChain?.(chain);
    }
  };

  useEffect(() => {
    if (client && status === 'Connected') {
      addCustomChainWalet();
    }
  }, [status]);

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
