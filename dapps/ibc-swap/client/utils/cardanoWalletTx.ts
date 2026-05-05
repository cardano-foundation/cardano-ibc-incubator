import { getCardanoWalletErrorMessage } from './cardanoWalletStatus';
import {
  logCardanoWalletDebug,
  logCardanoWalletError,
  shortValue,
} from './cardanoWalletDebug';

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
    logCardanoWalletDebug('provider:missing-window-cardano', { walletName });
    throw new Error('No Cardano browser wallet provider is installed.');
  }

  const availableProviders = Object.values(cardano)
    .filter((candidate) => typeof candidate.enable === 'function')
    .map((candidate) => candidate.name || 'unknown');
  logCardanoWalletDebug('provider:resolve:start', {
    walletName,
    availableProviders: availableProviders.join(', '),
  });

  const provider = Object.values(cardano).find(
    (candidate) =>
      typeof candidate.enable === 'function' &&
      (!walletName ||
        candidate.name?.toLowerCase() === walletName.toLowerCase()),
  );

  if (typeof provider?.enable !== 'function') {
    logCardanoWalletDebug('provider:resolve:missing', {
      walletName,
      availableProviders: availableProviders.join(', '),
    });
    throw new Error(
      walletName
        ? `Connected Cardano wallet provider ${walletName} is not available in the browser.`
        : 'Connected Cardano wallet provider is not available in the browser.',
    );
  }

  logCardanoWalletDebug('provider:resolve:success', {
    requestedWalletName: walletName,
    resolvedWalletName: provider.name,
  });
  return provider as EnabledCardanoWalletProvider;
}

export async function signAndSubmitCardanoTxWithCip30(
  unsignedTx: string,
  walletName?: string,
): Promise<string> {
  const provider = resolveCardanoProvider(walletName);
  logCardanoWalletDebug('enable:start', { walletName: provider.name });
  const enableStartedAt = Date.now();
  let walletApi: CardanoWalletApi;
  try {
    walletApi = await provider.enable();
    logCardanoWalletDebug('enable:success', {
      walletName: provider.name,
      elapsedMs: Date.now() - enableStartedAt,
      hasSignTx: typeof walletApi.signTx === 'function',
      hasSubmitTx: typeof walletApi.submitTx === 'function',
    });
  } catch (error) {
    logCardanoWalletError('enable:error', error, {
      walletName: provider.name,
      elapsedMs: Date.now() - enableStartedAt,
    });
    throw new Error(getCardanoWalletErrorMessage(error, { phase: 'connect' }));
  }

  let witnessSetCbor: string;
  logCardanoWalletDebug('signTx:start', {
    walletName: provider.name,
    unsignedTx: shortValue(unsignedTx),
    unsignedTxLength: unsignedTx.length,
    partialSign: true,
  });
  const signStartedAt = Date.now();
  try {
    witnessSetCbor = (await walletApi.signTx(unsignedTx, true)) as string;
    logCardanoWalletDebug('signTx:success', {
      walletName: provider.name,
      elapsedMs: Date.now() - signStartedAt,
      witnessSetLength: witnessSetCbor.length,
    });
  } catch (error) {
    logCardanoWalletError('signTx:error', error, {
      walletName: provider.name,
      elapsedMs: Date.now() - signStartedAt,
    });
    throw new Error(getCardanoWalletErrorMessage(error, { phase: 'sign' }));
  }

  logCardanoWalletDebug('assembleSignedTx:start', {
    unsignedTxLength: unsignedTx.length,
    witnessSetLength: witnessSetCbor.length,
  });
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
  logCardanoWalletDebug('assembleSignedTx:success', {
    signedTxLength: signedTx.length,
  });

  logCardanoWalletDebug('submitTx:start', {
    walletName: provider.name,
    signedTx: shortValue(signedTx),
    signedTxLength: signedTx.length,
  });
  const submitStartedAt = Date.now();
  try {
    const txHash = (await walletApi.submitTx(signedTx)) as string;
    logCardanoWalletDebug('submitTx:success', {
      walletName: provider.name,
      elapsedMs: Date.now() - submitStartedAt,
      txHash: shortValue(txHash),
    });
    return txHash;
  } catch (error) {
    logCardanoWalletError('submitTx:error', error, {
      walletName: provider.name,
      elapsedMs: Date.now() - submitStartedAt,
    });
    throw new Error(getCardanoWalletErrorMessage(error, { phase: 'submit' }));
  }
}
