type CardanoWalletApi = {
  signTx: Function;
  submitTx: Function;
};

type CardanoWalletProvider = {
  name?: string;
  enable?: () => Promise<CardanoWalletApi>;
};

type EnabledCardanoWalletProvider = CardanoWalletProvider & {
  enable: () => Promise<CardanoWalletApi>;
};

function resolveCardanoProvider(
  walletName?: string,
): EnabledCardanoWalletProvider {
  if (typeof window === 'undefined') {
    throw new Error('Cardano wallet signing is only available in the browser.');
  }

  const { cardano } = window as typeof window & {
    cardano?: Record<string, CardanoWalletProvider>;
  };

  if (!cardano) {
    throw new Error('No Cardano browser wallet provider is installed.');
  }

  const provider = Object.values(cardano).find(
    (candidate) =>
      typeof candidate.enable === 'function' &&
      (!walletName ||
        candidate.name?.toLowerCase() === walletName.toLowerCase()),
  );

  if (typeof provider?.enable !== 'function') {
    throw new Error(
      walletName
        ? `Connected Cardano wallet provider ${walletName} is not available in the browser.`
        : 'Connected Cardano wallet provider is not available in the browser.',
    );
  }

  return provider as EnabledCardanoWalletProvider;
}

export async function signAndSubmitCardanoTxWithCip30(
  unsignedTx: string,
  walletName?: string,
): Promise<string> {
  const provider = resolveCardanoProvider(walletName);
  const walletApi = await provider.enable();
  const witnessSetCbor = (await walletApi.signTx(unsignedTx, true)) as string;
  const CML = await import('@anastasia-labs/cardano-multiplatform-lib-browser');

  const tx = CML.Transaction.from_cbor_hex(unsignedTx);
  const witnessSetBuilder = CML.TransactionWitnessSetBuilder.new();
  witnessSetBuilder.add_existing(tx.witness_set());
  witnessSetBuilder.add_existing(
    CML.TransactionWitnessSet.from_cbor_hex(witnessSetCbor),
  );

  const signedTx = CML.Transaction.new(
    tx.body(),
    witnessSetBuilder.build(),
    tx.is_valid(),
    tx.auxiliary_data(),
  ).to_cbor_hex();

  return walletApi.submitTx(signedTx) as Promise<string>;
}
