'use client';

/* global BigInt */

import { Box, Heading, Spinner, Text, useDisclosure } from '@chakra-ui/react';
import React, { useContext, useEffect, useState } from 'react';
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
  unsignedTxTransferFromCosmos,
  unsignedTxTransferFromCardano,
} from '@/utils/buildTransferTx';
import { planTransferRoute } from '@/apis/restapi/cardano';
import { useWallet } from '@meshsdk/react';
import { formatPrice } from '@/utils/string';
import { useCardanoChain } from '@/hooks/useCardanoChain';
import { useSafeCardanoAddress } from '@/hooks/useSafeCardanoAddress';
import SwapContext from '@/contexts/SwapContext';
import BigNumber from 'bignumber.js';
import { debounce } from '@/utils/helper';
import { CARDANO_CHAIN_ID } from '@/configs/runtime';
import { signAndSubmitCardanoTxWithCip30 } from '@/utils/cardanoWalletTx';
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

const hasPositiveIntegerAmount = (value: string): boolean => {
  try {
    return BigInt(value || '0') >= BigInt(1);
  } catch {
    return false;
  }
};

const decodeUnsignedCardanoTx = (base64Value: unknown): string => {
  if (typeof base64Value !== 'string' || !base64Value.trim()) {
    throw new Error(
      'Cardano transfer builder returned an unsigned tx with an empty payload.',
    );
  }

  const unsignedTx = Buffer.from(base64Value, 'base64').toString('utf8').trim();
  if (
    !unsignedTx ||
    unsignedTx.length % 2 !== 0 ||
    /[^0-9a-f]/i.test(unsignedTx)
  ) {
    throw new Error(
      'Cardano transfer builder returned an unsigned tx payload that is not hex-encoded transaction CBOR.',
    );
  }

  return unsignedTx;
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
        'blocked-channel': `A required IBC channel from ${fromChainName} to ${toChainName} is blocked by pending packets. Wait for the relayer to clear or time out the earlier packet, then retry.`,
        'invalid-request': 'Transfer route planning request was invalid.',
      };
      const message =
        failureMessage ||
        (failureCode && messageByFailureCode[failureCode]) ||
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
        const prepareStartedAt = Date.now();
        logCardanoWalletDebug('transfer:prepare:start', {
          walletName: connectedCardanoWalletName,
          sender: shortValue(cardanoAddress),
          destination: shortValue(destinationAddress),
          amount: sendAmount,
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
          { amount: sendAmount, denom: selectedToken.tokenId! },
          walletUtxos,
        );
        const unsignedTx = decodeUnsignedCardanoTx(msg[0].value);
        const estFee = msg[0].feeLovelace;

        logCardanoWalletDebug('transfer:prepare:success', {
          walletName: connectedCardanoWalletName,
          elapsedMs: Date.now() - prepareStartedAt,
          unsignedTxLength: unsignedTx.length,
          estFeeLovelace: estFee,
        });

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
        };
      } catch (e) {
        logCardanoWalletError('transfer:prepare:error', e, {
          walletName: connectedCardanoWalletName,
          sender: shortValue(cardanoAddress),
          destination: shortValue(destinationAddress),
        });
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
      logCardanoWalletDebug('transfer:submit:skip:not-ready', {
        walletName: connectedCardanoWalletName,
      });
      return;
    }
    setIsProcessingTransfer(true);
    const startedAt = Date.now();
    logCardanoWalletDebug('transfer:submit:start', {
      walletName: connectedCardanoWalletName,
      sender: shortValue(cardanoAddress),
      destination: shortValue(destinationAddress),
      unsignedTxLength:
        typeof preparedEstData.msgs[0] === 'string'
          ? preparedEstData.msgs[0].length
          : undefined,
    });
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
        setLastTxHash(txHash);
        setIsSubmitted(true);
      }
    } catch (e: unknown) {
      logCardanoWalletError('transfer:submit:error', e, {
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
  }, [JSON.stringify(getDataTransfer())]);

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
