import '@interchain-ui/react/globalStyles';
import '@interchain-ui/react/styles';

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
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { getSigningCosmosClientOptions } from 'interchain';
import { SignerOptions, wallets } from 'cosmos-kit';
import { Chain } from '@chain-registry/types';
import { MeshProvider } from '@meshsdk/react';
import { manrope } from 'styles/font';
import { theme } from 'styles/theme';
import { Layout } from '@/components/common';
import { CustomAppProvider } from '@/contexts';
import { customChainassets, customChains } from '@/configs/customChainInfo';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

function MyApp({ Component, pageProps }: AppProps) {
  const signerOptions: SignerOptions = {
    // @ts-ignore
    signingStargate: (_chain: Chain) => {
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
      const signing = getSigningCosmosClientOptions();
      if (_chain.chain_id === 'sidechain') {
        return { ...signing, registry, aminoTypes, gasPrice: '0.001stake' };
      }
      return { ...signing, registry, aminoTypes };
    },
  };

  return (
    <ChakraProvider theme={theme}>
      <ChainProvider
        chains={customChains}
        assetLists={customChainassets}
        wallets={[...wallets.keplr]}
        signerOptions={signerOptions}
      >
        <QueryClientProvider client={queryClient}>
          <MeshProvider>
            <Layout>
              <main id="main" className={manrope.className}>
                <CustomAppProvider>
                  <Component {...pageProps} />
                </CustomAppProvider>
              </main>
            </Layout>
          </MeshProvider>
        </QueryClientProvider>
      </ChainProvider>
    </ChakraProvider>
  );
}

export default MyApp;
