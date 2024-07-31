import React from 'react';
import { IoChevronDown } from 'react-icons/io5';
import Image from 'next/image';

import { Text } from '@chakra-ui/react';
import SwitchIcon from '@/assets/icons/transfer.svg';

import {
  StyledNetworkSection,
  StyledSelectBox,
  StyledSwitchNetwork,
} from './index.style';

export type SelectNetworkProps = {
  onOpenNetworkModal: () => void;
};

const SelectNetwork = ({ onOpenNetworkModal }: SelectNetworkProps) => {
  return (
    <StyledNetworkSection>
      <StyledSelectBox onClick={onOpenNetworkModal}>
        <Text fontSize={16} lineHeight="22px" fontWeight={600}>
          Select network
        </Text>
        <IoChevronDown />
      </StyledSelectBox>
      <StyledSwitchNetwork>
        <Image src={SwitchIcon} alt="switch icon" />
      </StyledSwitchNetwork>
      <StyledSelectBox onClick={onOpenNetworkModal}>
        <Text fontSize={16} lineHeight="22px" fontWeight={600}>
          Select network
        </Text>
        <IoChevronDown />
      </StyledSelectBox>
    </StyledNetworkSection>
  );
};

export default SelectNetwork;
