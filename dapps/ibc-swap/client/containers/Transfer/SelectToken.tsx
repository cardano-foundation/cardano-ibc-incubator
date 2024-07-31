import React from 'react';
import { Box } from '@interchain-ui/react';
import { Input, Spacer, Text } from '@chakra-ui/react';
import { IoChevronDown } from 'react-icons/io5';
import { COLOR } from '@/styles/color';
import { StyledSelectTokenBox, StyledTokenSection } from './index.style';

type SelectTokenProps = {
  onOpenTokenModal: () => void;
};

const SelectToken = ({ onOpenTokenModal }: SelectTokenProps) => {
  return (
    <StyledTokenSection>
      <Box display="flex" justifyContent="space-between">
        <Text fontSize={14} lineHeight="20px" fontWeight={400}>
          Asset
        </Text>
        <Text fontSize={14} lineHeight="20px" fontWeight={600}>
          Balance: 0
        </Text>
      </Box>
      <Spacer />
      <Box
        justifyContent="space-between"
        display="flex"
        alignItems="center"
        pt="16px"
      >
        <StyledSelectTokenBox onClick={onOpenTokenModal}>
          <Text fontSize={18} lineHeight="24px" fontWeight={700}>
            Select token
          </Text>
          <IoChevronDown />
        </StyledSelectTokenBox>
        <Input
          textAlign="right"
          width="50%"
          fontSize={32}
          lineHeight="43.71px"
          fontWeight={700}
          color={COLOR.neutral_1}
          variant="unstyled"
          placeholder="0"
          _placeholder={{
            color: COLOR.neutral_3,
          }}
        />
      </Box>
    </StyledTokenSection>
  );
};

export default SelectToken;
