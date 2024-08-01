import { Heading, Text, useDisclosure } from '@chakra-ui/react';
import React, { useState } from 'react';

import { COLOR } from '@/styles/color';
import CustomInput from '@/components/CustomInput';

import SelectNetwork from './SelectNetwork';
import SelectToken from './SelectToken';
import { NetworkModal } from './modal/NetworkModal';
import { TokenModal } from './modal/TokenModal';
import { TransferResult } from './TransferResult';

import {
  StyledTransferButton,
  StyledTransferContainer,
  StyledWrapContainer,
} from './index.style';

const Transfer = () => {
  const [isSubmitted, setIsSubmitted] = useState(false);

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

  return isSubmitted ? (
    <TransferResult setIsSubmitted={setIsSubmitted} />
  ) : (
    <>
      <StyledWrapContainer>
        <StyledTransferContainer>
          <Heading fontSize={20} lineHeight="28px" fontWeight={700}>
            Transfer
          </Heading>
          <SelectNetwork onOpenNetworkModal={onOpenNetworkModal} />
          <SelectToken onOpenTokenModal={onOpenTokenModal} />
          <CustomInput
            title="Destination address"
            placeholder="Enter destination address here..."
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
      <NetworkModal onClose={onCloseNetworkModal} isOpen={isOpenNetworkModal} />
      <TokenModal onClose={onCloseTokenModal} isOpen={isOpenTokenModal} />
    </>
  );
};

export default Transfer;
