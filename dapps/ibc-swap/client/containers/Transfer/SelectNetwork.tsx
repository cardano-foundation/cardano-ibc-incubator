import { Text } from '@chakra-ui/react';
import React from 'react';
import { IoChevronDown } from 'react-icons/io5';
import Image from 'next/image';
import SwitchIcon from '@/assets/icons/transfer.svg';

import { NetworkSection, SelectBox, SwitchNetwork } from './index.styled';

export type SelectNetworkProps = {
  onOpenNetworkModal: () => void;
};

const SelectNetwork = ({ onOpenNetworkModal }: SelectNetworkProps) => {
  return (
    <NetworkSection>
      <SelectBox onClick={onOpenNetworkModal}>
        <Text fontSize={16} lineHeight="22px" fontWeight={600}>
          Select network
        </Text>
        <IoChevronDown />
      </SelectBox>
      <SwitchNetwork>
        <Image src={SwitchIcon} alt="switch icon" />
      </SwitchNetwork>
      <SelectBox onClick={onOpenNetworkModal}>
        <Text fontSize={16} lineHeight="22px" fontWeight={600}>
          Select network
        </Text>
        <IoChevronDown />
      </SelectBox>
    </NetworkSection>
  );
};

export default SelectNetwork;
