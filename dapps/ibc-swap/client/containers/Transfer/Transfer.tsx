'use client';

import { Box, Heading, Spinner, Text, useDisclosure } from '@chakra-ui/react';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import CustomInput from '@/components/CustomInput';
import TransferContext from '@/contexts/TransferContext';
import IBCParamsContext from '@/contexts/IBCParamsContext';
import DefaultCosmosNetworkIcon from '@/assets/icons/cosmos-icon.svg';
import DefaultCardanoNetworkIcon from '@/assets/icons/cardano.svg';

import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import { selectableChains } from '@/configs/customChainInfo';
import {
  verifyAddress,
  verifyCardanoPaymentKeyHashAddress,
} from '@/utils/address';
import { TransferTokenItemProps } from '@/components/TransferTokenItem/TransferTokenItem';
import { useCosmosChain } from '@/hooks/useCosmosChain';
import {
  cosmosChainsSupported,
  defaultChainName,
  HOUR_IN_NANOSEC,
} from '@/constants';

import {
  getCardanoWalletUtxosForBuilder,
  requireUnsignedCardanoTxCborHex,
  unsignedTxTransferFromCosmos,
  unsignedTxTransferFromCardano,
} from '@/utils/buildTransferTx';
import {
  lookupCardanoAssetDenomTrace,
  planTransferRoute,
  type CardanoAssetDenomTrace,
} from '@/apis/restapi/cardano';
import { useWallet } from '@meshsdk/react';
import {
  decimalDisplayToBaseAmount,
  formatPrice,
  isBaseAmountWithinBalance,
  isPositiveBaseAmount,
} from '@/utils/string';
import { useCardanoChain } from '@/hooks/useCardanoChain';
import { useSafeCardanoAddress } from '@/hooks/useSafeCardanoAddress';
import SwapContext from '@/contexts/SwapContext';
import BigNumber from 'bignumber.js';
import { CARDANO_CHAIN_ID } from '@/configs/runtime';
import { signAndSubmitCardanoTxWithMeshWallet } from '@/utils/cardanoWalletTx';
import { getCardanoWalletErrorMessage } from '@/utils/cardanoWalletStatus';
import {
  logCardanoWalletDebug,
  logCardanoWalletError,
  shortValue,
} from '@/utils/cardanoWalletDebug';
import {
  findRuntimeChain,
  findRuntimeRoute,
  runtimeChainLabel,
  runtimeRouteChainIds,
  runtimeRouteDisabledReason,
} from '@/configs/runtimeConfig';
import SelectNetwork from './SelectNetwork';
import SelectToken from './SelectToken';
import { NetworkModal } from './modal/NetworkModal';
import { TokenModal } from './modal/TokenModal';
import { TransferResult } from './TransferResult';
import { CalculatorBox } from './CalculatorBox';

import {
  StyledTransferButton,
  StyledTransferContainer,
  StyledWrapContainer,
} from './index.style';

type EstimateFeeType = {
  display: boolean;
  canEst: boolean;
  msgs: any[];
  estReceiveAmount: string;
  estTime: string;
  estFee: string;
  intentId?: string;
  requiresCardanoBuild?: boolean;
};

type CalculateEstOptions = {
  intentId: string;
  buildCardanoTx?: boolean;
  shouldApplySideEffects?: () => boolean;
};

type RoutePreviewState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  chainIds: string[];
  message?: string;
};

type CardanoAsset = {
  assetName: string;
  quantity?: string;
  unit?: string;
  fingerprint?: string;
  policyId?: string;
};

type CompleteVoucherDisplayTrace = CardanoAssetDenomTrace & {
  kind: 'ibc_voucher';
  displayName: string;
  displaySymbol: string;
  decimals: number;
};

const CARDANO_POLICY_ID_HEX_LENGTH = 56;
const CIP67_FT_LABEL_HEX = '0014df10';
const CIP67_REFERENCE_NFT_LABEL_HEX = '000643b0';
const LABELED_VOUCHER_TOKEN_NAME_HEX_LENGTH = 64;

const getCip67VoucherKind = (
  assetUnit?: string,
): 'ft' | 'reference_nft' | null => {
  const assetNameHex = assetUnit?.slice(CARDANO_POLICY_ID_HEX_LENGTH);
  if (
    !assetNameHex ||
    assetNameHex.length !== LABELED_VOUCHER_TOKEN_NAME_HEX_LENGTH ||
    /[^0-9a-f]/i.test(assetNameHex)
  ) {
    return null;
  }

  const label = assetNameHex.slice(0, 8).toLowerCase();
  if (label === CIP67_FT_LABEL_HEX) return 'ft';
  if (label === CIP67_REFERENCE_NFT_LABEL_HEX) return 'reference_nft';
  return null;
};

const hasCompleteVoucherDisplayMetadata = (
  trace: CardanoAssetDenomTrace | null,
): trace is CompleteVoucherDisplayTrace =>
  trace?.kind === 'ibc_voucher' &&
  Boolean(trace.displayName?.trim()) &&
  Boolean(trace.displaySymbol?.trim()) &&
  typeof trace.decimals === 'number' &&
  Number.isInteger(trace.decimals) &&
  trace.decimals >= 0;

const initEstData = {
  display: false,
  canEst: false,
  msgs: [],
  estReceiveAmount: '',
  estFee: '----',
  estTime: '----',
};

const initEstDataForIntent = (intentId?: string): EstimateFeeType => ({
  ...initEstData,
  intentId,
});

const initRoutePreview: RoutePreviewState = {
  status: 'idle',
  chainIds: [],
};

const COSMOS_TRANSFER_EST_TIME = '~2 mins';
const CARDANO_TRANSFER_EST_TIME = '~10 mins';

const normalizeTokenExponent = (exponent?: number | null): number =>
  Number.isInteger(exponent) && exponent && exponent > 0 ? exponent : 0;

const buildTransferIntentId = (intent: Record<string, unknown>): string =>
  JSON.stringify(intent);

const routePreviewStatusColor: Record<RoutePreviewState['status'], string> = {
  idle: '#FFFFFF52',
  loading: '#F6C85F',
  ready: '#4DFED3',
  error: '#FF6B6B',
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message;
  }

  return fallback;
};

const getCardanoBuildErrorMessage = (error: unknown): string => {
  const message = getErrorMessage(
    error,
    'Unable to build the unsigned Cardano transfer transaction.',
  );

  if (message.includes('Unable to find UTxO with unit')) {
    return `${message}. The selected route references Cardano channel state that is not present for the active bridge deployment. Recreate or realign the Cardano channel state before retrying.`;
  }

  if (
    message.includes('KupmiosError') &&
    message.includes('TimeoutException')
  ) {
    return 'Cardano transaction preparation timed out while querying Kupo/Ogmios. The Cardano data provider did not respond within 10 seconds. Retry the transfer; if this keeps happening, the bridge operator may need to restart or replace the Cardano data-provider endpoint.';
  }

  if (
    message.includes('does not have enough funds to cover the required') &&
    message.includes('collateral')
  ) {
    const requiredLovelace = message.match(
      /required (\d+) Lovelace collateral/,
    )?.[1];
    const requiredAda = requiredLovelace
      ? new BigNumber(requiredLovelace).dividedBy(1_000_000).toString()
      : null;
    return `Your Cardano wallet needs ${
      requiredAda ? `at least ${requiredAda} ADA` : 'enough ADA'
    } in collateral-eligible UTxOs to build this Plutus transaction. Add or split ADA in the wallet, then retry. UTxOs with reference scripts are not eligible for collateral.`;
  }

  return message;
};

const RoutePreview = ({ preview }: { preview: RoutePreviewState }) => {
  if (preview.status === 'idle' || preview.chainIds.length === 0) {
    return null;
  }

  return (
    <Box
      mt="16px"
      p="12px"
      borderRadius="10px"
      border="1px solid #FFFFFF14"
      background="#26262A"
    >
      <Box display="flex" justifyContent="space-between" gap="12px">
        <Text fontSize="12px" color="#FFFFFF99" fontWeight={700}>
          Route preview
        </Text>
        <Box
          display="flex"
          alignItems="center"
          justifyContent="flex-end"
          gap="6px"
        >
          {preview.status === 'loading' && (
            <Spinner
              size="xs"
              color={routePreviewStatusColor[preview.status]}
              thickness="2px"
            />
          )}
          <Text
            fontSize="12px"
            color={routePreviewStatusColor[preview.status]}
            fontWeight={700}
            textTransform="capitalize"
          >
            {preview.status}
          </Text>
        </Box>
      </Box>
      <Text mt="6px" fontSize="14px" color="#FAFAFA" fontWeight={700}>
        {preview.chainIds.map(runtimeChainLabel).join(' -> ')}
      </Text>
      <Text mt="4px" fontSize="12px" color="#FFFFFF99">
        {preview.message ||
          'Entrypoint is route infrastructure and is not user selectable.'}
      </Text>
    </Box>
  );
};

const Transfer = () => {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [networkList, setNetworkList] = useState<NetworkItemProps[]>([]);
  const [tokenList, setTokenList] = useState<TransferTokenItemProps[]>([]);
  const [validationAddress, setValidationAddress] = useState<string>('');
  const [estData, setEstData] = useState<EstimateFeeType>(initEstData);
  const [routePreview, setRoutePreview] =
    useState<RoutePreviewState>(initRoutePreview);
  const [lastPrepareFailed, setLastPrepareFailed] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string>('');
  const transferIntentIdRef = useRef('');
  const { wallet: cardanoWallet, name: connectedCardanoWalletName } =
    useWallet();

  const resetLastTxData = () => {
    setEstData(initEstData);
    setLastPrepareFailed(false);
    setLastTxHash('');
  };

  const {
    destinationAddress,
    sendAmount,
    setDestinationAddress,
    getDataTransfer,
    fromNetwork,
    toNetwork,
    selectedToken,
    setSelectedToken,
    setSendAmount,
    setIsLoading: setIsFetchDataLoading,
    setIsProcessingTransfer,
    isProcessingTransfer,
  } = useContext(TransferContext);
  const { getPfmFee } = useContext(IBCParamsContext);
  const { handleResetData: handleResetSwapData } = useContext(SwapContext);

  const {
    isOpen: isOpenNetworkModal,
    onOpen: onOpenNetworkModal,
    onClose: onCloseNetworkModal,
  } = useDisclosure();
  const {
    isOpen: isOpenTokenModal,
    onOpen: onOpenTokenModal,
    onClose: onCloseTokenModal,
  } = useDisclosure();

  const cosmosChain = useCosmosChain(fromNetwork.networkId || defaultChainName);
  const { getAccount, estimateFee } = cosmosChain;

  // handle get cardano assets
  const cardano = useCardanoChain();
  const cardanoAddress = useSafeCardanoAddress();
  const cardanoAssets: CardanoAsset[] = [];
  cardano.getTotalSupply()?.forEach((asset) => {
    const assetWithName = asset as typeof asset & { assetName: string };
    cardanoAssets.push({
      quantity: assetWithName.quantity,
      assetName: assetWithName.assetName,
      unit: asset.unit,
    });
  });

  const currentConfiguredRoute = findRuntimeRoute(
    fromNetwork.networkId,
    toNetwork.networkId,
  );

  const selectedTransferBaseAmount = decimalDisplayToBaseAmount(
    sendAmount,
    selectedToken.tokenExponent ?? 0,
  );
  const currentTransferIntentId = buildTransferIntentId({
    fromNetworkId: fromNetwork.networkId || '',
    fromIbcChainId: fromNetwork.ibcChainId || '',
    toNetworkId: toNetwork.networkId || '',
    toIbcChainId: toNetwork.ibcChainId || '',
    tokenId: selectedToken.tokenId || '',
    tokenBalance: selectedToken.balance || '',
    tokenExponent: selectedToken.tokenExponent ?? 0,
    amount: selectedTransferBaseAmount || '',
    destinationAddress,
    cardanoAddress: cardanoAddress || '',
    cardanoWallet: connectedCardanoWalletName || '',
    cosmosAddress: cosmosChain.address || '',
    routeId: currentConfiguredRoute?.id || '',
    routeEnabled: Boolean(currentConfiguredRoute?.enabled),
  });
  transferIntentIdRef.current = currentTransferIntentId;

  const isCurrentTransferIntent = (intentId?: string): boolean =>
    Boolean(intentId) && transferIntentIdRef.current === intentId;

  const getSourceWalletMismatch = (): string | null => {
    if (!fromNetwork.networkId) return null;
    const sourceChain = findRuntimeChain(fromNetwork.networkId);
    if (!sourceChain) return null;

    if (sourceChain.kind === 'cardano') {
      if (!cardanoAddress) return 'Connect a Cardano wallet.';
      if (!verifyAddress(cardanoAddress, fromNetwork.networkId)) {
        return `Connect a wallet for ${sourceChain.prettyName}.`;
      }
    }

    return null;
  };

  const getDestinationAddressError = (): string => {
    if (!destinationAddress) {
      return 'Address is required';
    }
    const dataTransfer = getDataTransfer();
    const isValidAddress = verifyAddress(
      destinationAddress,
      dataTransfer?.toNetwork?.networkId?.toString() || undefined,
    );
    if (!isValidAddress) {
      return 'Invalid address';
    }
    if (
      dataTransfer?.toNetwork?.networkId === CARDANO_CHAIN_ID &&
      !verifyCardanoPaymentKeyHashAddress(destinationAddress)
    ) {
      return 'Cardano receiver must be a base or enterprise address with a payment key credential';
    }
    return '';
  };

  const calculateEst = async ({
    intentId,
    buildCardanoTx = true,
    shouldApplySideEffects,
  }: CalculateEstOptions): Promise<EstimateFeeType> => {
    const canApplySideEffects = () =>
      isCurrentTransferIntent(intentId) && (shouldApplySideEffects?.() ?? true);
    const applySideEffect = (callback: () => void) => {
      if (canApplySideEffects()) callback();
    };
    const setRoutePreviewForIntent = (preview: RoutePreviewState) => {
      applySideEffect(() => setRoutePreview(preview));
    };
    const toastErrorForIntent = (message: string) => {
      applySideEffect(() =>
        toast.error(message, { theme: 'colored', autoClose: 7000 }),
      );
    };
    const emptyEstData = () => initEstDataForIntent(intentId);

    applySideEffect(() => setLastPrepareFailed(false));
    const routeChainIds = runtimeRouteChainIds(
      fromNetwork.networkId,
      toNetwork.networkId,
    );
    const markCardanoPrepareFailed = () => {
      applySideEffect(() => {
        if (fromNetwork.networkId === CARDANO_CHAIN_ID) {
          setLastPrepareFailed(true);
        }
      });
    };

    if (!fromNetwork.networkId || !toNetwork.networkId) {
      setRoutePreviewForIntent(initRoutePreview);
      return emptyEstData();
    }

    if (!currentConfiguredRoute?.enabled) {
      setRoutePreviewForIntent({
        status: 'error',
        chainIds: routeChainIds,
        message: runtimeRouteDisabledReason(
          fromNetwork.networkId,
          toNetwork.networkId,
        ),
      });
      return emptyEstData();
    }

    const walletMismatch = getSourceWalletMismatch();
    if (walletMismatch) {
      setRoutePreviewForIntent({
        status: 'error',
        chainIds: routeChainIds,
        message: walletMismatch,
      });
      return emptyEstData();
    }

    const transferBaseAmount = decimalDisplayToBaseAmount(
      sendAmount,
      selectedToken.tokenExponent ?? 0,
    );

    const destinationAddressError = getDestinationAddressError();
    applySideEffect(() => setValidationAddress(destinationAddressError));

    if (destinationAddressError || !isPositiveBaseAmount(transferBaseAmount)) {
      setRoutePreviewForIntent({
        status: 'ready',
        chainIds: routeChainIds,
        message:
          'Configured route found. Enter amount and destination to estimate.',
      });
      return emptyEstData();
    }

    if (!isBaseAmountWithinBalance(transferBaseAmount, selectedToken.balance)) {
      setRoutePreviewForIntent({
        status: 'error',
        chainIds: routeChainIds,
        message: 'Amount exceeds the selected token balance.',
      });
      return emptyEstData();
    }

    const dataTransfer = getDataTransfer();
    setRoutePreviewForIntent({
      status: 'loading',
      chainIds: routeChainIds,
      message: 'Checking the live IBC route before building the transfer.',
    });
    let routePlan;
    try {
      routePlan = await planTransferRoute({
        fromChainId:
          dataTransfer.fromNetwork.ibcChainId ||
          dataTransfer.fromNetwork.networkId!,
        toChainId:
          dataTransfer.toNetwork.ibcChainId ||
          dataTransfer.toNetwork.networkId!,
        tokenDenom: selectedToken.tokenId!,
      });
    } catch (error) {
      const message = getErrorMessage(
        error,
        'Unable to load route plan from the active stack.',
      );
      markCardanoPrepareFailed();
      setRoutePreviewForIntent({
        status: 'error',
        chainIds: routeChainIds,
        message,
      });
      toastErrorForIntent(message);
      return emptyEstData();
    }

    if (!routePlan) {
      markCardanoPrepareFailed();
      setRoutePreviewForIntent({
        status: 'error',
        chainIds: routeChainIds,
        message: 'Unable to load route plan from the active stack.',
      });
      return emptyEstData();
    }

    const { chains, foundRoute, routes, failureCode, failureMessage } =
      routePlan;

    if (!foundRoute) {
      const fromChainName =
        dataTransfer.fromNetwork.networkPrettyName ||
        dataTransfer.fromNetwork.networkId;
      const toChainName =
        dataTransfer.toNetwork.networkPrettyName ||
        dataTransfer.toNetwork.networkId;
      const messageByFailureCode: Record<string, string> = {
        'channels-not-loaded':
          'IBC transfer channels have not loaded yet. Wait for channel discovery to complete and make sure the local bridge stack is running.',
        'source-chain-unavailable': `No discovered IBC transfer channels start from ${fromChainName}.`,
        'destination-chain-unavailable': `No discovered IBC transfer channels reach ${toChainName}.`,
        'no-outbound-channels': `${fromChainName} has no outbound IBC transfer channels.`,
        'no-route-found': `No IBC transfer route found from ${fromChainName} to ${toChainName}. For this local stack, that path should typically exist via Entrypoint, so check that the Entrypoint<->${toChainName} transfer channels were created successfully.`,
        'missing-unwind-hop': `Token ${
          selectedToken.tokenName || selectedToken.tokenId
        } must unwind on a specific IBC hop before it can reach ${toChainName}, but that reverse hop is not currently available.`,
        'ambiguous-unwind-hop': `Token ${
          selectedToken.tokenName || selectedToken.tokenId
        } can unwind through multiple local channels on the way to ${toChainName}; refusing to guess.`,
        'no-forward-route': `No canonical transfer route exists from ${fromChainName} to ${toChainName}.`,
        'ambiguous-forward-route': `Multiple forward IBC routes exist from ${fromChainName} to ${toChainName}; refusing to guess.`,
        'ambiguous-forward-hop': `A transfer hop on the route from ${fromChainName} to ${toChainName} has multiple open channels; refusing to guess.`,
        'invalid-request': 'Transfer route planning request was invalid.',
      };
      const message =
        (failureCode && messageByFailureCode[failureCode]) ||
        failureMessage ||
        `No IBC transfer route found from ${fromChainName} to ${toChainName}.`;
      console.error('IBC transfer route resolution failed', {
        fromChainId: dataTransfer.fromNetwork.networkId,
        toChainId: dataTransfer.toNetwork.networkId,
        failureCode,
        failureMessage: message,
        routeBuilderDetail: failureMessage,
      });
      markCardanoPrepareFailed();
      toastErrorForIntent(message);
      setRoutePreviewForIntent({
        status: 'error',
        chainIds: runtimeRouteChainIds(
          fromNetwork.networkId,
          toNetwork.networkId,
          chains,
        ),
        message,
      });
      return emptyEstData();
    }

    const liveRouteChainIds = runtimeRouteChainIds(
      fromNetwork.networkId,
      toNetwork.networkId,
      chains,
    );
    let liveRouteMessage = 'Live route found. Estimating wallet fee now.';
    if (fromNetwork.networkId === CARDANO_CHAIN_ID) {
      liveRouteMessage = buildCardanoTx
        ? 'Live route found. Building the unsigned Cardano transaction now.'
        : 'Live route found. The Cardano transaction will be built when you submit.';
    }

    setRoutePreviewForIntent({
      status: 'loading',
      chainIds: liveRouteChainIds,
      message: liveRouteMessage,
    });

    // // check token amount > 0, decimals
    // setEstData({
    //   ...initEstData,
    //   display: true,
    // });

    // estimate amount after PFM
    let estReceiveAmount = BigNumber(transferBaseAmount);
    if (chains.length > 2) {
      const feeChains = chains.slice(1, chains.length - 1);
      feeChains.forEach((chainId) => {
        const fee = getPfmFee(chainId);
        let rmAmount = estReceiveAmount
          .multipliedBy(fee)
          .dp(6, BigNumber.ROUND_HALF_CEIL);
        if (!rmAmount.isInteger()) {
          rmAmount = rmAmount.integerValue().plus(1);
        }
        estReceiveAmount = estReceiveAmount.minus(rmAmount);
      });
    }

    if (fromNetwork.networkId !== CARDANO_CHAIN_ID) {
      const senderAddress = await getAccount();
      const msg = unsignedTxTransferFromCosmos(
        chains,
        routes,
        senderAddress?.address,
        destinationAddress,
        HOUR_IN_NANOSEC,
        { amount: transferBaseAmount, denom: selectedToken.tokenId! },
      );
      try {
        const est = await estimateFee(msg);
        const estFee = est.amount[0];
        setRoutePreviewForIntent({
          status: 'ready',
          chainIds: liveRouteChainIds,
          message: 'Transfer estimate ready. You can submit the transaction.',
        });
        return {
          display: true,
          canEst: true,
          msgs: msg,
          estReceiveAmount: estReceiveAmount.toString(10),
          estFee: `${estFee.amount} ${estFee.denom.toUpperCase()}`,
          estTime: COSMOS_TRANSFER_EST_TIME,
          intentId,
        };
      } catch (e) {
        const message = getErrorMessage(
          e,
          'Unable to estimate the wallet fee for this transfer.',
        );
        setRoutePreviewForIntent({
          status: 'error',
          chainIds: liveRouteChainIds,
          message,
        });
        toastErrorForIntent(message);
        return emptyEstData();
      }
    } else {
      if (!buildCardanoTx) {
        setRoutePreviewForIntent({
          status: 'ready',
          chainIds: liveRouteChainIds,
          message:
            'Route estimate ready. The Cardano transaction will be built when you submit.',
        });
        return {
          display: true,
          canEst: true,
          msgs: [],
          estReceiveAmount: estReceiveAmount.toString(10),
          estFee: 'Built on submit',
          estTime: CARDANO_TRANSFER_EST_TIME,
          intentId,
          requiresCardanoBuild: true,
        };
      }

      try {
        const prepareStartedAt = Date.now();
        logCardanoWalletDebug('transfer:prepare:start', {
          intentId,
          walletName: connectedCardanoWalletName,
          sender: shortValue(cardanoAddress),
          destination: shortValue(destinationAddress),
          amount: transferBaseAmount,
          displayAmount: sendAmount,
          denom: shortValue(selectedToken.tokenId),
          route: liveRouteChainIds.join(' -> '),
        });

        const walletUtxosStartedAt = Date.now();
        const walletUtxos = await getCardanoWalletUtxosForBuilder(
          cardanoWallet,
        );
        logCardanoWalletDebug('transfer:walletUtxos:success', {
          walletName: connectedCardanoWalletName,
          elapsedMs: Date.now() - walletUtxosStartedAt,
          utxoCount: walletUtxos.length,
        });

        const msg = await unsignedTxTransferFromCardano(
          chains,
          routes,
          cardanoAddress || '',
          destinationAddress,
          HOUR_IN_NANOSEC,
          { amount: transferBaseAmount, denom: selectedToken.tokenId! },
          walletUtxos,
        );
        const unsignedTx = requireUnsignedCardanoTxCborHex(
          msg[0].unsignedTxCborHex,
        );
        const estFee = msg[0].feeLovelace;

        logCardanoWalletDebug('transfer:prepare:success', {
          intentId,
          walletName: connectedCardanoWalletName,
          elapsedMs: Date.now() - prepareStartedAt,
          unsignedTxLength: unsignedTx.length,
          estFeeLovelace: estFee,
        });

        setRoutePreviewForIntent({
          status: 'ready',
          chainIds: liveRouteChainIds,
          message: 'Unsigned Cardano transaction ready. You can sign it now.',
        });
        return {
          display: true,
          canEst: true,
          msgs: [unsignedTx],
          estReceiveAmount: estReceiveAmount.toString(10),
          estFee: estFee ? `${formatPrice(estFee)} lovelace` : 'See wallet',
          estTime: CARDANO_TRANSFER_EST_TIME,
          intentId,
        };
      } catch (e) {
        logCardanoWalletError('transfer:prepare:error', e, {
          intentId,
          walletName: connectedCardanoWalletName,
          sender: shortValue(cardanoAddress),
          destination: shortValue(destinationAddress),
        });
        const message = getCardanoBuildErrorMessage(e);
        markCardanoPrepareFailed();
        setRoutePreviewForIntent({
          status: 'error',
          chainIds: liveRouteChainIds,
          message,
        });
        toastErrorForIntent(message);
        return emptyEstData();
      }
    }
  };

  const canRetryCardanoPrepare =
    fromNetwork.networkId === CARDANO_CHAIN_ID &&
    lastPrepareFailed &&
    !estData.canEst &&
    !isProcessingTransfer &&
    routePreview.status !== 'loading' &&
    Boolean(fromNetwork.networkId) &&
    Boolean(toNetwork.networkId) &&
    Boolean(currentConfiguredRoute?.enabled) &&
    Boolean(selectedToken.tokenId) &&
    Boolean(destinationAddress) &&
    isPositiveBaseAmount(selectedTransferBaseAmount) &&
    isBaseAmountWithinBalance(
      selectedTransferBaseAmount,
      selectedToken.balance,
    ) &&
    !getSourceWalletMismatch() &&
    verifyAddress(destinationAddress, toNetwork.networkId?.toString());

  const handleTransferFromCardano = async (
    preparedEstData: EstimateFeeType = estData,
  ) => {
    if (
      !preparedEstData.canEst ||
      !preparedEstData.msgs[0] ||
      !isCurrentTransferIntent(preparedEstData.intentId)
    ) {
      logCardanoWalletDebug('transfer:submit:skip:not-ready', {
        walletName: connectedCardanoWalletName,
        intentId: preparedEstData.intentId,
        currentIntentId: currentTransferIntentId,
      });
      setIsProcessingTransfer(false);
      return;
    }
    setIsProcessingTransfer(true);
    const startedAt = Date.now();
    logCardanoWalletDebug('transfer:submit:start', {
      intentId: preparedEstData.intentId,
      walletName: connectedCardanoWalletName,
      sender: shortValue(cardanoAddress),
      destination: shortValue(destinationAddress),
      unsignedTxLength:
        typeof preparedEstData.msgs[0] === 'string'
          ? preparedEstData.msgs[0].length
          : undefined,
    });
    try {
      const txHash = await signAndSubmitCardanoTxWithMeshWallet(
        preparedEstData.msgs[0],
        cardanoWallet,
        connectedCardanoWalletName,
      );
      if (txHash) {
        logCardanoWalletDebug('transfer:submit:success', {
          intentId: preparedEstData.intentId,
          walletName: connectedCardanoWalletName,
          elapsedMs: Date.now() - startedAt,
          txHash: shortValue(txHash),
        });
        setLastTxHash(txHash);
        setIsSubmitted(true);
      }
    } catch (e: unknown) {
      logCardanoWalletError('transfer:submit:error', e, {
        intentId: preparedEstData.intentId,
        walletName: connectedCardanoWalletName,
        elapsedMs: Date.now() - startedAt,
      });
      const message = getCardanoWalletErrorMessage(e);
      setRoutePreview({
        status: 'error',
        chainIds: runtimeRouteChainIds(
          fromNetwork.networkId,
          toNetwork.networkId,
        ),
        message,
      });
      toast.error(message, { theme: 'colored' });
    } finally {
      setIsProcessingTransfer(false);
    }
  };

  const handleTransferFromCosmos = async () => {
    if (!estData.canEst || !isCurrentTransferIntent(estData.intentId)) {
      setEstData(initEstData);
      return;
    }
    try {
      // Cosmos
      if (cosmosChainsSupported.includes(fromNetwork.networkId!)) {
        setIsProcessingTransfer(true);
        const client = await cosmosChain.getSigningStargateClient();
        const tx = await client.signAndBroadcast(
          cosmosChain.address!,
          estData.msgs,
          'auto',
          '',
        );
        console.log(tx);
        if (tx && tx.code === 0) {
          setLastTxHash(tx.transactionHash);
          setIsSubmitted(true);
        }
      }
      setIsProcessingTransfer(false);
    } catch (e: unknown) {
      console.log(e);
      setIsProcessingTransfer(false);
      // @ts-ignore
      toast.error(e?.message?.toString() || '', { theme: 'colored' });
    }
  };

  const handleTransfer = async () => {
    if (fromNetwork.networkId === CARDANO_CHAIN_ID) {
      const requestIntentId = currentTransferIntentId;
      setIsProcessingTransfer(true);
      const preparedEstData = await calculateEst({
        intentId: requestIntentId,
        buildCardanoTx: true,
      });
      if (
        preparedEstData.intentId !== requestIntentId ||
        !isCurrentTransferIntent(requestIntentId)
      ) {
        setIsProcessingTransfer(false);
        setEstData(initEstData);
        const message =
          'Transfer details changed while preparing the transaction. Review the current form and submit again.';
        setRoutePreview({
          status: 'ready',
          chainIds: runtimeRouteChainIds(
            fromNetwork.networkId,
            toNetwork.networkId,
          ),
          message,
        });
        toast.error(message, { theme: 'colored' });
        return;
      }
      setEstData(preparedEstData);
      if (!preparedEstData.canEst || !preparedEstData.msgs[0]) {
        setIsProcessingTransfer(false);
        return;
      }
      await handleTransferFromCardano(preparedEstData);
    } else {
      await handleTransferFromCosmos();
    }
  };

  const fetchNetworkList = async () => {
    const networkListData: NetworkItemProps[] = selectableChains.map(
      (chain) => ({
        networkId: chain.chain_id,
        ibcChainId: chain.ibc_chain_id || chain.chain_id,
        networkLogo: chain?.logo_URIs?.svg || DefaultCosmosNetworkIcon.src,
        networkName: chain.chain_name,
        networkPrettyName: chain?.pretty_name,
        networkType: chain.network_type,
        networkRole: 'user',
        isDisabled: chain.status !== 'active',
        disabledReason:
          chain.status !== 'active' ? 'Unavailable in this mode' : undefined,
      }),
    );
    setNetworkList(networkListData);
  };

  const fetchTokenList = async () => {
    let tokenListData: TransferTokenItemProps[] = [];

    // Cosmos
    if (
      fromNetwork.networkId &&
      cosmosChainsSupported.includes(fromNetwork.networkId)
    ) {
      try {
        setIsFetchDataLoading(true);
        const allBalances = await cosmosChain?.getAllBalances();
        if (allBalances?.length) {
          const sourceChain = findRuntimeChain(fromNetwork.networkId);
          tokenListData =
            allBalances?.map((asset) => {
              const runtimeAsset = sourceChain?.assets?.find(
                (configuredAsset) =>
                  configuredAsset.base === asset.denom ||
                  configuredAsset.display === asset.denom,
              );
              return {
                tokenId: asset.denom,
                tokenLogo: DefaultCosmosNetworkIcon.src,
                tokenName: runtimeAsset?.name || asset.denom,
                tokenSymbol: runtimeAsset?.symbol || asset.denom,
                tokenExponent: normalizeTokenExponent(runtimeAsset?.exponent),
                balance: asset.amount,
              };
            }) || [];
        }
      } catch (error) {
        setIsFetchDataLoading(false);
      }
    }

    // Cardano
    if (fromNetwork.networkId && fromNetwork.networkId === CARDANO_CHAIN_ID) {
      try {
        setIsFetchDataLoading(true);
        if (cardanoAssets?.length) {
          const cardanoTokenList: Array<TransferTokenItemProps | null> =
            await Promise.all(
              cardanoAssets.map(
                async (asset): Promise<TransferTokenItemProps | null> => {
                  const voucherKind = getCip67VoucherKind(asset.unit);
                  if (voucherKind === 'reference_nft') {
                    return null;
                  }

                  const trace = asset.unit
                    ? await lookupCardanoAssetDenomTrace(asset.unit)
                    : null;
                  if (voucherKind === 'ft' && !trace) {
                    return null;
                  }
                  if (
                    trace?.kind === 'ibc_voucher' &&
                    !hasCompleteVoucherDisplayMetadata(trace)
                  ) {
                    return null;
                  }
                  if (hasCompleteVoucherDisplayMetadata(trace)) {
                    return {
                      tokenId: asset.unit,
                      tokenLogo: trace.logo || DefaultCardanoNetworkIcon.src,
                      tokenName: trace.displayName,
                      tokenSymbol: trace.displaySymbol,
                      tokenExponent: trace.decimals,
                      balance: asset.quantity,
                    };
                  }

                  const nativeTokenName =
                    trace?.assetId === 'lovelace'
                      ? trace.displayName
                      : asset.assetName;
                  return {
                    tokenId: asset.unit,
                    tokenLogo: DefaultCardanoNetworkIcon.src,
                    tokenName: nativeTokenName,
                    tokenSymbol: nativeTokenName,
                    tokenExponent: 0,
                    balance: asset.quantity,
                  };
                },
              ),
            );
          tokenListData = cardanoTokenList.filter(
            (token): token is TransferTokenItemProps => token !== null,
          );
        }
      } catch (error) {
        setIsFetchDataLoading(false);
      }
    }

    setTokenList(tokenListData);
    setIsFetchDataLoading(false);
  };

  useEffect(() => {
    handleResetSwapData();
    fetchNetworkList();
  }, []);

  useEffect(() => {
    const onChangeFromNetwork = async () => {
      if (
        !cosmosChain?.isWalletConnected &&
        cosmosChainsSupported.includes(fromNetwork.networkId!)
      ) {
        await cosmosChain?.connect();
      } else if (fromNetwork.networkId) {
        setTokenList([]);
        setSelectedToken({});
        setSendAmount('');
        await fetchTokenList();
      }
    };
    onChangeFromNetwork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromNetwork.networkId, cosmosChain?.isWalletConnected]);

  useEffect(() => {
    if (!fromNetwork.networkId || !toNetwork.networkId) {
      setRoutePreview(initRoutePreview);
      return;
    }

    const route = findRuntimeRoute(fromNetwork.networkId, toNetwork.networkId);
    const chainIds = runtimeRouteChainIds(
      fromNetwork.networkId,
      toNetwork.networkId,
    );
    setRoutePreview({
      status: route?.enabled ? 'ready' : 'error',
      chainIds,
      message: route?.enabled
        ? 'Configured route found. Entrypoint is route infrastructure.'
        : runtimeRouteDisabledReason(
            fromNetwork.networkId,
            toNetwork.networkId,
          ),
    });
  }, [fromNetwork.networkId, toNetwork.networkId]);

  useEffect(() => {
    setEstData(initEstData);
    if (
      isPositiveBaseAmount(selectedTransferBaseAmount) &&
      isBaseAmountWithinBalance(
        selectedTransferBaseAmount,
        selectedToken.balance,
      )
    ) {
      const requestIntentId = currentTransferIntentId;
      let isActive = true;
      const timeoutId = setTimeout(async () => {
        const nextEstData = await calculateEst({
          intentId: requestIntentId,
          buildCardanoTx: fromNetwork.networkId !== CARDANO_CHAIN_ID,
          shouldApplySideEffects: () => isActive,
        });
        if (
          isActive &&
          nextEstData.intentId === requestIntentId &&
          isCurrentTransferIntent(requestIntentId)
        ) {
          setEstData(nextEstData);
        }
      }, 500);

      return () => {
        isActive = false;
        clearTimeout(timeoutId);
      };
    }

    setEstData(initEstData);
    setLastPrepareFailed(false);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTransferIntentId]);

  const canUseCurrentEstData =
    estData.canEst && isCurrentTransferIntent(estData.intentId);
  const isPreparingTransfer = routePreview.status === 'loading';
  const transferButtonDisabled =
    (!canUseCurrentEstData && !canRetryCardanoPrepare) ||
    isProcessingTransfer ||
    isPreparingTransfer;
  const transferButtonLabel = canRetryCardanoPrepare
    ? 'Retry transfer'
    : 'Transfer';

  return isSubmitted ? (
    <TransferResult
      setIsSubmitted={setIsSubmitted}
      estReceiveAmount={estData.estReceiveAmount}
      estFee={estData.estFee}
      estTime={estData.estTime}
      lastTxHash={lastTxHash}
      resetLastTxData={resetLastTxData}
    />
  ) : (
    <>
      <StyledWrapContainer>
        <StyledTransferContainer>
          <Heading fontSize={20} lineHeight="28px" fontWeight={700}>
            Transfer
          </Heading>
          <SelectNetwork onOpenNetworkModal={onOpenNetworkModal} />
          <RoutePreview preview={routePreview} />
          <SelectToken onOpenTokenModal={onOpenTokenModal} />
          {estData.display && isCurrentTransferIntent(estData.intentId) && (
            <CalculatorBox {...estData} />
          )}
          <CustomInput
            title="Destination address"
            placeholder="Enter destination address here..."
            onChange={setDestinationAddress}
            errorMsg={validationAddress}
            disabled={isProcessingTransfer}
          />
          <StyledTransferButton
            disabled={transferButtonDisabled}
            onClick={handleTransfer}
          >
            {isProcessingTransfer || isPreparingTransfer ? (
              <Box
                display="flex"
                alignItems="center"
                justifyContent="center"
                gap="8px"
              >
                <Spinner size="sm" color="#FFFFFFCC" thickness="2px" />
                <Text fontSize={18} fontWeight={700} lineHeight="24px">
                  {isPreparingTransfer
                    ? 'Preparing transfer'
                    : 'Submitting transfer'}
                </Text>
              </Box>
            ) : (
              <Text fontSize={18} fontWeight={700} lineHeight="24px">
                {transferButtonLabel}
              </Text>
            )}
          </StyledTransferButton>
        </StyledTransferContainer>
      </StyledWrapContainer>
      <NetworkModal
        onClose={onCloseNetworkModal}
        isOpen={isOpenNetworkModal}
        networkList={networkList}
      />
      <TokenModal
        onClose={onCloseTokenModal}
        isOpen={isOpenTokenModal}
        tokenList={tokenList}
      />
    </>
  );
};

export default Transfer;
