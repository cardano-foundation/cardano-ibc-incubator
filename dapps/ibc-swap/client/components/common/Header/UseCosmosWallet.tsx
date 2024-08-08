import { useChain, useChains, useWalletClient } from '@cosmos-kit/react';
import { ChainName } from 'cosmos-kit';
import { defaultChainName } from '@/constants';
import { customChainassets, customChains } from '@/configs/customChainInfo';
import { useEffect } from 'react';

export const UseCosmosWallet = (providedChainName?: ChainName) => {
  const chains = useChains(customChains.map(i => i.chain_id));

  const {
    openView,
    status,
    username,
    address,
    message,
    wallet,
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
    try {
      await Promise.all(
        suggestChains.map((chain) => client?.addChain?.(chain)),
      );
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    if (client && status === 'Connected') {
      addCustomChainWalet();
    }
  }, [status]);

  return {
    connect: chains.sidechain.connect,
    openView,
    status,
    username,
    address,
    message,
    wallet,
    disconnect: chains.sidechain.disconnect,
    chainInfo,
  };
};
