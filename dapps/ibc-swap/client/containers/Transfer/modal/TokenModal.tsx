import {
  Box,
  Button,
  Divider,
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
import { TokenBox } from '../index.styled';
import { TransferTokenItem } from '@/components/TransferTokenItem/TransferTokenItem';

const TokenListData = [
  {
    tokenName: 'Cosmos Hub',
    tokenLogo:
      'https://crypto-central.io/library/uploads/Cosmos-Atom-Logo-300x300.png',
    tokenSymbol: 'ETH',
  },
  {
    tokenName: 'BitCanna',
    tokenLogo: 'https://s2.coinmarketcap.com/static/img/coins/200x200/4263.png',
    tokenSymbol: 'ETH',
  },
  {
    tokenName: 'Cosmos Hub',
    tokenLogo:
      'https://crypto-central.io/library/uploads/Cosmos-Atom-Logo-300x300.png',
    tokenSymbol: 'ETH',
  },
  {
    tokenName: 'BitCanna',
    tokenLogo: 'https://s2.coinmarketcap.com/static/img/coins/200x200/4263.png',
    tokenSymbol: 'ETH',
  },
  {
    tokenName: 'Cosmos Hub',
    tokenLogo:
      'https://crypto-central.io/library/uploads/Cosmos-Atom-Logo-300x300.png',
    tokenSymbol: 'ETH',
  },
  {
    tokenName: 'BitCanna',
    tokenLogo: 'https://s2.coinmarketcap.com/static/img/coins/200x200/4263.png',
    tokenSymbol: 'ETH',
  },
  {
    tokenName: 'Cosmos Hub',
    tokenLogo:
      'https://crypto-central.io/library/uploads/Cosmos-Atom-Logo-300x300.png',
    tokenSymbol: 'ETH',
  },
  {
    tokenName: 'BitCanna',
    tokenLogo: 'https://s2.coinmarketcap.com/static/img/coins/200x200/4263.png',
    tokenSymbol: 'ETH',
  },
  {
    tokenName: 'Cosmos Hub',
    tokenLogo:
      'https://crypto-central.io/library/uploads/Cosmos-Atom-Logo-300x300.png',
    tokenSymbol: 'ETH',
  },
  {
    tokenName: 'BitCanna',
    tokenLogo: 'https://s2.coinmarketcap.com/static/img/coins/200x200/4263.png',
    tokenSymbol: 'ETH',
  },
];

const TokenBoxComponent = () => {
  return (
    <TokenBox>
      <Box
        borderBottomWidth="1px"
        pb="16px"
        borderBottomColor={COLOR.neutral_5}
      >
        <SearchInput />
      </Box>
      <List maxH="416px" overflowY="scroll">
        <ListItem mb={4}>
          {TokenListData.map((token) => (
            <TransferTokenItem
              key={token.tokenName}
              tokenName={token.tokenName}
              tokenLogo={token.tokenLogo}
              tokenSymbol={token.tokenSymbol}
            />
          ))}
        </ListItem>
      </List>
    </TokenBox>
  );
};

export type NetworkModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const TokenModal = ({ isOpen, onClose }: NetworkModalProps) => {
  return (
    <>
      <Modal isCentered onClose={onClose} isOpen={isOpen}>
        <ModalOverlay backdropFilter="blur(2px)" />
        <ModalContent
          backgroundColor={COLOR.neutral_6}
          borderRadius="16px"
          padding="24px"
          gap="24px"
          h="670px"
          maxW="432px"
        >
          <ModalHeader p={0}>Select token</ModalHeader>
          <ModalCloseButton w="24px" h="24px" top="24px" right="24px" />
          <ModalBody p={0}>
            <Box
              h="504px"
              gap="16px"
              display="flex"
              justifyContent="space-between"
            >
              <TokenBoxComponent />
            </Box>
          </ModalBody>
          <ModalFooter p={0} display="flex" justifyContent="space-between">
            <Button
              w={184}
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
              w={184}
              h={42}
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
