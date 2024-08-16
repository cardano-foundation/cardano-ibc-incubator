import { COLOR } from '@/styles/color';
import { capitalizeString } from '@/utils/string';
import {
  Box,
  Image,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Text,
} from '@chakra-ui/react';
import { ChainWalletBase, WalletModalProps } from 'cosmos-kit';
import { toast } from 'react-toastify';

export const CosmosWalletModal = ({
  isOpen,
  setOpen,
  walletRepo,
}: WalletModalProps) => {
  const onCloseModal = () => {
    setOpen(false);
  };

  const handleChooseWallet = async (wallet: ChainWalletBase) => {
    if (wallet?.mutable?.state === 'Error') {
      toast.error(wallet?.mutable?.message?.toString() || '', {
        theme: 'colored',
      });
      return;
    }
    try {
      await wallet.connect(true);
      setOpen(false);
    } catch (error) {
      console.log(error);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onCloseModal}>
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
            {walletRepo?.wallets.slice(0, 2).map((wallet) => (
              <Box
                key={wallet.walletPrettyName}
                width="50%"
                background="#FAFAFA14"
                borderRadius="14px"
                height="164px"
                _hover={{
                  border: '1px solid #2767FC',
                  background: ' #2767FC1A',
                  cursor: 'pointer',
                }}
                onClick={() => handleChooseWallet(wallet)}
              >
                <Box
                  display="flex"
                  justifyContent="center"
                  alignItems="center"
                  height="100%"
                >
                  <Box>
                    <Image
                      src={wallet.walletInfo.logo as string}
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
                      {capitalizeString(wallet.walletPrettyName)}
                    </Text>
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
          <Box
            mt="24px"
            gap="8px"
            display="flex"
            flexDirection="column"
            overflowY="scroll"
            maxH="160px"
            style={{
              scrollbarWidth: 'none',
            }}
          >
            {walletRepo?.wallets.slice(2).map((wallet) => (
              <Box
                key={wallet.walletPrettyName}
                background="#FAFAFA14"
                borderRadius="12px"
                height="48px"
                display="flex"
                onClick={() => handleChooseWallet(wallet)}
                padding="12px"
                _hover={{
                  border: '1px solid #2767FC',
                  background: ' #2767FC1A',
                  cursor: 'pointer',
                }}
              >
                <Box display="flex" alignItems="center" height="100%">
                  <Image
                    src={wallet.walletInfo?.logo as string}
                    marginX="10px"
                    width="24px"
                    height="24px"
                    alt=""
                  />
                  <Text
                    fontSize="14"
                    fontWeight="700"
                    lineHeight="20px"
                    textAlign="center"
                  >
                    {capitalizeString(wallet.walletPrettyName)}
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
