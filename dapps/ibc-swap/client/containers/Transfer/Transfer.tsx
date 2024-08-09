'use client';

import {
  Box,
  Heading,
  Img,
  Text,
  Tooltip,
  useDisclosure,
} from '@chakra-ui/react';
import React, { useContext, useEffect, useState } from 'react';
import { Coin } from 'interchain/types/codegen/cosmos/base/v1beta1/coin';
import { COLOR } from '@/styles/color';
import CustomInput from '@/components/CustomInput';
import TransferContext from '@/contexts/TransferContext';
import IBCParamsContext from '@/contexts/IBCParamsContext';
import InfoIcon from '@/assets/icons/info.svg';
import DefaultNetworkIcon from '@/assets/icons/cosmos-icon.svg';

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

import { unsignedTxTransferFromCosmos } from '@/utils/buildTransferTx';
import SelectNetwork from './SelectNetwork';
import SelectToken from './SelectToken';
import { NetworkModal } from './modal/NetworkModal';
import { TokenModal } from './modal/TokenModal';
import { TransferResult } from './TransferResult';

import {
  StyledTransferButton,
  StyledTransferCalculatorBox,
  StyledTransferContainer,
  StyledWrapContainer,
} from './index.style';

type EstimateFeeType = {
  canEst: boolean;
  msgs: any[];
  estTime: string;
  estFee: string;
};

const initEstData = {
  canEst: false,
  msgs: [],
  estFee: '--',
  estTime: '--',
};

const Transfer = () => {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [networkList, setNetworkList] = useState<NetworkItemProps[]>([]);
  const [tokenList, setTokenList] = useState<TransferTokenItemProps[]>([]);
  const [validationAddress, setValidationAddress] = useState<string>('');
  const [estData, setEstData] = useState<EstimateFeeType>(initEstData);

  const {
    destinationAddress,
    sendAmount,
    setDestinationAddress,
    getDataTransfer,
    fromNetwork,
    selectedToken,
    setSelectedToken,
    setIsLoading,
  } = useContext(TransferContext);
  const { calculateTransferRoutes } = useContext(IBCParamsContext);

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

  const cosmosChain = useCosmosChain(
    fromNetwork.networkName || defaultChainName,
  );
  const { getAccount, estimateFee } = cosmosChain;

  const calculateEst = async (): Promise<EstimateFeeType> => {
    const trySendAmount = BigInt(sendAmount);
    // do verify address:
    if (!validateAddress() || trySendAmount < 1) {
      return initEstData;
    }
    const dataTransfer = getDataTransfer();
    const { chains, foundRoute, routes } = calculateTransferRoutes(
      dataTransfer.fromNetwork.networkId!,
      dataTransfer.toNetwork.networkId!,
      4,
    );
    if (!foundRoute) {
      console.log('route not found');
      return initEstData;
    }
    // console.log(chains, routes);
    // check token amount > 0, decimals
    const senderAddress = await getAccount();
    const msg = unsignedTxTransferFromCosmos(
      chains,
      routes,
      senderAddress?.address,
      destinationAddress,
      HOUR_IN_NANOSEC,
      { amount: sendAmount, denom: selectedToken.tokenName! },
    );
    try {
      const est = await estimateFee(msg);
      const estFee = est.amount[0];
      return {
        canEst: true,
        msgs: msg,
        estFee: `${estFee.amount} ${estFee.denom.toUpperCase()}`,
        estTime: '~2 mins',
      };
    } catch (e) {
      return initEstData;
    }
  };

  const showCalculatorBox = () => {
    return (
      estData.canEst && (
        <StyledTransferCalculatorBox>
          <Box
            alignItems="center"
            display="flex"
            justifyContent="space-between"
          >
            <Box display="flex" alignItems="center" gap={2}>
              <Tooltip
                hasArrow
                label="The time spent on transaction"
                bg="#0E0E12"
                color={COLOR.neutral_1}
              >
                <Img src={InfoIcon.src} alt="info" />
              </Tooltip>
              <Text
                fontSize={16}
                fontWeight={400}
                lineHeight="22px"
                color={COLOR.neutral_3}
              >
                Time
              </Text>
            </Box>
            <Text>{estData.estTime}</Text>
          </Box>
          <Box
            alignItems="center"
            display="flex"
            justifyContent="space-between"
          >
            <Box display="flex" alignItems="center" gap={2}>
              <Tooltip
                hasArrow
                label="Fee spent for transaction"
                bg="#0E0E12"
                color={COLOR.neutral_1}
              >
                <Img src={InfoIcon.src} alt="info" />
              </Tooltip>
              <Text
                fontSize={16}
                fontWeight={400}
                lineHeight="22px"
                color={COLOR.neutral_3}
              >
                Est. Fee
              </Text>
            </Box>
            <Text
              fontSize={16}
              fontWeight={400}
              lineHeight="20px"
              color={COLOR.success}
            >
              {estData.estFee}
            </Text>
          </Box>
        </StyledTransferCalculatorBox>
      )
    );
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

  const handleTransfer = async () => {
    if (!estData.canEst) {
      return;
    }
    try {
      const client = await cosmosChain.getSigningStargateClient();
      const tx = await client.signAndBroadcast(
        cosmosChain.address!,
        estData.msgs,
        'auto',
        '',
      );
      console.log(tx);
      if (tx && tx.code === 0) {
        setIsSubmitted(true);
      }
    } catch (e) {
      // error
      console.log(e);
    }

    // send submit here
    // setIsSubmitted(true);
  };

  const fetchNetworkList = async () => {
    const networkListData: NetworkItemProps[] = allChains.map((chain) => ({
      networkId: chain.chain_id,
      networkLogo: chain?.logo_URIs?.svg || DefaultNetworkIcon.src,
      networkName: chain.chain_name,
    }));
    setNetworkList(networkListData);
  };

  const fetchTokenList = async () => {
    let allBalances: Coin[] | undefined = [];
    if (
      fromNetwork.networkName &&
      cosmosChainsSupported.includes(fromNetwork.networkName)
    ) {
      try {
        setIsLoading(true);
        allBalances = await cosmosChain?.getAllBalances();
      } catch (error) {
        setIsLoading(false);
      }
    }
    if (allBalances?.length) {
      const tokenListData: TransferTokenItemProps[] =
        allBalances?.map((asset) => ({
          tokenId: asset.denom,
          tokenLogo: DefaultNetworkIcon.src,
          tokenName: asset.denom,
          tokenSymbol: asset.denom,
          tokenExponent: 0,
          balance: asset.amount,
        })) || [];
      setTokenList(tokenListData);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchNetworkList();
  }, []);

  useEffect(() => {
    if (fromNetwork.networkId) {
      setTokenList([]);
      setSelectedToken({});
      fetchTokenList();
    }
  }, [fromNetwork.networkId]);

  useEffect(() => {
    const trySendAmount = BigInt(sendAmount);
    const checkEstData = async () => {
      await calculateEst().then(setEstData);
    };
    if (trySendAmount >= 1) {
      checkEstData();
    } else {
      setEstData(initEstData);
    }
  }, [JSON.stringify(getDataTransfer())]);

  return isSubmitted ? (
    <TransferResult setIsSubmitted={setIsSubmitted} />
  ) : (
    <>
      <StyledWrapContainer>
        <StyledTransferContainer>
          <Heading fontSize={20} lineHeight="28px" fontWeight={700}>
            Transfer
          </Heading>
          <SelectNetwork onOpenNetworkModal={onOpenNetworkModal} />
          <SelectToken onOpenTokenModal={onOpenTokenModal} />
          {showCalculatorBox()}
          <CustomInput
            title="Destination address"
            placeholder="Enter destination address here..."
            onChange={setDestinationAddress}
            errorMsg={validationAddress}
          />
          <StyledTransferButton
            disabled={!estData.canEst}
            onClick={handleTransfer}
          >
            <Text
              fontSize={18}
              fontWeight={700}
              lineHeight="24px"
              // color={COLOR.neutral_2}
            >
              Transfer
            </Text>
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
