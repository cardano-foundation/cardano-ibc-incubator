'use client';

/* global BigInt */

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { lookupCardanoAssetDenomTrace } from '@/apis/restapi/cardano';
import {
  resolveCardanoWalletAssets,
  type PresentedCardanoAsset,
} from '@/utils/cardanoAssetPresentation';
import { useWallet, WalletContext } from '@meshsdk/react';
import { toast } from 'react-toastify';
import { useSafeCardanoAddress } from '@/hooks/useSafeCardanoAddress';
import {
  CARDANO_WALLET_LOCKED_MESSAGE,
  CARDANO_WALLET_LOCKED_TOAST_ID,
  forgetStoredCardanoWallet,
  isCardanoWalletLockedError,
} from '@/utils/cardanoWalletStatus';
import { logCardanoWalletDebug } from '@/utils/cardanoWalletDebug';

export const useCardanoChain = () => {
  const [assets, setAssets] = useState<PresentedCardanoAsset[]>();
  const { hasConnectedWallet, connectedWalletName, connectedWalletInstance } =
    useContext(WalletContext);
  const { disconnect: disconnectCardanoWallet } = useWallet();
  const cardanoAddress = useSafeCardanoAddress();

  const getAssets = useCallback(async (): Promise<PresentedCardanoAsset[]> => {
    if (!connectedWalletInstance) {
      logCardanoWalletDebug('balance:skip:no-wallet-instance', {
        walletName: connectedWalletName,
      });
      return [];
    }
    const startedAt = Date.now();
    logCardanoWalletDebug('balance:getBalance:start', {
      walletName: connectedWalletName,
    });
    const balance = await connectedWalletInstance.getBalance();
    logCardanoWalletDebug('balance:getBalance:success', {
      walletName: connectedWalletName,
      elapsedMs: Date.now() - startedAt,
      assetCount: balance.length,
    });
    return resolveCardanoWalletAssets(balance, (assetId) =>
      lookupCardanoAssetDenomTrace(assetId, { silent: true }),
    );
  }, [connectedWalletInstance, connectedWalletName]);

  useEffect(() => {
    if (hasConnectedWallet && cardanoAddress) {
      let cancelled = false;
      setAssets(undefined);

      getAssets()
        .then((walletAssets) => {
          if (!cancelled) {
            setAssets(walletAssets);
          }
        })
        .catch((error) => {
          if (cancelled) return;

          setAssets(undefined);
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
    }
    setAssets(undefined);
    return undefined;
  }, [
    cardanoAddress,
    connectedWalletName,
    disconnectCardanoWallet,
    getAssets,
    hasConnectedWallet,
  ]);

  const sortAssetsByQuantity = useCallback(
    (assetList: PresentedCardanoAsset[]): PresentedCardanoAsset[] => {
      return [...assetList].sort((assetA, assetB) => {
        const quantityA = BigInt(assetA.quantity);
        const quantityB = BigInt(assetB.quantity);

        if (quantityA === BigInt(0) && quantityB !== BigInt(0)) {
          return 1;
        }
        if (quantityA !== BigInt(0) && quantityB === BigInt(0)) {
          return -1;
        }
        return 0;
      });
    },
    [],
  );

  const getTotalSupply = useCallback((): PresentedCardanoAsset[] => {
    return sortAssetsByQuantity(assets ?? []);
  }, [assets, sortAssetsByQuantity]);

  const getBalanceByDenom = useCallback(
    (denom: string): string => {
      const assetData = assets?.find((asset) => asset?.unit === denom);
      if (!assetData) {
        return '0';
      }
      return assetData?.quantity.toString();
    },
    [assets],
  );

  return useMemo(
    () => ({ getTotalSupply, getBalanceByDenom }),
    [getBalanceByDenom, getTotalSupply],
  );
};
