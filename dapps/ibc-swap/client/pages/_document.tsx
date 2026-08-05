import { Head, Html, Main, NextScript } from 'next/document';
import {
  CARDANO_CHAIN_ID,
  CARDANO_NETWORK,
  dappApiPath,
} from '@/configs/runtime';

const runtimeConfigPath = dappApiPath('/api/runtime-config');

export default function Document() {
  return (
    <Html
      lang="en"
      data-cardano-network={CARDANO_NETWORK}
      data-cardano-chain-id={CARDANO_CHAIN_ID}
    >
      <Head>
        {/* This blocking, same-origin script must run before Next hydrates. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src={runtimeConfigPath} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
