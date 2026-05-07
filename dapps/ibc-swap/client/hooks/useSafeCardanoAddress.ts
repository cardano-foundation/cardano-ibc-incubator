'use client';

import { useContext, useEffect, useState } from 'react';
import { WalletContext } from '@meshsdk/react';
import { toast } from 'react-toastify';
import { CARDANO_CHAIN_ID, MAINNET_CARDANO_CHAIN_ID } from '@/configs/runtime';
import {
  CARDANO_WALLET_LOCKED_MESSAGE,
  CARDANO_WALLET_LOCKED_TOAST_ID,
  isCardanoWalletLockedError,
} from '@/utils/cardanoWalletStatus';
import {
  logCardanoWalletDebug,
  logCardanoWalletError,
  shortValue,
} from '@/utils/cardanoWalletDebug';

type CardanoWalletInstance = {
  getNetworkId?: () => Promise<number> | number;
  getChangeAddress?: () => Promise<string> | string;
  getUsedAddresses?: () => Promise<string[]>;
};

const CARDANO_NETWORK_MISMATCH_TOAST_ID = 'cardano-wallet-network-mismatch';
const EXPECTED_CARDANO_NETWORK_ID =
  CARDANO_CHAIN_ID === MAINNET_CARDANO_CHAIN_ID ? 1 : 0;

const getCardanoNetworkLabel = (networkId: number): string =>
  networkId === 1 ? 'mainnet' : 'testnet';

async function requireExpectedCardanoNetwork(
  wallet: CardanoWalletInstance,
): Promise<number> {
  if (typeof wallet.getNetworkId !== 'function') {
    throw new Error(
      'Connected Cardano wallet does not expose CIP-30 getNetworkId().',
    );
  }

  const networkId = await wallet.getNetworkId();
  if (networkId !== EXPECTED_CARDANO_NETWORK_ID) {
    throw new Error(
      `Connected Cardano wallet is on ${getCardanoNetworkLabel(
        networkId,
      )}, but this app is configured for ${getCardanoNetworkLabel(
        EXPECTED_CARDANO_NETWORK_ID,
      )}.`,
    );
  }

  return networkId;
}

async function getActiveCardanoAddress(
  wallet: CardanoWalletInstance,
  accountId: number,
): Promise<{ address: string; addressSource: 'change' | 'used' }> {
  if (typeof wallet.getChangeAddress === 'function') {
    const changeAddress = await wallet.getChangeAddress();
    if (typeof changeAddress === 'string' && changeAddress.trim()) {
      return { address: changeAddress, addressSource: 'change' };
    }
  }

  if (typeof wallet.getUsedAddresses !== 'function') {
    throw new Error(
      'Connected Cardano wallet does not expose getUsedAddresses().',
    );
  }

  const usedAddresses = await wallet.getUsedAddresses();
  const fallbackAddress = usedAddresses[accountId] ?? usedAddresses[0];
  if (!fallbackAddress) {
    throw new Error('Connected Cardano wallet has no available address.');
  }

  return { address: fallbackAddress, addressSource: 'used' };
}

export const useSafeCardanoAddress = (accountId = 0) => {
  const [address, setAddress] = useState<string>();
  const { hasConnectedWallet, connectedWalletName, connectedWalletInstance } =
    useContext(WalletContext);

  useEffect(() => {
    let cancelled = false;

    if (!hasConnectedWallet) {
      logCardanoWalletDebug('address:clear:not-connected', {
        walletName: connectedWalletName,
      });
      setAddress(undefined);
      return undefined;
    }

    const wallet = connectedWalletInstance as CardanoWalletInstance | undefined;
    if (!wallet) {
      logCardanoWalletDebug('address:clear:missing-wallet-instance', {
        walletName: connectedWalletName,
      });
      setAddress(undefined);
      return undefined;
    }

    const startedAt = Date.now();
    logCardanoWalletDebug('address:resolve:start', {
      walletName: connectedWalletName,
      accountId,
      hasWalletInstance: Boolean(connectedWalletInstance),
    });

    const resolveAddress = async () => {
      try {
        const networkId = await requireExpectedCardanoNetwork(wallet);
        const { address: nextAddress, addressSource } =
          await getActiveCardanoAddress(wallet, accountId);

        if (!cancelled) {
          logCardanoWalletDebug('address:resolve:success', {
            walletName: connectedWalletName,
            elapsedMs: Date.now() - startedAt,
            networkId,
            addressSource,
            selectedAddress: shortValue(nextAddress),
          });
          setAddress(nextAddress);
        }
      } catch (error) {
        if (cancelled) return;

        logCardanoWalletError('address:resolve:error', error, {
          walletName: connectedWalletName,
          elapsedMs: Date.now() - startedAt,
        });

        if (isCardanoWalletLockedError(error)) {
          toast.error(CARDANO_WALLET_LOCKED_MESSAGE, {
            theme: 'colored',
            toastId: CARDANO_WALLET_LOCKED_TOAST_ID,
          });
          return;
        }

        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : 'Unable to resolve a Cardano wallet address.';
        if (message.includes('this app is configured for')) {
          toast.error(message, {
            theme: 'colored',
            toastId: CARDANO_NETWORK_MISMATCH_TOAST_ID,
          });
        }

        setAddress(undefined);
      }
    };

    resolveAddress();

    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    connectedWalletInstance,
    connectedWalletName,
    hasConnectedWallet,
  ]);

  return address;
};
