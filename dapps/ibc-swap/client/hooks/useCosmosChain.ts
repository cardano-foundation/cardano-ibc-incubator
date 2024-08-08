import { cosmosChainsSupported, defaultChainName } from '@/constants';
import { useChain } from '@cosmos-kit/react';
import { Coin } from 'cosmjs-types/cosmos/base/v1beta1/coin';
import { cosmos } from 'interchain';

export const useCosmosChain = (chainName: string) => {
  //handle chainName if not supported
  let _chainName = chainName;
  if (!cosmosChainsSupported.includes(chainName)) {
    _chainName = defaultChainName;
  }
  const { address, getRpcEndpoint } = useChain(_chainName);

  const getAllBalances = async () => {
    const rpcEndpoint = (await getRpcEndpoint()) as string;
    console.log(rpcEndpoint);
    if (!rpcEndpoint || !address) {
      return;
    }
    const client = await cosmos.ClientFactory.createRPCQueryClient({
      rpcEndpoint,
    });
    if (!client) {
      return;
    }
    const allBalances = await client.cosmos.bank.v1beta1.allBalances({
      address,
    });
    return allBalances.balances as Coin[];
  };

  return {
    getAllBalances,
  };
};
