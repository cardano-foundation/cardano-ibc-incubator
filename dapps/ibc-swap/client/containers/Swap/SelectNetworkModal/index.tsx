/* eslint-disable no-unused-vars */
import React, { useState } from 'react';
import {
  Modal,
  ModalOverlay,
  ModalHeader,
  ModalContent,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  Button,
  Box,
  Image,
} from '@chakra-ui/react';
import { COLOR } from '@/styles/color';
import SwapIcon from '@/assets/icons/swap-horizontal.svg';
import NetworkTokenBox, {
  TokenNetworkSelectedProps,
  TokenSelectedProps,
} from './NetworkTokenBox';

type SelectNetworkModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave?: ({ tokenFrom, tokenTo }: TokenNetworkSelectedProps) => void;
  selectedToken?: TokenNetworkSelectedProps;
};

const SelectNetworkModal = ({
  isOpen,
  onClose,
  onSave,
  selectedToken,
}: SelectNetworkModalProps) => {
  const [tokenFromSelected, setTokenFromSelected] =
    useState<TokenSelectedProps>();
  const [tokenToSelected, setTokenToSelected] = useState<TokenSelectedProps>();

  const handleSaveModal = () => {
    onSave?.({ tokenFrom: tokenFromSelected, tokenTo: tokenToSelected });
  };

  const handleChooseTokenFrom = ({ token, network }: TokenSelectedProps) => {
    setTokenFromSelected({ token, network });
  };

  const handleChooseTokenTo = ({ token, network }: TokenSelectedProps) => {
    setTokenToSelected({ token, network });
  };

  return (
    <Modal isCentered onClose={onClose} isOpen={isOpen}>
      <ModalOverlay backdropFilter="blur(2px)" />
      <ModalContent
        backgroundColor={COLOR.neutral_6}
        borderRadius="16px"
        padding="24px"
        gap="24px"
        h="694px"
        maxW="990px"
      >
        <ModalHeader p={0}>Select network & token</ModalHeader>
        <ModalCloseButton w="24px" h="24px" top="24px" right="24px" />
        <ModalBody p={0}>
          <Box
            h="528px"
            gap="16px"
            display="flex"
            justifyContent="space-between"
          >
            <NetworkTokenBox
              selectedToken={selectedToken}
              onChooseToken={handleChooseTokenFrom}
            />
            <Image
              src={SwapIcon.src}
              alt=""
              width="50px"
              height="50px"
              mx="-30px"
              zIndex="1000"
              mt="5px"
            />
            <NetworkTokenBox
              fromOrTo="To"
              selectedToken={selectedToken}
              onChooseToken={handleChooseTokenTo}
            />
          </Box>
        </ModalBody>
        <ModalFooter p={0}>
          <Button
            w={90}
            h={42}
            borderRadius={10}
            borderWidth={1}
            borderColor={COLOR.neutral_4}
            backgroundColor={COLOR.neutral_6}
            shadow="1px 1px 2px 0px #FCFCFC1F inset"
            p="10px 18px 10px 18px"
            mr={3}
            onClick={onClose}
            color={COLOR.neutral_1}
            fontSize={16}
            fontWeight={700}
            lineHeight="22px"
            _hover={{
              bg: COLOR.neutral_6,
            }}
          >
            Cancel
          </Button>
          <Button
            p="10px 18px 10px 18px"
            borderRadius={10}
            bg={COLOR.primary}
            shadow="2px 2px 3px 0px #FCFCFC66 inset"
            color={COLOR.neutral_1}
            fontSize={16}
            fontWeight={700}
            lineHeight="22px"
            _hover={{
              bg: COLOR.primary,
            }}
            onClick={handleSaveModal}
          >
            Save & Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default SelectNetworkModal;
