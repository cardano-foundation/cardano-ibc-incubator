import { COLOR } from '@/styles/color';
import { capitalizeString } from '@/utils/string';
import {
  Box,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Image,
  Text,
} from '@chakra-ui/react';
import { useWallet, useWalletList } from '@meshsdk/react';
import React from 'react';

export type WalletProps = {
  name: string;
  icon: string;
  version: string;
};

export type CardanoWalletModalProps = {
  isOpen: boolean;
  onClose: () => void;
  // eslint-disable-next-line no-unused-vars
  onChooseWallet: (wal: WalletProps) => void;
};

const CardanoWalletModal = ({
  isOpen,
  onClose,
  onChooseWallet,
}: CardanoWalletModalProps) => {
  const wallets = useWalletList();
  const { connect } = useWallet();

  const handleChooseWallet = async (wal: WalletProps) => {
    connect(wal.name);
    onChooseWallet(wal);
    localStorage.setItem('cardano-wallet', JSON.stringify(wal));
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay backdropFilter="blur(2px)" />
      <ModalContent
        backgroundColor={COLOR.neutral_5}
        borderRadius="16px"
        h="450px"
        maxW="420px"
      >
        <ModalHeader textAlign="center" fontSize="24px">
          Select your wallet
        </ModalHeader>
        <ModalCloseButton
          w="32px"
          h="32px"
          top="15px"
          right="15px"
          backgroundColor="#0E0E12"
          borderRadius="48px"
          padding="8px"
          color={COLOR.neutral_3}
        />
        <ModalBody mt="10px">
          <Box display="flex" gap="24px">
            {wallets.slice(0, 2).map((wal) => (
              <Box
                key={wal.name}
                width="50%"
                background="#FAFAFA14"
                borderRadius="14px"
                height="164px"
                _hover={{
                  border: '1px solid #2767FC',
                  background: ' #2767FC1A',
                  cursor: 'pointer',
                }}
                onClick={() => handleChooseWallet(wal)}
              >
                <Box
                  display="flex"
                  justifyContent="center"
                  alignItems="center"
                  height="100%"
                >
                  <Box>
                    <Image
                      src={wal.icon}
                      margin="0 auto"
                      width="56px"
                      height="56px"
                      alt=""
                    />
                    <Text
                      fontSize="16"
                      fontWeight="600"
                      mt="10px"
                      textAlign="center"
                    >
                      {capitalizeString(wal.name)}
                    </Text>
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
          <Box
            mt="24px"
            gap="12px"
            display="flex"
            flexDirection="column"
            // overflowY="scroll"
            maxH="200px"
          >
            {wallets.slice(2, wallets.length - 1).map((wal) => (
              <Box
                key={wal.name}
                background="#FAFAFA14"
                borderRadius="14px"
                height="48px"
                display="flex"
              >
                <Box display="flex" alignItems="center" height="100%">
                  <Image
                    src={wal.icon}
                    marginX="10px"
                    width="24px"
                    height="24px"
                    alt=""
                  />
                  <Text fontSize="16" fontWeight="600" textAlign="center">
                    {capitalizeString(wal.name)}
                  </Text>
                </Box>
              </Box>
            ))}
          </Box>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default CardanoWalletModal;
