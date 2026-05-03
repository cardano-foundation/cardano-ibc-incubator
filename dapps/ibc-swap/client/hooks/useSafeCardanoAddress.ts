'use client';

import { useContext, useEffect, useState } from 'react';
import { WalletContext } from '@meshsdk/react';
import { toast } from 'react-toastify';
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

    const startedAt = Date.now();
    logCardanoWalletDebug('address:getUsedAddresses:start', {
      walletName: connectedWalletName,
      accountId,
      hasWalletInstance: Boolean(connectedWalletInstance),
    });

    connectedWalletInstance
      .getUsedAddresses()
      .then((addresses) => {
        if (!cancelled) {
          logCardanoWalletDebug('address:getUsedAddresses:success', {
            walletName: connectedWalletName,
            elapsedMs: Date.now() - startedAt,
            addressCount: addresses.length,
            selectedAddress: shortValue(addresses[accountId]),
          });
          setAddress(addresses[accountId]);
        }
      })
      .catch((error) => {
        if (cancelled) return;

        logCardanoWalletError('address:getUsedAddresses:error', error, {
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

        setAddress(undefined);
      });

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
