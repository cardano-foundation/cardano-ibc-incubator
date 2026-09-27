import React, { ChangeEvent, useContext } from 'react';
import { Box, Img, Input, Spacer, Text } from '@chakra-ui/react';
import { IoChevronDown } from 'react-icons/io5';
import { COLOR } from '@/styles/color';
import { TokenAmountUnit, TokenLabel } from '@/components/TokenLabel';
import {
  tokenTransferDisabledReason,
  tokenUsesBaseUnits,
} from '@/utils/cardanoAssetPresentation';
import TransferContext from '@/contexts/TransferContext';
import {
  baseAmountToDisplayAmount,
  formatNumberInput,
  formatPrice,
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
      selectedToken.tokenExponent ?? 0,
      selectedToken.balance,
    );
    setSendAmount(displayString);
  };

  const handleOpenTokenModal = () => {
    if (!fromNetwork?.networkId) return;
    onOpenTokenModal();
  };

  const isDisabledAmountInput =
    Boolean(tokenTransferDisabledReason(selectedToken)) ||
    !fromNetwork.networkId ||
    !toNetwork.networkId;
  const displayBalance = baseAmountToDisplayAmount(
    selectedToken?.balance || '0',
    selectedToken?.tokenExponent ?? 0,
  );

  return (
    <StyledTokenSection>
      <Box display="flex" justifyContent="space-between">
        <Text fontSize={14} lineHeight="20px" fontWeight={400}>
          Asset
        </Text>
        <Text fontSize={14} lineHeight="20px" fontWeight={600}>
          Balance: {formatPrice(displayBalance) || 0.0}
          <TokenAmountUnit token={selectedToken} />
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
          style={{ minWidth: 0, flex: 1 }}
          onClick={isProcessingTransfer ? () => {} : handleOpenTokenModal}
          disabled={!fromNetwork?.networkId || isProcessingTransfer}
        >
          {selectedToken?.tokenId ? (
            <Box display="flex" minW={0}>
              <Img
                src={selectedToken?.tokenLogo}
                alt={selectedToken?.tokenName}
                flexShrink={0}
                width="32px"
                height="32px"
              />
              <Box ml="10px" minW={0} display="flex" alignItems="center">
                <Box>
                  <Text fontWeight="700" fontSize="16px" lineHeight="22px">
                    <TokenLabel token={selectedToken} />
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
          width="35%"
          aria-label={
            tokenUsesBaseUnits(selectedToken)
              ? 'Amount in base units'
              : 'Amount'
          }
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
      {selectedToken.tokenId && tokenTransferDisabledReason(selectedToken) && (
        <Text fontSize={12}>{tokenTransferDisabledReason(selectedToken)}</Text>
      )}
    </StyledTokenSection>
  );
};

export default SelectToken;
