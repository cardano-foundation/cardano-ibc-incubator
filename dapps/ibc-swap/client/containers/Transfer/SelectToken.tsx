import React, { ChangeEvent, useContext } from 'react';
import { Box, Img, Input, Spacer, Text } from '@chakra-ui/react';
import { IoChevronDown } from 'react-icons/io5';
import { COLOR } from '@/styles/color';
import TransferContext from '@/contexts/TransferContext';
import {
  formatNumberInput,
  formatPrice,
  formatTokenSymbol,
} from '@/utils/string';

import { StyledSelectTokenBox, StyledTokenSection } from './index.style';

type SelectTokenProps = {
  onOpenTokenModal: () => void;
};

const SelectToken = ({ onOpenTokenModal }: SelectTokenProps) => {
  const {
    selectedToken,
    fromNetwork,
    toNetwork,
    setSendAmount,
    sendAmount,
    isProcessingTransfer,
  } = useContext(TransferContext);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const inputString = event.target.value;
    const displayString = formatNumberInput(
      inputString,
      selectedToken.tokenExponent!,
      selectedToken.balance,
    );
    setSendAmount(displayString);
  };

  const handleOpenTokenModal = () => {
    if (!fromNetwork?.networkId) return;
    onOpenTokenModal();
  };

  const isDisabledAmountInput =
    !selectedToken.tokenId || !fromNetwork.networkId || !toNetwork.networkId;

  return (
    <StyledTokenSection>
      <Box display="flex" justifyContent="space-between">
        <Text fontSize={14} lineHeight="20px" fontWeight={400}>
          Asset
        </Text>
        <Text fontSize={14} lineHeight="20px" fontWeight={600}>
          Balance: {formatPrice(selectedToken?.balance) || 0.0}
        </Text>
      </Box>
      <Spacer />
      <Box
        justifyContent="space-between"
        display="flex"
        alignItems="center"
        pt="16px"
      >
        <StyledSelectTokenBox
          onClick={isProcessingTransfer ? () => {} : handleOpenTokenModal}
          disabled={!fromNetwork?.networkId || isProcessingTransfer}
        >
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
                    {formatTokenSymbol(selectedToken?.tokenName || '')}
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
          value={sendAmount}
          disabled={isDisabledAmountInput || isProcessingTransfer}
          _placeholder={{
            color: COLOR.neutral_3,
          }}
        />
      </Box>
    </StyledTokenSection>
  );
};

export default SelectToken;
