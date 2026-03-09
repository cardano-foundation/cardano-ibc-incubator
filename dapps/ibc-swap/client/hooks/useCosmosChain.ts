/* eslint-disable consistent-return */
import { cosmosChainsSupported, defaultChainName } from '@/constants';
import { useChain } from '@cosmos-kit/react';
import { Coin } from 'cosmjs-types/cosmos/base/v1beta1/coin';
import { cosmos } from 'interchain';
import { useCallback, useMemo } from 'react';

export const useCosmosChain = (chainName: string) => {
  // handle chainName if not supported
  let useChainName = chainName;
  if (!cosmosChainsSupported.includes(chainName)) {
    useChainName = defaultChainName;
  }
  const cosmosChain = useChain(useChainName, true);
  const { address, getRpcEndpoint } = cosmosChain;

  const getAllBalances = useCallback(async () => {
    const rpcEndpoint = (await getRpcEndpoint()) as string;

    if (!rpcEndpoint || !address) {
      return;
    }
    const client = await cosmos.ClientFactory.createRPCQueryClient({
      rpcEndpoint,
    });
    if (!client) {
      return;
    }
    try {
      const allBalances = await client.cosmos.bank.v1beta1.allBalances({
        address,
      });
      return allBalances.balances as Coin[];
    } catch {
      return [];
    }
  }, [address, getRpcEndpoint]);

  const getBalanceByDenom = useCallback(async ({
    denom,
  }: {
    denom: string;
  }): Promise<string> => {
    const rpcEndpoint = (await getRpcEndpoint()) as string;

    if (!rpcEndpoint || !address) {
      return '0';
    }
    const client = await cosmos.ClientFactory.createRPCQueryClient({
      rpcEndpoint,
    });
    if (!client) {
      return '0';
    }
    try {
      const balance = await client.cosmos.bank.v1beta1.balance({
        address,
        denom,
      });
      // eslint-disable-next-line consistent-return
      return balance.balance?.amount || '0';
    } catch {
      return '0';
    }
  }, [address, getRpcEndpoint]);

  const getTotalSupply = useCallback(async (): Promise<Coin[] | undefined> => {
    const rpcEndpoint = (await getRpcEndpoint()) as string;

    if (!rpcEndpoint || !address) {
      return;
    }
    const client = await cosmos.ClientFactory.createRPCQueryClient({
      rpcEndpoint,
    });
    if (!client) {
      return;
    }
    try {
      const totalSupply = await client.cosmos.bank.v1beta1.totalSupply();
      return totalSupply.supply as Coin[];
    } catch {
      return [];
    }
  }, [address, getRpcEndpoint]);

  return useMemo(
    () => ({
      ...cosmosChain,
      getAllBalances,
      getTotalSupply,
      getBalanceByDenom,
    }),
    [cosmosChain, getAllBalances, getBalanceByDenom, getTotalSupply],
  );
};
