import {
  Box,
  Heading,
  Img,
  Text,
  Tooltip,
  useDisclosure,
} from '@chakra-ui/react';
import React, { useState } from 'react';

import { COLOR } from '@/styles/color';
import CustomInput from '@/components/CustomInput';
import { TransferProvider } from '@/contexts/TransferContext';
import InfoIcon from '@/assets/icons/info.svg';

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
  const [sendAmount, setSendAmount] = useState<string>('');

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

  return (
    <TransferProvider>
      {isSubmitted ? (
        <TransferResult setIsSubmitted={setIsSubmitted} />
      ) : (
        <>
          <StyledWrapContainer>
            <StyledTransferContainer>
              <Heading fontSize={20} lineHeight="28px" fontWeight={700}>
                Transfer
              </Heading>
              <SelectNetwork onOpenNetworkModal={onOpenNetworkModal} />
              <SelectToken
                setSendAmount={setSendAmount}
                onOpenTokenModal={onOpenTokenModal}
              />
              {showCalculatorBox()}
              <CustomInput
                title="Destination address"
                placeholder="Enter destination address here..."
                onChange={setSendAmount}
              />
              <StyledTransferButton onClick={() => setIsSubmitted(true)}>
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
          />
          <TokenModal onClose={onCloseTokenModal} isOpen={isOpenTokenModal} />
        </>
      )}
    </TransferProvider>
  );
};

export default Transfer;
