/* eslint-disable no-console */
/* eslint-disable consistent-return */
import { cosmosChainsSupported, defaultChainName } from '@/constants';
import { useChain } from '@cosmos-kit/react';
import { Coin } from 'cosmjs-types/cosmos/base/v1beta1/coin';
import { cosmos } from 'interchain';

export const useCosmosChain = (chainName: string) => {
  // handle chainName if not supported
  let useChainName = chainName;
  if (!cosmosChainsSupported.includes(chainName)) {
    useChainName = defaultChainName;
  }
  const cosmosChain = useChain(useChainName, true);
  const { address, getRpcEndpoint } = cosmosChain;

  const getAllBalances = async () => {
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
      // eslint-disable-next-line consistent-return
      return allBalances.balances as Coin[];
    } catch (error) {
      console.log({ error });
    }
  };

  const getBalanceByDenom = async ({
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
    } catch (error) {
      console.log({ error });
      return '0';
    }
  };

  const getTotalSupply = async (): Promise<Coin[] | undefined> => {
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
    } catch (error) {
      console.log({ error });
    }
  };

  return {
    ...cosmosChain,
    getAllBalances,
    getTotalSupply,
    getBalanceByDenom,
  };
};
