'use client';

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Asset } from '@meshsdk/common';
import { useAddress, WalletContext } from '@meshsdk/react';

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
  const cardanoAddress = useAddress();

  const getAssets = useCallback(async (): Promise<Asset[]> => {
    if (!connectedWalletInstance) {
      return [];
    }
    const balance = await connectedWalletInstance.getBalance();
    return balance.map((asset) => {
      const assetKey = asset.unit;
      return {
        unit: assetKey,
        quantity: asset.quantity,
        assetName: tryAssetName(assetKey),
      } as Asset;
    });
  }, [connectedWalletInstance]);

  useEffect(() => {
    if (hasConnectedWallet && cardanoAddress) {
      getAssets().then(setAssets);
      return;
    }
    setAssets(undefined);
  }, [cardanoAddress, connectedWalletName, getAssets, hasConnectedWallet]);

  const sortAssetsByQuantity = useCallback((assets: Asset[]): Asset[] => {
    return assets.sort((assetA, assetB) => {
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

  const getBalanceByDenom = useCallback((denom: string): string => {
    const assetData = assets?.find((asset) => asset?.unit === denom);
    if (!assetData) {
      return '0';
    }
    return assetData?.quantity.toString();
  }, [assets]);

  return useMemo(
    () => ({ getTotalSupply, getBalanceByDenom }),
    [getBalanceByDenom, getTotalSupply],
  );
};
