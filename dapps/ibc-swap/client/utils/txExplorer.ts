import {
  CARDANO_CHAIN_ID,
  CARDANO_IBC_CHAIN_ID,
  MAINNET_CARDANO_CHAIN_ID,
  PREPROD_CARDANO_CHAIN_ID,
} from '@/configs/runtime';
import {
  ENTRYPOINT_CHAIN_ID,
  findRuntimeChain,
  INJECTIVE_MAINNET_CHAIN_ID,
  INJECTIVE_TESTNET_CHAIN_ID,
} from '@/configs/runtimeConfig';

export const getCardanoExplorerTxUrl = (txHash: string): string | undefined => {
  if (!txHash) return undefined;
  if (CARDANO_CHAIN_ID === PREPROD_CARDANO_CHAIN_ID) {
    return `https://preprod.cexplorer.io/tx/${txHash}`;
  }
  if (CARDANO_CHAIN_ID === MAINNET_CARDANO_CHAIN_ID) {
    return `https://cexplorer.io/tx/${txHash}`;
  }
  return undefined;
};

export const getExplorerTxUrl = (
  chainId: string | undefined,
  txHash: string,
): string | undefined => {
  if (!chainId || !txHash) return undefined;
  if (chainId === CARDANO_CHAIN_ID || chainId === CARDANO_IBC_CHAIN_ID) {
    return getCardanoExplorerTxUrl(txHash);
  }
  if (chainId === INJECTIVE_TESTNET_CHAIN_ID) {
    return `https://testnet.explorer.injective.network/transaction/${txHash}/`;
  }
  if (chainId === INJECTIVE_MAINNET_CHAIN_ID) {
    return `https://explorer.injective.network/transaction/${txHash}/`;
  }

  // The local entrypoint chain has no public block explorer; link to REST tx JSON.
  if (chainId === ENTRYPOINT_CHAIN_ID) {
    const restEndpoint = findRuntimeChain(chainId)?.restEndpoint;
    return restEndpoint
      ? `${restEndpoint.replace(/\/$/, '')}/cosmos/tx/v1beta1/txs/${txHash}`
      : undefined;
  }

  const restEndpoint = findRuntimeChain(chainId)?.restEndpoint;
  if (restEndpoint) {
    return `${restEndpoint.replace(/\/$/, '')}/cosmos/tx/v1beta1/txs/${txHash}`;
  }

  return undefined;
};
