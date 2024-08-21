import '@interchain-ui/react/globalStyles';
import '@interchain-ui/react/styles';

import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { GeneratedType, Registry } from '@cosmjs/proto-signing';
import { AminoTypes } from '@cosmjs/stargate';
import {
  cosmosAminoConverters,
  cosmosProtoRegistry,
  cosmwasmAminoConverters,
  cosmwasmProtoRegistry,
  ibcProtoRegistry,
  ibcAminoConverters,
  osmosisAminoConverters,
  osmosisProtoRegistry,
} from 'osmojs';

import type { AppProps } from 'next/app';
import { ChakraProvider } from '@chakra-ui/react';
import { ChainProvider } from '@cosmos-kit/react';
import { ApolloProvider } from '@apollo/client';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { SignerOptions, wallets } from 'cosmos-kit';
import { Chain } from '@chain-registry/types';
import { MeshProvider } from '@meshsdk/react';
import { manrope } from 'styles/font';
import { theme } from 'styles/theme';
import { Layout } from '@/components/common';
import { CustomAppProvider } from '@/contexts';
import { customChainassets, customChains } from '@/configs/customChainInfo';
import { CosmosWalletModal } from '@/components/common/Header/CosmosWalletModal';
import apolloClient from '../apis/apollo/apolloClient';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

const protoRegistry: ReadonlyArray<[string, GeneratedType]> = [
  ...cosmosProtoRegistry,
  ...cosmwasmProtoRegistry,
  ...ibcProtoRegistry,
  ...osmosisProtoRegistry,
];

const aminoConverters = {
  ...cosmosAminoConverters,
  ...cosmwasmAminoConverters,
  ...ibcAminoConverters,
  ...osmosisAminoConverters,
};
const registry = new Registry(protoRegistry);
const aminoTypes = new AminoTypes(aminoConverters);

const getGasPrice = (chainId: string): string => {
  const chainFound = customChains.find((i) => i.chain_id === chainId);
  const fee = chainFound?.fees?.fee_tokens?.[0] || {
    denom: 'stake',
    fixed_min_gas_price: 0.0025,
  };
  return `${fee?.fixed_min_gas_price}${fee?.denom}`;
};
function MyApp({ Component, pageProps }: AppProps) {
  const signerOptions: SignerOptions = {
    // @ts-ignore
    signingStargate: (_chain: Chain) => {
      return { registry, aminoTypes, gasPrice: getGasPrice(_chain?.chain_id) };
    },
  };

  return (
    <ChakraProvider theme={theme}>
      <ChainProvider
        chains={customChains}
        assetLists={customChainassets}
        wallets={[...wallets.keplr]}
        signerOptions={signerOptions}
        walletModal={CosmosWalletModal}
      >
        <QueryClientProvider client={queryClient}>
          <MeshProvider>
            <ApolloProvider client={apolloClient}>
              <Layout>
                <main id="main" className={manrope.className}>
                  <CustomAppProvider>
                    <Component {...pageProps} />
                    <ToastContainer />
                  </CustomAppProvider>
                </main>
              </Layout>
            </ApolloProvider>
          </MeshProvider>
        </QueryClientProvider>
      </ChainProvider>
    </ChakraProvider>
  );
}

export default MyApp;
