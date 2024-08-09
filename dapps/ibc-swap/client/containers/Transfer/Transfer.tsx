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

const Transfer = () => {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [networkList, setNetworkList] = useState<NetworkItemProps[]>([]);
  const [tokenList, setTokenList] = useState<TransferTokenItemProps[]>([]);
  const [validationAddress, setValidationAddress] = useState<string>('');
  const {
    destinationAddress,
    sendAmount,
    setDestinationAddress,
    getDataTransfer,
    fromNetwork,
    toNetwork,
    selectedToken,
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

  const showCalculatorBox = () => {
    return (
      sendAmount && (
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
            <Text>~2 mins</Text>
          </Box>
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
                Est. Fee Return
              </Text>
            </Box>
            <Text
              fontSize={16}
              fontWeight={400}
              lineHeight="20px"
              color={COLOR.success}
            >
              0.24 ATOM
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
    console.log(`isValidAddress:`, isValidAddress);
    if (!isValidAddress) {
      setValidationAddress('Invalid address');
      return false;
    }
    return true;
  };

  const handleTransfer = async () => {
    // do verify address:
    if (!validateAddress()) {
      return;
    }
    const { chains, foundRoute, routes } = calculateTransferRoutes(
      getDataTransfer().fromNetwork.networkId!,
      getDataTransfer().toNetwork.networkId!,
      4,
    );
    if (!foundRoute) {
      console.log('route not found');
      return;
    }
    console.log(chains, routes);
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
    console.log(msg);
    // est
    const est = await estimateFee(msg);
    console.log(est);
    console.log(chains, routes);
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
      allBalances = await cosmosChain?.getAllBalances();
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
  };

  useEffect(() => {
    fetchNetworkList();
  }, []);

  useEffect(() => {
    if (fromNetwork.networkId) {
      setTokenList([]);
      fetchTokenList();
    }
  }, [fromNetwork.networkId]);

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
          <StyledTransferButton onClick={handleTransfer}>
            <Text
              fontSize={18}
              fontWeight={700}
              lineHeight="24px"
              color={COLOR.neutral_2}
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
