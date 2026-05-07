import { getCardanoWalletErrorMessage } from './cardanoWalletStatus';
import {
  logCardanoWalletDebug,
  logCardanoWalletError,
  shortValue,
} from './cardanoWalletDebug';

export type CardanoSigningWallet = {
  signTx?: Function;
  submitTx?: Function;
};

export async function signAndSubmitCardanoTxWithMeshWallet(
  unsignedTx: string,
  wallet: CardanoSigningWallet | undefined,
  walletName?: string,
): Promise<string> {
  if (typeof wallet?.signTx !== 'function') {
    throw new Error('Connected Cardano wallet cannot sign transactions.');
  }

  if (typeof wallet.submitTx !== 'function') {
    throw new Error('Connected Cardano wallet cannot submit transactions.');
  }

  let signedTx: string;
  logCardanoWalletDebug('signTx:start', {
    walletName,
    unsignedTx: shortValue(unsignedTx),
    unsignedTxLength: unsignedTx.length,
    partialSign: true,
  });
  const signStartedAt = Date.now();
  try {
    signedTx = await wallet.signTx(unsignedTx, true);
    logCardanoWalletDebug('signTx:success', {
      walletName,
      elapsedMs: Date.now() - signStartedAt,
      signedTxLength: signedTx.length,
    });
  } catch (error) {
    logCardanoWalletError('signTx:error', error, {
      walletName,
      elapsedMs: Date.now() - signStartedAt,
    });
    throw new Error(getCardanoWalletErrorMessage(error, { phase: 'sign' }));
  }

  logCardanoWalletDebug('submitTx:start', {
    walletName,
    signedTx: shortValue(signedTx),
    signedTxLength: signedTx.length,
  });
  const submitStartedAt = Date.now();
  try {
    const txHash = await wallet.submitTx(signedTx);
    logCardanoWalletDebug('submitTx:success', {
      walletName,
      elapsedMs: Date.now() - submitStartedAt,
      txHash: shortValue(txHash),
    });
    return txHash;
  } catch (error) {
    logCardanoWalletError('submitTx:error', error, {
      walletName,
      elapsedMs: Date.now() - submitStartedAt,
    });
    throw new Error(getCardanoWalletErrorMessage(error, { phase: 'submit' }));
  }
}
