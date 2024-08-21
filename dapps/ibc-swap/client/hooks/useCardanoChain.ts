'use client';

import { useContext, useEffect, useState } from 'react';
import type { Asset } from '@meshsdk/common';
import { useAddress, WalletContext } from '@meshsdk/react';
import {
  Lucid,
  Blockfrost,
  Kupmios,
  Provider,
  toText,
} from '@cuonglv0297/lucid-custom';

const tryAssetName = (assetHex: string): string => {
  const tokenName = assetHex.slice(56);
  if (tokenName === '') {
    return assetHex;
  }
  return toText(tokenName);
};

export const useCardanoChain = () => {
  const [assets, setAssets] = useState<Asset[]>();
  const { hasConnectedWallet, connectedWalletName, connectedWalletInstance } =
    useContext(WalletContext);
  const cardanoAddress = useAddress();
  let provider: Provider;

  if (process.env.NEXT_PUBLIC_BLOCKFROST_PROJECT_ID) {
    provider = new Blockfrost(
      'https://cardano-preview.blockfrost.io/api/v0',
      process.env.NEXT_PUBLIC_BLOCKFROST_PROJECT_ID,
    );
  } else {
    const [kupoUrl, ogmiosUrl] =
      process.env.NEXT_PUBLIC_KUPMIOS_URL!.split(',');
    provider = new Kupmios(kupoUrl, ogmiosUrl);
  }
  const getAssets = async (): Promise<Asset[]> => {
    // TODO: check networkId
    const lucid = await Lucid.new(provider, 'Preview');
    lucid.selectWalletFrom({
      address: cardanoAddress!,
    });
    const utxos = await lucid.wallet.getUtxos();
    const assets: { [key: string]: bigint } = {};
    utxos.forEach((utxo) => {
      const assetsUtxo = utxo.assets;
      Object.keys(assetsUtxo).forEach((key) => {
        if (!assets[key]) {
          assets[key] = BigInt(0);
        }
        assets[key] += assetsUtxo[key];
      });
    });
    const result = (Object.keys(assets) || []).map((assetKey) => {
      return {
        unit: assetKey,
        quantity: assets[assetKey].toString(),
        assetName: tryAssetName(assetKey),
      } as Asset;
    });
    return result;
  };

  useEffect(() => {
    if (hasConnectedWallet && cardanoAddress) {
      getAssets().then(setAssets);
    }
  }, [cardanoAddress, connectedWalletName]);

  const sortAssetsByQuantity = (assets: Asset[]): Asset[] => {
    return assets.sort((assetA, assetB) => {
      const quantityA = BigInt(assetA.quantity);
      const quantityB = BigInt(assetB.quantity);

      if (quantityA === BigInt(0) && quantityB !== BigInt(0)) {
        return 1;
      } else if (quantityA !== BigInt(0) && quantityB === BigInt(0)) {
        return -1;
      } else {
        return 0;
      }
    });
  };

  const getTotalSupply = (): Asset[] => {
    return sortAssetsByQuantity(assets ?? []);
  };

  return { getTotalSupply };
};
