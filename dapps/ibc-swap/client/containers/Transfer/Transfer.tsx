import { Heading, Input, Text, useDisclosure } from '@chakra-ui/react';
import React from 'react';
import {
  WrapContainer,
  TransferContainer,
  AddressInput,
  TransferButton,
} from './index.styled';
import SelectNetwork from './SelectNetwork';
import SelectToken from './SelectToken';
import { COLOR } from '@/styles/color';
import { NetworkModal } from './modal/NetworkModal';
import { TokenModal } from './modal/TokenModal';

const Transfer = () => {
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

  return (
    <>
      <WrapContainer>
        <TransferContainer>
          <Heading fontSize={20} lineHeight="28px" fontWeight={700}>
            Transfer
          </Heading>
          <SelectNetwork onOpenNetworkModal={onOpenNetworkModal} />
          <SelectToken onOpenTokenModal={onOpenTokenModal} />
          <AddressInput>
            <Text
              color={COLOR.neutral_3}
              fontSize={12}
              fontWeight={400}
              lineHeight="18px"
            >
              Destination address
            </Text>
            <Input
              variant="unstyled"
              placeholder="Enter destination address here..."
              color={COLOR.neutral_1}
              fontSize={16}
              fontWeight={400}
              lineHeight="22px"
              _placeholder={{
                color: COLOR.neutral_2,
              }}
            />
          </AddressInput>
          <TransferButton>
            <Text
              fontSize={18}
              fontWeight={700}
              lineHeight="24px"
              color={COLOR.neutral_2}
            >
              Transfer
            </Text>
          </TransferButton>
        </TransferContainer>
      </WrapContainer>
      <NetworkModal onClose={onCloseNetworkModal} isOpen={isOpenNetworkModal} />
      <TokenModal onClose={onCloseTokenModal} isOpen={isOpenTokenModal} />
    </>
  );
};

export default Transfer;
