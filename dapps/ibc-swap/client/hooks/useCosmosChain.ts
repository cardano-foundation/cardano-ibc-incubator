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
    const allBalances = await client.cosmos.bank.v1beta1.allBalances({
      address,
    });
    // eslint-disable-next-line consistent-return
    return allBalances.balances as Coin[];
  };

  return {
    ...cosmosChain,
    getAllBalances,
  };
};
