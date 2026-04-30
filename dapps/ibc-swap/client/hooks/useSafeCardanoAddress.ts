'use client';

import { useContext, useEffect, useState } from 'react';
import { useWallet, WalletContext } from '@meshsdk/react';
import { toast } from 'react-toastify';
import {
  CARDANO_WALLET_LOCKED_MESSAGE,
  CARDANO_WALLET_LOCKED_TOAST_ID,
  forgetStoredCardanoWallet,
  isCardanoWalletLockedError,
} from '@/utils/cardanoWalletStatus';

export const useSafeCardanoAddress = (accountId = 0) => {
  const [address, setAddress] = useState<string>();
  const { hasConnectedWallet, connectedWalletName, connectedWalletInstance } =
    useContext(WalletContext);
  const { disconnect: disconnectCardanoWallet } = useWallet();

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

        setAddress(undefined);
        if (isCardanoWalletLockedError(error)) {
          forgetStoredCardanoWallet();
          disconnectCardanoWallet();
          toast.error(CARDANO_WALLET_LOCKED_MESSAGE, {
            theme: 'colored',
            toastId: CARDANO_WALLET_LOCKED_TOAST_ID,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    connectedWalletInstance,
    connectedWalletName,
    disconnectCardanoWallet,
    hasConnectedWallet,
  ]);

  return address;
};
