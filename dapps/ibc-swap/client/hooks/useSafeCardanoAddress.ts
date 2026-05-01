'use client';

import { useContext, useEffect, useState } from 'react';
import { WalletContext } from '@meshsdk/react';
import { toast } from 'react-toastify';
import {
  CARDANO_WALLET_LOCKED_MESSAGE,
  CARDANO_WALLET_LOCKED_TOAST_ID,
  isCardanoWalletLockedError,
} from '@/utils/cardanoWalletStatus';

export const useSafeCardanoAddress = (accountId = 0) => {
  const [address, setAddress] = useState<string>();
  const { hasConnectedWallet, connectedWalletName, connectedWalletInstance } =
    useContext(WalletContext);

  useEffect(() => {
    let cancelled = false;

    if (!hasConnectedWallet) {
      setAddress(undefined);
      return undefined;
    }

    connectedWalletInstance
      .getUsedAddresses()
      .then((addresses) => {
        if (!cancelled) {
          setAddress(addresses[accountId]);
        }
      })
      .catch((error) => {
        if (cancelled) return;

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
