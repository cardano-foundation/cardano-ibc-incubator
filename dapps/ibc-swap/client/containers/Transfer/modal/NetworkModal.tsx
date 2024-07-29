import {
  Box,
  Button,
  List,
  ListItem,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
} from '@chakra-ui/react';
import { COLOR } from '@/styles/color';
import { SearchInput } from '@/components/SearchInput/InputSearch';
import { NetworkItem } from '@/components/NetworkItem/NetworkItem';
import { NetworkBox, NetworkBoxHeader } from '../index.styled';
import { NetworkList } from '@/components/NetworkList/NetworkList';

const NetworkListData = [
  {
    networkName: 'Cosmos Hub',
    networkLogo:
      'https://crypto-central.io/library/uploads/Cosmos-Atom-Logo-300x300.png',
  },
  {
    networkName: 'BitCanna',
    networkLogo:
      'https://s2.coinmarketcap.com/static/img/coins/200x200/4263.png',
  },
  {
    networkName: 'Cosmos Hub',
    networkLogo:
      'https://crypto-central.io/library/uploads/Cosmos-Atom-Logo-300x300.png',
  },
  {
    networkName: 'BitCanna',
    networkLogo:
      'https://s2.coinmarketcap.com/static/img/coins/200x200/4263.png',
  },
  {
    networkName: 'Cosmos Hub',
    networkLogo:
      'https://crypto-central.io/library/uploads/Cosmos-Atom-Logo-300x300.png',
  },
  {
    networkName: 'BitCanna',
    networkLogo:
      'https://s2.coinmarketcap.com/static/img/coins/200x200/4263.png',
  },
  {
    networkName: 'Cosmos Hub',
    networkLogo:
      'https://crypto-central.io/library/uploads/Cosmos-Atom-Logo-300x300.png',
  },
  {
    networkName: 'BitCanna',
    networkLogo:
      'https://s2.coinmarketcap.com/static/img/coins/200x200/4263.png',
  },
  {
    networkName: 'Cosmos Hub',
    networkLogo:
      'https://crypto-central.io/library/uploads/Cosmos-Atom-Logo-300x300.png',
  },
  {
    networkName: 'BitCanna',
    networkLogo:
      'https://s2.coinmarketcap.com/static/img/coins/200x200/4263.png',
  },
];

const NetworkBoxComponent = () => {
  return (
    <NetworkBox>
      <NetworkBoxHeader>From Cosmos Hub</NetworkBoxHeader>
      <Box p="16px" borderBottomWidth="1px" borderBottomColor={COLOR.neutral_5}>
        <SearchInput />
      </Box>
      <Box maxH="368px" overflowY="scroll">
        <NetworkList networkList={NetworkListData} />
      </Box>
    </NetworkBox>
  );
};

export type NetworkModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const NetworkModal = ({ isOpen, onClose }: NetworkModalProps) => {
  return (
    <>
      <Modal isCentered onClose={onClose} isOpen={isOpen}>
        <ModalOverlay backdropFilter="blur(2px)" />
        <ModalContent
          backgroundColor={COLOR.neutral_6}
          borderRadius="16px"
          padding="24px"
          gap="24px"
          h="694px"
          maxW="696px"
        >
          <ModalHeader p={0}>Select network</ModalHeader>
          <ModalCloseButton w="24px" h="24px" top="24px" right="24px" />
          <ModalBody p={0}>
            <Box
              h="528px"
              gap="16px"
              display="flex"
              justifyContent="space-between"
            >
              <NetworkBoxComponent />
              <NetworkBoxComponent />
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
            >
              Save & Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};
