import React, { useContext } from 'react';
import { IoChevronDown } from 'react-icons/io5';
import Image from 'next/image';

import { Box, Img, Text } from '@chakra-ui/react';
import SwitchIcon from '@/assets/icons/transfer.svg';
import { COLOR } from '@/styles/color';
import TransferContext from '@/contexts/TransferContext';

import {
  StyledNetworkSection,
  StyledSelectBox,
  StyledSwitchNetwork,
} from './index.style';

export type SelectNetworkProps = {
  onOpenNetworkModal: () => void;
};

const SelectNetwork = ({ onOpenNetworkModal }: SelectNetworkProps) => {
  const { fromNetwork, toNetwork, switchNetwork } = useContext(TransferContext);

  return (
    <StyledNetworkSection>
      <StyledSelectBox onClick={onOpenNetworkModal}>
        {fromNetwork?.networkId ? (
          <Box display="flex">
            <Img
              src={fromNetwork?.networkLogo}
              alt={fromNetwork?.networkName}
              width="32px"
              height="32px"
            />
            <Box ml="10px" display="flex" alignItems="center">
              <Box>
                <Text fontWeight="700" fontSize="16px" lineHeight="22px">
                  {fromNetwork?.networkName || 'Select Network'}
                </Text>
              </Box>
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
          bgColor: COLOR.neutral_4,
        }}
        onClick={switchNetwork}
      >
        <Image src={SwitchIcon} alt="switch icon" />
      </StyledSwitchNetwork>
      <StyledSelectBox onClick={onOpenNetworkModal}>
        {toNetwork?.networkId ? (
          <Box display="flex">
            <Img
              src={toNetwork?.networkLogo}
              alt={toNetwork?.networkName}
              width="32px"
              height="32px"
            />
            <Box ml="10px" display="flex" alignItems="center">
              <Box>
                <Text fontWeight="700" fontSize="16px" lineHeight="22px">
                  {toNetwork?.networkName || 'Select Network'}
                </Text>
              </Box>
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
