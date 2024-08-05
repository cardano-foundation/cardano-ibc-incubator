import React, { ChangeEvent, useContext } from 'react';
import { Box } from '@interchain-ui/react';
import { Img, Input, Spacer, Text } from '@chakra-ui/react';
import { IoChevronDown } from 'react-icons/io5';
import { COLOR } from '@/styles/color';
import TransferContext from '@/contexts/TransferContext';

import { StyledSelectTokenBox, StyledTokenSection } from './index.style';

type SelectTokenProps = {
  onOpenTokenModal: () => void;
  // eslint-disable-next-line no-unused-vars
  setSendAmount: (value: string) => void;
};

const SelectToken = ({ onOpenTokenModal, setSendAmount }: SelectTokenProps) => {
  const { selectedToken } = useContext(TransferContext);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSendAmount(event.target.value);
  };

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
          {selectedToken?.tokenId ? (
            <Box display="flex">
              <Img
                src={selectedToken?.tokenLogo}
                alt={selectedToken?.tokenName}
                width="32px"
                height="32px"
              />
              <Box ml="10px" display="flex" alignItems="center">
                <Box>
                  <Text fontWeight="700" fontSize="16px" lineHeight="22px">
                    {selectedToken?.tokenName}
                  </Text>
                </Box>
              </Box>
            </Box>
          ) : (
            <Text fontSize={18} lineHeight="24px" fontWeight={700}>
              Select token
            </Text>
          )}
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
          onChange={handleChange}
          _placeholder={{
            color: COLOR.neutral_3,
          }}
        />
      </Box>
    </StyledTokenSection>
  );
};

export default SelectToken;
