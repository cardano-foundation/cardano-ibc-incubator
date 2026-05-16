'use client';

/* global BigInt */

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
import { verifyAddress } from '@/utils/address';
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
  planTransferRoute,
  type TransferPlanResponse,
} from '@/apis/restapi/cardano';
import { useWallet } from '@meshsdk/react';
import { formatPrice } from '@/utils/string';
import { useCardanoChain } from '@/hooks/useCardanoChain';
import { useSafeCardanoAddress } from '@/hooks/useSafeCardanoAddress';
import SwapContext from '@/contexts/SwapContext';
import BigNumber from 'bignumber.js';
import { debounce } from '@/utils/helper';
import { CARDANO_CHAIN_ID } from '@/configs/runtime';
import { signAndSubmitCardanoTxWithCip30 } from '@/utils/cardanoWalletTx';
import {
  forgetStoredCardanoWallet,
  getCardanoWalletErrorMessage,
  isCardanoWalletLockedError,
} from '@/utils/cardanoWalletStatus';
import {
  logCardanoWalletDebug,
  logCardanoWalletError,
  shortValue,
} from '@/utils/cardanoWalletDebug';
import {
  clearResumableTransfer,
  persistResumableTransfer,
  readResumableTransfer,
  type ResumableTransferRecord,
} from '@/utils/resumableTransfer';
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
  sourceChainId?: string;
  destinationChainId?: string;
  destinationAddress?: string;
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

const initEstData = {
  display: false,
  canEst: false,
  msgs: [],
  estReceiveAmount: '',
  estFee: '----',
  estTime: '----',
};

const initRoutePreview: RoutePreviewState = {
  status: 'idle',
  chainIds: [],
};

const COSMOS_TRANSFER_EST_TIME = '~2 mins';
const CARDANO_TRANSFER_EST_TIME = '~10 mins';

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

const toPlannerChainPath = (chainIds: string[]): string[] =>
  chainIds.map((chainId) => findRuntimeChain(chainId)?.ibcChainId || chainId);

const formatRouteDiagnosticsMessage = (
  routePlan: TransferPlanResponse,
  fromChainName: string,
  toChainName: string,
): string | undefined => {
  const missingHops = routePlan.routeDiagnostics?.missingHops || [];
  if (missingHops.length === 0) {
    return undefined;
  }

  const missingDescriptions = missingHops.map((hop) => {
    const from = runtimeChainLabel(hop.fromChainId);
    const to = runtimeChainLabel(hop.toChainId);
    if (hop.reason === 'no-outbound-channel') {
      return `${from} -> ${to} (no outbound live transfer channel from ${from})`;
    }

    if (hop.availableDestChainIds.length > 0) {
      const destinations = hop.availableDestChainIds
        .map(runtimeChainLabel)
        .join(', ');
      return `${from} -> ${to} (currently only reaches ${destinations})`;
    }

    return `${from} -> ${to}`;
  });

  return `No canonical transfer route exists from ${fromChainName} to ${toChainName}. Missing live IBC transfer channel${
    missingHops.length === 1 ? '' : 's'
  } for: ${missingDescriptions.join('; ')}.`;
};

const hasPositiveIntegerAmount = (value: string): boolean => {
  try {
    return BigInt(value || '0') >= BigInt(1);
  } catch {
    return false;
  }
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
    return 'Cardano transaction preparation timed out while querying the Cardano data provider. The bridge services are reachable, but Kupo/Ogmios did not answer within 10 seconds. Retry the transfer; if it keeps happening, use a faster Cardano data-provider endpoint.';
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

const networkItemFromChainId = (
  chainId?: string,
  savedNetwork?: NetworkItemProps,
): NetworkItemProps => {
  if (savedNetwork?.networkId) {
    return savedNetwork;
  }

  const chain = selectableChains.find(
    (candidate) =>
      candidate.chain_id === chainId || candidate.ibc_chain_id === chainId,
  );
  if (chain) {
    return {
      networkId: chain.chain_id,
      ibcChainId: chain.ibc_chain_id || chain.chain_id,
      networkLogo:
        chain?.logo_URIs?.svg ||
        (chain.chain_id === CARDANO_CHAIN_ID
          ? DefaultCardanoNetworkIcon.src
          : DefaultCosmosNetworkIcon.src),
      networkName: chain.chain_name,
      networkPrettyName: chain?.pretty_name,
      networkType: chain.network_type,
      networkRole: 'user',
      isDisabled: chain.status !== 'active',
      disabledReason:
        chain.status !== 'active' ? 'Unavailable in this mode' : undefined,
    };
  }

  if (!chainId) {
    return {};
  }

  return {
    networkId: chainId,
    ibcChainId: chainId,
    networkLogo:
      chainId === CARDANO_CHAIN_ID
        ? DefaultCardanoNetworkIcon.src
        : DefaultCosmosNetworkIcon.src,
    networkName: chainId,
    networkPrettyName: runtimeChainLabel(chainId),
    networkRole: 'user',
  };
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
          'Direct Cardano-to-target route discovery is not available yet.'}
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
  const [lastTransferSubmittedAt, setLastTransferSubmittedAt] =
    useState<string>('');
  const [resumeChecked, setResumeChecked] = useState(false);
  const isRestoringTransferRef = useRef(false);
  const {
    wallet: cardanoWallet,
    name: connectedCardanoWalletName,
    disconnect: disconnectCardanoWallet,
  } = useWallet();

  const resetLastTxData = () => {
    setEstData(initEstData);
    setLastPrepareFailed(false);
    setLastTxHash('');
    setLastTransferSubmittedAt('');
    clearResumableTransfer();
  };

  const {
    destinationAddress,
    sendAmount,
    setDestinationAddress,
    getDataTransfer,
    fromNetwork,
    setFromNetwork,
    toNetwork,
    setToNetwork,
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

  const getSourceWalletAddress = (sourceChainId = fromNetwork.networkId) =>
    sourceChainId === CARDANO_CHAIN_ID
      ? cardanoAddress || undefined
      : cosmosChain.address || undefined;

  const buildResumableTransferRecord = (
    sourceTxHash: string,
    submittedEstData: EstimateFeeType,
    createdAt = new Date().toISOString(),
  ): ResumableTransferRecord => ({
    version: 1,
    sourceTxHash,
    sourceChainId: fromNetwork.networkId || '',
    destinationChainId: toNetwork.networkId || '',
    sourceWalletAddress: getSourceWalletAddress(),
    destinationAddress,
    sendAmount,
    estReceiveAmount: submittedEstData.estReceiveAmount,
    estTime: submittedEstData.estTime,
    estFee: submittedEstData.estFee,
    fromNetwork,
    toNetwork,
    selectedToken,
    createdAt,
  });

  const restoreResumableTransfer = (record: ResumableTransferRecord) => {
    isRestoringTransferRef.current = true;
    const restoredFromNetwork = networkItemFromChainId(
      record.sourceChainId,
      record.fromNetwork,
    );
    const restoredToNetwork = networkItemFromChainId(
      record.destinationChainId,
      record.toNetwork,
    );

    setFromNetwork(restoredFromNetwork);
    setToNetwork(restoredToNetwork);
    setSelectedToken(record.selectedToken || {});
    setSendAmount(record.sendAmount || '');
    setDestinationAddress(record.destinationAddress || '');
    setEstData({
      display: true,
      canEst: false,
      msgs: [],
      estReceiveAmount: record.estReceiveAmount || '',
      estFee: record.estFee || '----',
      estTime:
        record.estTime ||
        (record.sourceChainId === CARDANO_CHAIN_ID
          ? CARDANO_TRANSFER_EST_TIME
          : COSMOS_TRANSFER_EST_TIME),
    });
    setLastPrepareFailed(false);
    setRoutePreview({
      status: 'ready',
      chainIds: runtimeRouteChainIds(
        record.sourceChainId,
        record.destinationChainId,
      ),
      message: 'Resumed transfer tracking from this browser.',
    });
    setLastTxHash(record.sourceTxHash);
    setLastTransferSubmittedAt(record.createdAt);
    setIsSubmitted(true);
    window.setTimeout(() => {
      isRestoringTransferRef.current = false;
    }, 0);
  };

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

  const validateAddress = () => {
    setValidationAddress('');
    if (!destinationAddress) {
      setValidationAddress('Address is required');
      return false;
    }
    const dataTransfer = getDataTransfer();
    const isValidAddress = verifyAddress(
      destinationAddress,
      dataTransfer?.toNetwork?.networkId?.toString() || undefined,
    );
    if (!isValidAddress) {
      setValidationAddress('Invalid address');
      return false;
    }
    return true;
  };

  const calculateEst = async (): Promise<EstimateFeeType> => {
    setLastPrepareFailed(false);
    const routeChainIds = runtimeRouteChainIds(
      fromNetwork.networkId,
      toNetwork.networkId,
    );
    const markCardanoPrepareFailed = () => {
      if (fromNetwork.networkId === CARDANO_CHAIN_ID) {
        setLastPrepareFailed(true);
      }
    };

    if (!fromNetwork.networkId || !toNetwork.networkId) {
      setRoutePreview(initRoutePreview);
      return initEstData;
    }

    if (!currentConfiguredRoute?.enabled) {
      setRoutePreview({
        status: 'error',
        chainIds: routeChainIds,
        message: runtimeRouteDisabledReason(
          fromNetwork.networkId,
          toNetwork.networkId,
        ),
      });
      return initEstData;
    }

    const walletMismatch = getSourceWalletMismatch();
    if (walletMismatch) {
      setRoutePreview({
        status: 'error',
        chainIds: routeChainIds,
        message: walletMismatch,
      });
      return initEstData;
    }

    // do verify address:
    if (!validateAddress() || !hasPositiveIntegerAmount(sendAmount)) {
      setRoutePreview({
        status: 'ready',
        chainIds: routeChainIds,
        message:
          'Configured route found. Enter amount and destination to estimate.',
      });
      return initEstData;
    }
    const dataTransfer = getDataTransfer();
    setRoutePreview({
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
        expectedChainPath: toPlannerChainPath(routeChainIds),
      });
    } catch (error) {
      const message = getErrorMessage(
        error,
        'Unable to load route plan from the active stack.',
      );
      markCardanoPrepareFailed();
      setRoutePreview({
        status: 'error',
        chainIds: routeChainIds,
        message,
      });
      toast.error(message, { theme: 'colored', autoClose: 7000 });
      return initEstData;
    }

    if (!routePlan) {
      markCardanoPrepareFailed();
      setRoutePreview({
        status: 'error',
        chainIds: routeChainIds,
        message: 'Unable to load route plan from the active stack.',
      });
      return initEstData;
    }

    const { chains, foundRoute, routes, failureCode, failureMessage } =
      routePlan;

    if (!foundRoute) {
      const fromChainName =
        dataTransfer.fromNetwork.networkPrettyName ||
        dataTransfer.fromNetwork.networkId ||
        dataTransfer.fromNetwork.ibcChainId ||
        'source chain';
      const toChainName =
        dataTransfer.toNetwork.networkPrettyName ||
        dataTransfer.toNetwork.networkId ||
        dataTransfer.toNetwork.ibcChainId ||
        'destination chain';
      const messageByFailureCode: Record<string, string> = {
        'channels-not-loaded':
          'IBC transfer channels have not loaded yet. Wait for channel discovery to complete and make sure the local bridge stack is running.',
        'source-chain-unavailable': `No discovered IBC transfer channels start from ${fromChainName}.`,
        'destination-chain-unavailable': `No discovered IBC transfer channels reach ${toChainName}.`,
        'no-outbound-channels': `${fromChainName} has no outbound IBC transfer channels.`,
        'no-route-found': `No IBC transfer route found from ${fromChainName} to ${toChainName}.`,
        'direct-route-unsupported':
          'Direct Cardano-to-target IBC routes are not implemented yet.',
        'missing-unwind-hop': `Token ${
          selectedToken.tokenName || selectedToken.tokenId
        } must unwind on a specific IBC hop before it can reach ${toChainName}, but that reverse hop is not currently available.`,
        'ambiguous-unwind-hop': `Token ${
          selectedToken.tokenName || selectedToken.tokenId
        } can unwind through multiple local channels on the way to ${toChainName}; refusing to guess.`,
        'no-forward-route':
          formatRouteDiagnosticsMessage(
            routePlan,
            fromChainName,
            toChainName,
          ) ||
          `No canonical transfer route exists from ${fromChainName} to ${toChainName}.`,
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
      toast.error(message, { theme: 'colored', autoClose: 7000 });
      setRoutePreview({
        status: 'error',
        chainIds: runtimeRouteChainIds(
          fromNetwork.networkId,
          toNetwork.networkId,
          chains,
        ),
        message,
      });
      return initEstData;
    }

    const liveRouteChainIds = runtimeRouteChainIds(
      fromNetwork.networkId,
      toNetwork.networkId,
      chains,
    );

    setRoutePreview({
      status: 'loading',
      chainIds: liveRouteChainIds,
      message:
        fromNetwork.networkId === CARDANO_CHAIN_ID
          ? 'Live route found. Building the unsigned Cardano transaction now.'
          : 'Live route found. Estimating wallet fee now.',
    });

    // // check token amount > 0, decimals
    // setEstData({
    //   ...initEstData,
    //   display: true,
    // });

    // estimate amount after PFM
    let estReceiveAmount = BigNumber(sendAmount);
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
        { amount: sendAmount, denom: selectedToken.tokenId! },
      );
      try {
        const est = await estimateFee(msg);
        const estFee = est.amount[0];
        setRoutePreview({
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
          sourceChainId: fromNetwork.networkId,
          destinationChainId: toNetwork.networkId,
          destinationAddress,
        };
      } catch (e) {
        const message = getErrorMessage(
          e,
          'Unable to estimate the wallet fee for this transfer.',
        );
        setRoutePreview({
          status: 'error',
          chainIds: liveRouteChainIds,
          message,
        });
        toast.error(message, { theme: 'colored', autoClose: 7000 });
        return initEstData;
      }
    } else {
      try {
        const walletUtxos = await getCardanoWalletUtxosForBuilder(
          cardanoWallet,
        );
        const msg = await unsignedTxTransferFromCardano(
          chains,
          routes,
          cardanoAddress || '',
          destinationAddress,
          HOUR_IN_NANOSEC,
          { amount: sendAmount, denom: selectedToken.tokenId! },
          walletUtxos,
        );
        const unsignedTx = requireUnsignedCardanoTxCborHex(
          msg[0].unsignedTxCborHex,
        );
        const estFee = msg[0].feeLovelace;

        setRoutePreview({
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
          sourceChainId: fromNetwork.networkId,
          destinationChainId: toNetwork.networkId,
          destinationAddress,
        };
      } catch (e) {
        const message = getCardanoBuildErrorMessage(e);
        setLastPrepareFailed(true);
        setRoutePreview({
          status: 'error',
          chainIds: liveRouteChainIds,
          message,
        });
        toast.error(message, { theme: 'colored', autoClose: 7000 });
        return initEstData;
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
    hasPositiveIntegerAmount(sendAmount) &&
    !getSourceWalletMismatch() &&
    verifyAddress(destinationAddress, toNetwork.networkId?.toString());

  const handleTransferFromCardano = async (
    preparedEstData: EstimateFeeType = estData,
  ) => {
    if (!preparedEstData.canEst) {
      return;
    }
    if (
      preparedEstData.sourceChainId !== fromNetwork.networkId ||
      preparedEstData.destinationChainId !== toNetwork.networkId ||
      preparedEstData.destinationAddress !== destinationAddress
    ) {
      const message =
        'Transfer details changed after preparation. Wait for the transfer to prepare again, then retry.';
      setEstData(initEstData);
      setRoutePreview({
        status: 'ready',
        chainIds: runtimeRouteChainIds(
          fromNetwork.networkId,
          toNetwork.networkId,
        ),
        message,
      });
      toast.error(message, { theme: 'colored', autoClose: 7000 });
      return;
    }
    const startedAt = Date.now();
    setIsProcessingTransfer(true);
    try {
      const txHash = await signAndSubmitCardanoTxWithCip30(
        preparedEstData.msgs[0],
        connectedCardanoWalletName,
      );
      if (txHash) {
        logCardanoWalletDebug('transfer:submit:success', {
          walletName: connectedCardanoWalletName,
          elapsedMs: Date.now() - startedAt,
          txHash: shortValue(txHash),
        });
        const submittedAt = new Date().toISOString();
        persistResumableTransfer(
          buildResumableTransferRecord(txHash, preparedEstData, submittedAt),
        );
        setLastTxHash(txHash);
        setLastTransferSubmittedAt(submittedAt);
        setIsSubmitted(true);
      }
    } catch (e: unknown) {
      logCardanoWalletError('transfer:submit:error', e, {
        walletName: connectedCardanoWalletName,
        elapsedMs: Date.now() - startedAt,
      });
      const message = getCardanoWalletErrorMessage(e);
      if (isCardanoWalletLockedError(e)) {
        forgetStoredCardanoWallet();
        disconnectCardanoWallet();
        setEstData(initEstData);
        setLastPrepareFailed(false);
        setRoutePreview({
          status: 'error',
          chainIds: runtimeRouteChainIds(
            fromNetwork.networkId,
            toNetwork.networkId,
          ),
          message,
        });
      }
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
    if (!estData.canEst) {
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
          const submittedAt = new Date().toISOString();
          persistResumableTransfer(
            buildResumableTransferRecord(
              tx.transactionHash,
              estData,
              submittedAt,
            ),
          );
          setLastTxHash(tx.transactionHash);
          setLastTransferSubmittedAt(submittedAt);
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
      let preparedEstData = estData;
      if (!preparedEstData.canEst && canRetryCardanoPrepare) {
        setIsProcessingTransfer(true);
        preparedEstData = await calculateEst();
        setEstData(preparedEstData);
        if (!preparedEstData.canEst) {
          setIsProcessingTransfer(false);
          return;
        }
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
    let tokenListData: TransferTokenItemProps[] | undefined = [];

    // Cosmos
    if (
      fromNetwork.networkId &&
      cosmosChainsSupported.includes(fromNetwork.networkId)
    ) {
      try {
        setIsFetchDataLoading(true);
        const allBalances = await cosmosChain?.getAllBalances();
        if (allBalances?.length) {
          tokenListData =
            allBalances?.map((asset) => ({
              tokenId: asset.denom,
              tokenLogo: DefaultCosmosNetworkIcon.src,
              tokenName: asset.denom,
              tokenSymbol: asset.denom,
              tokenExponent: 0,
              balance: asset.amount,
            })) || [];
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
          tokenListData =
            cardanoAssets?.map((asset) => ({
              tokenId: asset.unit,
              tokenLogo: DefaultCardanoNetworkIcon.src,
              tokenName: asset.assetName,
              tokenSymbol: asset.unit,
              tokenExponent: 0,
              balance: asset.quantity,
            })) || [];
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
    if (resumeChecked || isSubmitted) {
      return;
    }

    const record = readResumableTransfer();
    if (!record) {
      setResumeChecked(true);
      return;
    }

    const currentWalletAddress = getSourceWalletAddress(record.sourceChainId);
    if (
      record.sourceWalletAddress &&
      currentWalletAddress &&
      record.sourceWalletAddress !== currentWalletAddress
    ) {
      setResumeChecked(true);
      return;
    }

    restoreResumableTransfer(record);
    setResumeChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardanoAddress, cosmosChain.address, isSubmitted, resumeChecked]);

  useEffect(() => {
    if (isSubmitted || isRestoringTransferRef.current) {
      return;
    }

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
  }, [fromNetwork.networkId, cosmosChain?.isWalletConnected, isSubmitted]);

  useEffect(() => {
    if (isSubmitted || isRestoringTransferRef.current) {
      return;
    }

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
        ? 'Configured route found.'
        : runtimeRouteDisabledReason(
            fromNetwork.networkId,
            toNetwork.networkId,
          ),
    });
  }, [fromNetwork.networkId, toNetwork.networkId, isSubmitted]);

  useEffect(() => {
    if (isSubmitted || isRestoringTransferRef.current) {
      return;
    }

    setEstData(initEstData);
    const checkEstData = async () => {
      await calculateEst().then(setEstData);
    };
    if (hasPositiveIntegerAmount(sendAmount)) {
      debounce(checkEstData, 500)();
    } else {
      setEstData(initEstData);
      setLastPrepareFailed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(getDataTransfer()), isSubmitted]);

  const isPreparingTransfer = routePreview.status === 'loading';
  const transferButtonDisabled =
    (!estData.canEst && !canRetryCardanoPrepare) ||
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
      submittedAt={lastTransferSubmittedAt}
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
          {estData.display && <CalculatorBox {...estData} />}
          <CustomInput
            title="Destination address"
            placeholder="Enter destination address here..."
            value={destinationAddress}
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
