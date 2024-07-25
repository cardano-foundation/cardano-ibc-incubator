import '@interchain-ui/react/globalStyles';
import '@interchain-ui/react/styles';

import type { AppProps } from 'next/app';
import { ChakraProvider } from '@chakra-ui/react';
import { ChainProvider } from '@cosmos-kit/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { getSigningCosmosClientOptions } from 'interchain';
import { assets, chains } from 'chain-registry';
import { SignerOptions, wallets } from 'cosmos-kit';
import { Chain } from '@chain-registry/types';
import { MeshProvider } from '@meshsdk/react';
import { manrope } from 'styles/font';
import { theme } from 'styles/theme';
import { Layout } from '@/components/common';

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
      return getSigningCosmosClientOptions();
    },
  };

  return (
    <ChakraProvider theme={theme}>
      <ChainProvider
        chains={chains}
        assetLists={assets}
        wallets={wallets}
        // walletConnectOptions={{
        //   signClient: {
        //     projectId: 'a8510432ebb71e6948cfd6cde54b70f7',
        //     relayUrl: 'wss://relay.walletconnect.org',
        //     metadata: {
        //       name: 'Cosmos Kit dApp',
        //       description: 'Cosmos Kit dApp built by Create Cosmos App',
        //       url: 'https://docs.cosmology.zone/cosmos-kit/',
        //       icons: [],
        //     },
        //   },
        // }}
        signerOptions={signerOptions}
      >
        <QueryClientProvider client={queryClient}>
          <MeshProvider>
            <Layout>
              <main id="main" className={manrope.className}>
                <Component {...pageProps} />
              </main>
            </Layout>
          </MeshProvider>
        </QueryClientProvider>
      </ChainProvider>
    </ChakraProvider>
  );
}

export default MyApp;
