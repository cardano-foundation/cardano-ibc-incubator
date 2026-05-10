import { submitSignedCardanoTx } from '@/apis/restapi/cardano';
import { getCardanoWalletErrorMessage } from './cardanoWalletStatus';
import {
  logCardanoWalletDebug,
  logCardanoWalletError,
  shortValue,
} from './cardanoWalletDebug';

type CardanoWalletApi = {
  getChangeAddress?: () => Promise<string>;
  getUsedAddresses?: () => Promise<string[]>;
  getUtxos?: () => Promise<string[] | undefined>;
  signTx: Function;
  submitTx: Function;
};

type CmlModule = typeof import('@anastasia-labs/cardano-multiplatform-lib-browser');

type CmlList<T> = {
  len: () => number;
  get: (index: number) => T;
};

type CmlTransactionInput = {
  transaction_id: () => { to_hex: () => string };
  index: () => bigint | number;
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

const transactionInputRef = (input: CmlTransactionInput): string =>
  `${input.transaction_id().to_hex()}#${input.index().toString()}`;

const readCmlList = <T,>(
  list: CmlList<T> | null | undefined,
  mapItem: (item: T) => string,
): string[] => {
  if (!list) return [];

  const values: string[] = [];
  for (let index = 0; index < list.len(); index += 1) {
    values.push(mapItem(list.get(index)));
  }
  return values;
};

const readWalletUtxoRefs = (
  CML: CmlModule,
  walletUtxos: unknown,
): { decodeErrorCount: number; refs: string[] } => {
  if (!Array.isArray(walletUtxos)) {
    return { decodeErrorCount: 0, refs: [] };
  }

  let decodeErrorCount = 0;
  const refs: string[] = [];
  for (const walletUtxo of walletUtxos) {
    if (typeof walletUtxo !== 'string') {
      decodeErrorCount += 1;
      continue;
    }

    try {
      refs.push(
        transactionInputRef(
          CML.TransactionUnspentOutput.from_cbor_hex(walletUtxo).input(),
        ),
      );
    } catch {
      decodeErrorCount += 1;
    }
  }

  return { decodeErrorCount, refs };
};

const tryWalletRead = async <T,>(
  label: string,
  read: (() => Promise<T | undefined> | undefined) | undefined,
  walletName?: string,
): Promise<T | undefined> => {
  if (!read) return undefined;
  try {
    return await read();
  } catch (error) {
    logCardanoWalletError(`signTx:preflight:${label}:error`, error, {
      walletName,
    });
    return undefined;
  }
};

const logPreSignDiagnostics = async (
  CML: CmlModule,
  walletApi: CardanoWalletApi,
  unsignedTx: string,
  walletName?: string,
) => {
  try {
    const tx = CML.Transaction.from_cbor_hex(unsignedTx);
    const body = tx.body();
    const txInputs = readCmlList(body.inputs(), transactionInputRef);
    const collateralInputs = readCmlList(
      body.collateral_inputs(),
      transactionInputRef,
    );
    const referenceInputs = readCmlList(
      body.reference_inputs(),
      transactionInputRef,
    );
    const requiredSigners = readCmlList(
      body.required_signers(),
      (signer) => signer.to_hex(),
    );

    const [rawWalletUtxos, usedAddresses, changeAddress] = await Promise.all([
      tryWalletRead('getUtxos', () => walletApi.getUtxos?.(), walletName),
      tryWalletRead(
        'getUsedAddresses',
        () => walletApi.getUsedAddresses?.(),
        walletName,
      ),
      tryWalletRead(
        'getChangeAddress',
        () => walletApi.getChangeAddress?.(),
        walletName,
      ),
    ]);
    const walletUtxos = readWalletUtxoRefs(CML, rawWalletUtxos);
    const walletUtxoSet = new Set(walletUtxos.refs);
    const matchingInputs = txInputs.filter((input) => walletUtxoSet.has(input));
    const matchingCollateralInputs = collateralInputs.filter((input) =>
      walletUtxoSet.has(input),
    );

    logCardanoWalletDebug('signTx:preflight', {
      walletName,
      txInputCount: txInputs.length,
      collateralInputCount: collateralInputs.length,
      referenceInputCount: referenceInputs.length,
      requiredSignerCount: requiredSigners.length,
      walletUtxoCount: walletUtxos.refs.length,
      walletUtxoDecodeErrorCount: walletUtxos.decodeErrorCount,
      matchingInputCount: matchingInputs.length,
      matchingCollateralInputCount: matchingCollateralInputs.length,
      txInputs: txInputs.slice(0, 12),
      collateralInputs: collateralInputs.slice(0, 12),
      referenceInputs: referenceInputs.slice(0, 12),
      requiredSigners: requiredSigners.slice(0, 12),
      walletUtxos: walletUtxos.refs.slice(0, 12),
      matchingInputs: matchingInputs.slice(0, 12),
      matchingCollateralInputs: matchingCollateralInputs.slice(0, 12),
      usedAddressCount: usedAddresses?.length,
      usedAddresses: usedAddresses
        ?.slice(0, 3)
        .map((address) => shortValue(address, 18)),
      changeAddress: shortValue(changeAddress, 18),
    });
  } catch (error) {
    logCardanoWalletError('signTx:preflight:error', error, { walletName });
  }
};

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
    throw new Error(getCardanoWalletErrorMessage(error));
  }

  const CML = await import('@anastasia-labs/cardano-multiplatform-lib-browser');
  await logPreSignDiagnostics(CML, walletApi, unsignedTx, provider.name);

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
    throw new Error(getCardanoWalletErrorMessage(error));
  }

  logCardanoWalletDebug('assembleSignedTx:start', {
    unsignedTxLength: unsignedTx.length,
    witnessSetLength: witnessSetCbor.length,
  });

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
    submitter: 'dapp-backend',
    signedTx: shortValue(signedTx),
    signedTxLength: signedTx.length,
  });
  const submitStartedAt = Date.now();
  try {
    // Wallets provide witnesses; the dapp backend owns network submission.
    const txHash = await submitSignedCardanoTx(signedTx);
    logCardanoWalletDebug('submitTx:success', {
      walletName: provider.name,
      submitter: 'dapp-backend',
      elapsedMs: Date.now() - submitStartedAt,
      txHash: shortValue(txHash),
    });
    return txHash;
  } catch (error) {
    logCardanoWalletError('submitTx:error', error, {
      walletName: provider.name,
      elapsedMs: Date.now() - submitStartedAt,
    });
    throw new Error(getCardanoWalletErrorMessage(error));
  }
}
