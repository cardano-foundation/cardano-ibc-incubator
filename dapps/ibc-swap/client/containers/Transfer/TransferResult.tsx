import { useContext } from 'react';
import Image from 'next/image';

import { Box, Text } from '@chakra-ui/react';
import { COLOR } from '@/styles/color';
import RightArrowIcon from '@/assets/icons/Arrow-right.svg';
import TimerIcon from '@/assets/icons/timer.svg';
import TransferContext from '@/contexts/TransferContext';
import { formatTokenSymbol } from '@/utils/string';

import {
  StyledSwitchNetwork,
  StyledTimerBox,
  StyledTransferCalculatorBox,
  StyledTransferContainer,
  StyledTransferDetailButton,
  StyledTransferFromToBox,
  StyledWrapContainer,
} from './index.style';

type TransferResultProps = {
  // eslint-disable-next-line no-unused-vars
  setIsSubmitted: (isSubmitted: boolean) => void;
  resetLastTxData: () => void;
  estTime: string;
  estFee: string;
  lastTxHash: string;
};

export const TransferResult = ({
  setIsSubmitted,
  estTime,
  estFee,
  // eslint-disable-next-line no-unused-vars
  lastTxHash,
  resetLastTxData,
}: TransferResultProps) => {
  const { handleReset, fromNetwork, toNetwork, selectedToken, sendAmount } =
    useContext(TransferContext);

  const handleBackToTransfer = () => {
    resetLastTxData();
    handleReset();
    setIsSubmitted(false);
  };

  return (
    <StyledWrapContainer>
      <StyledTransferContainer style={{ minWidth: '492px' }}>
        <Box display="inline-grid" gap={4} position="relative" pt={4}>
          <StyledTimerBox>
            <Image width={32} height={32} src={TimerIcon} alt="timer icon" />
          </StyledTimerBox>
          <Box display="inline-grid" justifyContent="center" gap={2}>
            <Text
              textAlign="center"
              fontWeight={700}
              fontSize={20}
              lineHeight="28px"
            >
              IBC Transfer in Progress
            </Text>
            <Text
              textAlign="center"
              fontWeight={400}
              fontSize={12}
              lineHeight="18px"
              color={COLOR.neutral_2}
            >
              Your transaction is currently being processed. This may take a few
              moments. Thank you for your patience.
            </Text>
          </Box>
          <Box
            display="flex"
            position="relative"
            justifyContent="space-between"
            gap={4}
          >
            <StyledTransferFromToBox>
              <Text
                fontSize={14}
                fontWeight={600}
                lineHeight="20px"
                color={COLOR.neutral_3}
              >
                From
              </Text>
              <Text
                wordBreak="break-all"
                fontWeight={700}
                fontSize={16}
                lineHeight="22px"
              >
                {sendAmount}{' '}
                {formatTokenSymbol(selectedToken.tokenSymbol || '')}/
                {fromNetwork.networkPrettyName}
              </Text>
            </StyledTransferFromToBox>
            <StyledSwitchNetwork
              style={{ borderRadius: '100%', cursor: 'auto' }}
              _hover={{
                bgColor: COLOR.neutral_6,
              }}
            >
              <Image src={RightArrowIcon} alt="Icon" />
            </StyledSwitchNetwork>
            <StyledTransferFromToBox>
              <Text
                fontSize={14}
                fontWeight={600}
                lineHeight="20px"
                color={COLOR.neutral_3}
              >
                To
              </Text>
              <Text
                wordBreak="break-all"
                fontWeight={700}
                fontSize={16}
                lineHeight="22px"
              >
                {sendAmount}{' '}
                {formatTokenSymbol(selectedToken.tokenSymbol || '')}/
                {toNetwork.networkPrettyName}
              </Text>
            </StyledTransferFromToBox>
          </Box>
          <StyledTransferCalculatorBox>
            <Box
              alignItems="center"
              display="flex"
              justifyContent="space-between"
            >
              <Text
                fontSize={16}
                fontWeight={400}
                lineHeight="22px"
                color={COLOR.neutral_3}
              >
                Time
              </Text>
              <Text>{estTime}</Text>
            </Box>
            <Box
              alignItems="center"
              display="flex"
              justifyContent="space-between"
            >
              <Text
                fontSize={16}
                fontWeight={400}
                lineHeight="22px"
                color={COLOR.neutral_3}
              >
                Est. Fee
              </Text>
              <Text
                fontSize={16}
                fontWeight={400}
                lineHeight="20px"
                color={COLOR.success}
              >
                {estFee}
              </Text>
            </Box>
          </StyledTransferCalculatorBox>
          <Box display="inline-grid" w="100%" gap={2}>
            <StyledTransferDetailButton
              bg={COLOR.primary}
              shadow="2px 2px 3px 0px #FCFCFC66 inset"
              _hover={{
                bg: COLOR.primary,
              }}
              color={COLOR.neutral_1}
            >
              View Transaction Status
            </StyledTransferDetailButton>
            <StyledTransferDetailButton
              bg={COLOR.neutral_6}
              border="1px solid #FFFFFF0D"
              onClick={handleBackToTransfer}
              color={COLOR.neutral_1}
              _hover={{
                bg: COLOR.neutral_6,
              }}
            >
              Start a new Transfer
            </StyledTransferDetailButton>
          </Box>
        </Box>
      </StyledTransferContainer>
    </StyledWrapContainer>
  );
};
