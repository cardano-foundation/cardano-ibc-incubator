'use client';

/* global BigInt */

import { Heading, Text, useDisclosure } from '@chakra-ui/react';
import React, { useContext, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import * as CSL from '@emurgo/cardano-serialization-lib-browser';
import CustomInput from '@/components/CustomInput';
import TransferContext from '@/contexts/TransferContext';
import IBCParamsContext from '@/contexts/IBCParamsContext';
import DefaultCosmosNetworkIcon from '@/assets/icons/cosmos-icon.svg';
import DefaultCardanoNetworkIcon from '@/assets/icons/cardano.svg';

import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import { allChains } from '@/configs/customChainInfo';
import { verifyAddress } from '@/utils/address';
import { TransferTokenItemProps } from '@/components/TransferTokenItem/TransferTokenItem';
import { useCosmosChain } from '@/hooks/useCosmosChain';
import {
  cosmosChainsSupported,
  defaultChainName,
  HOUR_IN_NANOSEC,
} from '@/constants';

import {
  unsignedTxTransferFromCosmos,
  unsignedTxTransferFromCardano,
} from '@/utils/buildTransferTx';
import { planTransferRoute } from '@/apis/restapi/cardano';
import { Loading } from '@/components/Loading/Loading';
import { useAddress, useWallet } from '@meshsdk/react';
import { formatPrice } from '@/utils/string';
import { useCardanoChain } from '@/hooks/useCardanoChain';
import SwapContext from '@/contexts/SwapContext';
import BigNumber from 'bignumber.js';
import { debounce } from '@/utils/helper';
import { CARDANO_CHAIN_ID, CARDANO_IBC_CHAIN_ID } from '@/configs/runtime';
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

const Transfer = () => {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [networkList, setNetworkList] = useState<NetworkItemProps[]>([]);
  const [tokenList, setTokenList] = useState<TransferTokenItemProps[]>([]);
  const [validationAddress, setValidationAddress] = useState<string>('');
  const [estData, setEstData] = useState<EstimateFeeType>(initEstData);
  const [lastTxHash, setLastTxHash] = useState<string>('');
  const { wallet: cardanoWallet } = useWallet();

  const resetLastTxData = () => {
    setEstData(initEstData);
    setLastTxHash('');
  };

  const {
    destinationAddress,
    sendAmount,
    setDestinationAddress,
    getDataTransfer,
    fromNetwork,
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
  const cardanoAddress = useAddress();
  const cardanoAssets: CardanoAsset[] = [];
  cardano.getTotalSupply()?.forEach((asset) => {
    const assetWithName = asset as typeof asset & { assetName: string };
    cardanoAssets.push({
      quantity: assetWithName.quantity,
      assetName: assetWithName.assetName,
      unit: asset.unit,
    });
  });

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
    const trySendAmount = BigInt(sendAmount);
    // do verify address:
    if (!validateAddress() || trySendAmount < 1) {
      return initEstData;
    }
    const dataTransfer = getDataTransfer();
    const routePlan = await planTransferRoute({
      fromChainId:
        dataTransfer.fromNetwork.ibcChainId || dataTransfer.fromNetwork.networkId!,
      toChainId:
        dataTransfer.toNetwork.ibcChainId || dataTransfer.toNetwork.networkId!,
      tokenDenom: selectedToken.tokenId!,
    });

    if (!routePlan) {
      return initEstData;
    }

    const { chains, foundRoute, routes, failureCode, failureMessage } = routePlan;

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
        'missing-unwind-hop': `Token ${selectedToken.tokenName || selectedToken.tokenId} must unwind on a specific IBC hop before it can reach ${toChainName}, but that reverse hop is not currently available.`,
        'ambiguous-unwind-hop': `Token ${selectedToken.tokenName || selectedToken.tokenId} can unwind through multiple local channels on the way to ${toChainName}; refusing to guess.`,
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
      toast.error(message, { theme: 'colored', autoClose: 7000 });
      return initEstData;
    }

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
        return {
          display: true,
          canEst: true,
          msgs: msg,
          estReceiveAmount: estReceiveAmount.toString(10),
          estFee: `${estFee.amount} ${estFee.denom.toUpperCase()}`,
          estTime: '~2 mins',
        };
      } catch (e) {
        return initEstData;
      }
    } else {
      const msg = await unsignedTxTransferFromCardano(
        chains,
        routes,
        cardanoAddress || '',
        destinationAddress,
        HOUR_IN_NANOSEC,
        { amount: sendAmount, denom: selectedToken.tokenId! },
      );

      try {
        const unsignedTx = Buffer.from(msg[0].value, 'base64').toString('hex');
        const tx = CSL.Transaction.from_hex(unsignedTx);
        const estFee = tx.body().fee().to_str();

        return {
          display: true,
          canEst: true,
          msgs: [unsignedTx],
          estReceiveAmount: estReceiveAmount.toString(10),
          estFee: `${formatPrice(estFee)} lovelace`,
          estTime: '~2 mins',
        };
      } catch (e) {
        return initEstData;
      }
    }
  };

  const handleTransferFromCardano = async () => {
    if (!estData.canEst) {
      return;
    }
    try {
      const signedTx = await cardanoWallet.signTx(estData.msgs[0], true);
      const txHash = await cardanoWallet.submitTx(signedTx);
      if (txHash) {
        setLastTxHash(txHash);
        setIsSubmitted(true);
      }
    } catch (e: unknown) {
      console.log(e);
      // @ts-ignore
      toast.error(e?.message?.toString() || '', { theme: 'colored' });
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
      handleTransferFromCardano();
    } else {
      handleTransferFromCosmos();
    }
  };

  const fetchNetworkList = async () => {
    const networkListData: NetworkItemProps[] = allChains.map((chain) => ({
      networkId: chain.chain_id,
      ibcChainId: chain.ibc_chain_id || chain.chain_id,
      networkLogo: chain?.logo_URIs?.svg || DefaultCosmosNetworkIcon.src,
      networkName: chain.chain_name,
      networkPrettyName: chain?.pretty_name,
    }));
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
    if (
      fromNetwork.networkId &&
      fromNetwork.networkId === CARDANO_CHAIN_ID
    ) {
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
    setEstData(initEstData);
    const trySendAmount = BigInt(sendAmount);
    const checkEstData = async () => {
      await calculateEst().then(setEstData);
    };
    if (trySendAmount >= 1) {
      debounce(checkEstData, 500)();
    } else {
      setEstData(initEstData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(getDataTransfer())]);

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
            disabled={!estData.canEst || isProcessingTransfer}
            onClick={handleTransfer}
          >
            {isProcessingTransfer ? (
              <Loading />
            ) : (
              <Text fontSize={18} fontWeight={700} lineHeight="24px">
                Transfer
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
