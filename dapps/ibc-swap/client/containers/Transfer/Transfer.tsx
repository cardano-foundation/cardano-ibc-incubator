import {
  Box,
  Heading,
  Img,
  Text,
  Tooltip,
  useDisclosure,
} from '@chakra-ui/react';
import React, { useContext, useEffect, useState } from 'react';

import { COLOR } from '@/styles/color';
import CustomInput from '@/components/CustomInput';
import TransferContext from '@/contexts/TransferContext';
import InfoIcon from '@/assets/icons/info.svg';
import DefaultNetworkIcon from '@/assets/icons/cosmos-icon.svg';

import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import { allChains, customChainassets } from '@/configs/customChainInfo';
import { verifyAddress } from '@/utils/address';
import { TransferTokenItemProps } from '@/components/TransferTokenItem/TransferTokenItem';
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
  const {
    destinationAddress,
    sendAmount,
    setDestinationAddress,
    getDataTransfer,
    fromNetwork,
    toNetwork,
  } = useContext(TransferContext);

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

  const handleTransfer = () => {
    // do verify address:
    const isValidAddress = verifyAddress(
      destinationAddress,
      toNetwork?.networkId?.toString() || undefined,
    );
    console.log(`isValidAddress:`, isValidAddress);

    console.log(getDataTransfer());
    setIsSubmitted(true);
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
    const tokenListFrom = customChainassets.find(
      (assetList) => assetList.chain_name === fromNetwork.networkName,
    )?.assets;
    const tokenListTo = customChainassets.find(
      (assetList) => assetList.chain_name === toNetwork.networkName,
    )?.assets;
    const tokenListData: TransferTokenItemProps[] =
      tokenListFrom
        ?.filter((asset) => tokenListTo?.includes(asset))
        ?.map((asset) => ({
          tokenId: asset.base,
          tokenLogo: asset.logo_URIs?.svg || DefaultNetworkIcon.src,
          tokenName: asset.name,
          tokenSymbol: asset.symbol,
          tokenExponent: asset.denom_units?.[0]?.exponent,
        })) || [];
    setTokenList(tokenListData);
  };

  useEffect(() => {
    fetchNetworkList();
  }, []);

  useEffect(() => {
    if (!!fromNetwork.networkId && !!toNetwork.networkId) {
      fetchTokenList();
    }
  }, [fromNetwork.networkId, toNetwork.networkId]);

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
        chainName={fromNetwork?.networkName}
      />
    </>
  );
};

export default Transfer;
