import React, { useContext } from 'react';
import { IoChevronDown } from 'react-icons/io5';
import Image from 'next/image';

import { Box, Img, Text } from '@chakra-ui/react';
import SwitchIcon from '@/assets/icons/transfer.svg';
import { COLOR } from '@/styles/color';
import TransferContext from '@/contexts/TransferContext';

import {
  StyledNetworkName,
  StyledNetworkSection,
  StyledSelectBox,
  StyledSwitchNetwork,
} from './index.style';

export type SelectNetworkProps = {
  onOpenNetworkModal: () => void;
};

const SelectNetwork = ({ onOpenNetworkModal }: SelectNetworkProps) => {
  const { fromNetwork, toNetwork, switchNetwork, isProcessingTransfer } =
    useContext(TransferContext);

  return (
    <StyledNetworkSection>
      <StyledSelectBox
        onClick={isProcessingTransfer ? () => {} : onOpenNetworkModal}
        disabled={isProcessingTransfer}
      >
        {fromNetwork?.networkId ? (
          <Box display="flex">
            <Img
              src={fromNetwork?.networkLogo}
              alt={fromNetwork?.networkName}
              width="32px"
              height="32px"
            />
            <Box ml="10px" display="flex" alignItems="center">
              <StyledNetworkName>
                {fromNetwork?.networkPrettyName || 'Select Network'}
              </StyledNetworkName>
            </Box>
          </Box>
        ) : (
          <Text fontSize={16} lineHeight="22px" fontWeight={600}>
            Select network
          </Text>
        )}
        <IoChevronDown />
      </StyledSelectBox>
      <StyledSwitchNetwork
        _hover={{
          bgColor: isProcessingTransfer ? COLOR.neutral_6 : COLOR.neutral_4,
        }}
        onClick={isProcessingTransfer ? () => {} : switchNetwork}
        disabled={isProcessingTransfer}
      >
        <Image src={SwitchIcon} alt="switch icon" />
      </StyledSwitchNetwork>
      <StyledSelectBox
        onClick={isProcessingTransfer ? () => {} : onOpenNetworkModal}
        disabled={isProcessingTransfer}
      >
        {toNetwork?.networkId ? (
          <Box display="flex">
            <Img
              src={toNetwork?.networkLogo}
              alt={toNetwork?.networkName}
              width="32px"
              height="32px"
            />
            <Box ml="10px" display="flex" alignItems="center">
              <StyledNetworkName>
                {toNetwork?.networkPrettyName || 'Select Network'}
              </StyledNetworkName>
            </Box>
          </Box>
        ) : (
          <Text fontSize={16} lineHeight="22px" fontWeight={600}>
            Select network
          </Text>
        )}
        <IoChevronDown />
      </StyledSelectBox>
    </StyledNetworkSection>
  );
};

export default SelectNetwork;
