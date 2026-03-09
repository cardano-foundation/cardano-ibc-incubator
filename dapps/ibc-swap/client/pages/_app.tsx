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
import { useEffect, useMemo, useState } from 'react';

import type { AppProps } from 'next/app';
import { ChakraProvider } from '@chakra-ui/react';
import { ChainProvider } from '@cosmos-kit/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { SignerOptions, wallets } from 'cosmos-kit';
import { MeshProvider } from '@meshsdk/react';
import { manrope } from 'styles/font';
import { theme } from 'styles/theme';
import { Layout } from '@/components/common';
import { CustomAppProvider } from '@/contexts';
import { customChainassets, customChains } from '@/configs/customChainInfo';
import { CosmosWalletModal } from '@/components/common/Header/CosmosWalletModal';
import {
  ENTRYPOINT_REST_ENDPOINT,
  ENTRYPOINT_RPC_ENDPOINT,
  LOCAL_OSMOSIS_REST_ENDPOINT,
  LOCAL_OSMOSIS_RPC_ENDPOINT,
} from '@/configs/runtime';

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
const isExtensionWallet = (wallet: any) => {
  // cosmos-kit groups extension and mobile wallets together; keep only the
  // browser-extension variants for this local demo.
  // eslint-disable-next-line no-underscore-dangle
  return wallet?._walletInfo?.mode === 'extension';
};

const extensionWallets = [
  ...wallets.keplr.filter(isExtensionWallet),
  ...wallets.leap.filter(isExtensionWallet),
  ...wallets.cosmostation.filter(isExtensionWallet),
];

const getAvailableCosmosExtensionWallets = () => {
  if (typeof window === 'undefined') {
    return [];
  }

  const browserWallets = window as Window & {
    cosmostation?: unknown;
    getOfflineSigner?: unknown;
    getOfflineSignerOnlyAmino?: unknown;
    keplr?: unknown;
    keplrRequestMetaIdSupport?: unknown;
    leap?: unknown;
  };

  return extensionWallets.filter((wallet: any) => {
    // eslint-disable-next-line no-underscore-dangle
    const walletName = wallet?._walletInfo?.name;

    switch (walletName) {
      case 'keplr-extension':
        return Boolean(
          browserWallets.keplr ||
            browserWallets.keplrRequestMetaIdSupport ||
            browserWallets.getOfflineSigner ||
            browserWallets.getOfflineSignerOnlyAmino,
        );
      case 'leap-extension':
        return Boolean(browserWallets.leap);
      case 'cosmostation-extension':
        return Boolean(browserWallets.cosmostation);
      default:
        return false;
    }
  });
};

const uniqueExtensionWallets = (walletList: any[]) =>
  walletList.filter(
    (wallet, index, allWallets) =>
      allWallets.findIndex(
        (candidate) =>
          // eslint-disable-next-line no-underscore-dangle
          candidate?._walletInfo?.name ===
          // eslint-disable-next-line no-underscore-dangle
          wallet?._walletInfo?.name,
      ) === index,
  );

const getGasPrice = (chainId: string): string => {
  const chainFound = customChains.find((i) => i.chain_id === chainId);
  const fee = chainFound?.fees?.fee_tokens?.[0] || {
    denom: 'stake',
    fixed_min_gas_price: 0.0025,
  };
  return `${fee?.fixed_min_gas_price}${fee?.denom}`;
};

const endpointOptions = {
  endpoints: {
    entrypoint: {
      isLazy: true,
      rpc: [ENTRYPOINT_RPC_ENDPOINT],
      rest: [ENTRYPOINT_REST_ENDPOINT],
    },
    localosmosis: {
      isLazy: true,
      rpc: [LOCAL_OSMOSIS_RPC_ENDPOINT],
      rest: [LOCAL_OSMOSIS_REST_ENDPOINT],
    },
  },
};

function MyApp({ Component, pageProps }: AppProps) {
  const [availableCosmosWallets, setAvailableCosmosWallets] = useState<any[]>(
    [],
  );
  const [cosmosWalletsReady, setCosmosWalletsReady] = useState(false);

  const signerOptions = {
    signingStargate: (chain: any) => {
      const chainId = typeof chain === 'string' ? chain : chain?.chain_id;
      return {
        registry,
        aminoTypes,
        gasPrice: getGasPrice(chainId),
      } as any;
    },
  } as SignerOptions;

  useEffect(() => {
    const syncWallets = () => {
      const detectedWallets = getAvailableCosmosExtensionWallets();
      setAvailableCosmosWallets(uniqueExtensionWallets(detectedWallets));
      return detectedWallets.length > 0;
    };

    if (syncWallets()) {
      setCosmosWalletsReady(true);
      return undefined;
    }

    let attempts = 0;
    const maxAttempts = 40;
    const interval = window.setInterval(() => {
      attempts += 1;

      if (syncWallets() || attempts >= maxAttempts) {
        window.clearInterval(interval);
        setCosmosWalletsReady(true);
      }
    }, 100);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const cosmosWalletProviderKey = useMemo(() => {
    const walletNames = availableCosmosWallets
      .map(
        (wallet) =>
          // eslint-disable-next-line no-underscore-dangle
          wallet?._walletInfo?.name || wallet?.walletName || 'unknown-wallet',
      )
      .sort();

    return `${cosmosWalletsReady ? 'ready' : 'pending'}:${walletNames.join(
      ',',
    )}`;
  }, [availableCosmosWallets, cosmosWalletsReady]);

  return (
    <ChakraProvider theme={theme}>
      {cosmosWalletsReady ? (
        <ChainProvider
          key={cosmosWalletProviderKey}
          chains={customChains as any}
          assetLists={customChainassets as any}
          wallets={availableCosmosWallets}
          signerOptions={signerOptions}
          endpointOptions={endpointOptions}
          walletModal={CosmosWalletModal}
        >
          <QueryClientProvider client={queryClient}>
            <MeshProvider>
              <Layout>
                <main id="main" className={manrope.className}>
                  <CustomAppProvider>
                    <Component {...pageProps} />
                    <ToastContainer />
                  </CustomAppProvider>
                </main>
              </Layout>
            </MeshProvider>
          </QueryClientProvider>
        </ChainProvider>
      ) : null}
    </ChakraProvider>
  );
}

export default MyApp;
