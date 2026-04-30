'use client';

/* global BigInt */

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Asset } from '@meshsdk/common';
import { useWallet, WalletContext } from '@meshsdk/react';
import { toast } from 'react-toastify';
import { useSafeCardanoAddress } from '@/hooks/useSafeCardanoAddress';
import {
  CARDANO_WALLET_LOCKED_MESSAGE,
  CARDANO_WALLET_LOCKED_TOAST_ID,
  forgetStoredCardanoWallet,
  isCardanoWalletLockedError,
} from '@/utils/cardanoWalletStatus';

const hexToText = (hex: string): string => {
  if (!hex || hex.length % 2 !== 0) {
    return hex;
  }

  try {
    const bytes = new Uint8Array(
      hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? [],
    );
    return new TextDecoder().decode(bytes);
  } catch {
    return hex;
  }
};

const tryAssetName = (assetHex: string): string => {
  const tokenName = assetHex.slice(56);
  if (tokenName === '') {
    return assetHex;
  }
  return hexToText(tokenName);
};

export const useCardanoChain = () => {
  const [assets, setAssets] = useState<Asset[]>();
  const { hasConnectedWallet, connectedWalletName, connectedWalletInstance } =
    useContext(WalletContext);
  const { disconnect: disconnectCardanoWallet } = useWallet();
  const cardanoAddress = useSafeCardanoAddress();

  const getAssets = useCallback(async (): Promise<Asset[]> => {
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
    return balance.map((asset) => {
      const assetKey = asset.unit;
      return {
        unit: assetKey,
        quantity: asset.quantity,
        assetName: tryAssetName(assetKey),
      } as Asset;
    });
  }, [connectedWalletInstance, connectedWalletName]);

  useEffect(() => {
    if (hasConnectedWallet && cardanoAddress) {
      let cancelled = false;

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

  const sortAssetsByQuantity = useCallback((assetList: Asset[]): Asset[] => {
    return assetList.sort((assetA, assetB) => {
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
  }, []);

  const getTotalSupply = useCallback((): Asset[] => {
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
