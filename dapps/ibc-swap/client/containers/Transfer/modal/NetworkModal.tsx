import { useContext } from 'react';
import Image from 'next/image';

import {
  Box,
  Button,
  Img,
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
import { NetworkList } from '@/components/NetworkList/NetworkList';
import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import SwitchIcon from '@/assets/icons/transfer.svg';
import EarchIcon from '@/assets/icons/earth.svg';
import TransferContext from '@/contexts/TransferContext';

import {
  StyledNetworkBox,
  StyledNetworkBoxHeader,
  StyledSwitchNetwork,
} from '../index.style';

const NetworkListData = [
  {
    networkId: 1,
    networkName: 'Cosmos Hub',
    networkLogo:
      'https://crypto-central.io/library/uploads/Cosmos-Atom-Logo-300x300.png',
  },
  {
    networkId: 2,
    networkName: 'BitCanna',
    networkLogo:
      'https://s2.coinmarketcap.com/static/img/coins/200x200/4263.png',
  },
  {
    networkId: 3,
    networkName: 'Cosmos Hub',
    networkLogo:
      'https://crypto-central.io/library/uploads/Cosmos-Atom-Logo-300x300.png',
  },
  {
    networkId: 4,
    networkName: 'BitCanna',
    networkLogo:
      'https://s2.coinmarketcap.com/static/img/coins/200x200/4263.png',
  },
  {
    networkId: 5,
    networkName: 'Cosmos Hub',
    networkLogo:
      'https://crypto-central.io/library/uploads/Cosmos-Atom-Logo-300x300.png',
  },
  {
    networkId: 6,
    networkName: 'BitCanna',
    networkLogo:
      'https://s2.coinmarketcap.com/static/img/coins/200x200/4263.png',
  },
  {
    networkId: 7,
    networkName: 'Cosmos Hub',
    networkLogo:
      'https://crypto-central.io/library/uploads/Cosmos-Atom-Logo-300x300.png',
  },
  {
    networkId: 8,
    networkName: 'BitCanna',
    networkLogo:
      'https://s2.coinmarketcap.com/static/img/coins/200x200/4263.png',
  },
  {
    networkId: 9,
    networkName: 'Cosmos Hub',
    networkLogo:
      'https://crypto-central.io/library/uploads/Cosmos-Atom-Logo-300x300.png',
  },
  {
    networkId: 10,
    networkName: 'BitCanna',
    networkLogo:
      'https://s2.coinmarketcap.com/static/img/coins/200x200/4263.png',
  },
];

type NetworkBoxComponentProps = {
  title?: string;
  networkList: Array<NetworkItemProps>;
  selectedNetwork: NetworkItemProps;
  // eslint-disable-next-line no-unused-vars
  onSelectNetwork: (token: NetworkItemProps) => void;
};

const NetworkBoxComponent = ({
  title,
  networkList,
  selectedNetwork,
  onSelectNetwork,
}: NetworkBoxComponentProps) => {
  return (
    <StyledNetworkBox>
      <StyledNetworkBoxHeader>
        <Text
          display="flex"
          alignItems="center"
          fontWeight={400}
          fontSize={14}
          lineHeight="20px"
          color={COLOR.neutral_2}
        >
          {title}
        </Text>
        <Box display="flex">
          <Img
            src={selectedNetwork?.networkLogo || EarchIcon.src}
            alt={selectedNetwork?.networkName || ''}
            width="32px"
            height="32px"
          />
          <Box ml="10px" display="flex" alignItems="center">
            <Box>
              <Text fontWeight="700" fontSize="16px" lineHeight="22px">
                {selectedNetwork?.networkName || 'Select Network'}
              </Text>
            </Box>
          </Box>
        </Box>
      </StyledNetworkBoxHeader>
      <Box p="16px" borderBottomWidth="1px" borderBottomColor={COLOR.neutral_5}>
        <SearchInput placeholder="Search network" />
      </Box>
      <Box maxH="368px" overflowY="scroll">
        <NetworkList
          networkList={networkList}
          networkSelected={selectedNetwork}
          onClickNetwork={onSelectNetwork}
        />
      </Box>
    </StyledNetworkBox>
  );
};

export type NetworkModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const NetworkModal = ({ isOpen, onClose }: NetworkModalProps) => {
  const {
    fromNetwork,
    toNetwork,
    setFromNetwork,
    setToNetwork,
    switchNetwork,
  } = useContext(TransferContext);

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
              <NetworkBoxComponent
                title="From"
                selectedNetwork={fromNetwork}
                onSelectNetwork={setFromNetwork}
                networkList={NetworkListData}
              />
              <StyledSwitchNetwork
                _hover={{
                  bgColor: COLOR.neutral_4,
                }}
                style={{
                  top: '15%',
                  translate: '-50% -50%',
                }}
                onClick={switchNetwork}
              >
                <Image src={SwitchIcon} alt="switch icon" />
              </StyledSwitchNetwork>
              <NetworkBoxComponent
                title="To"
                selectedNetwork={toNetwork}
                onSelectNetwork={setToNetwork}
                networkList={NetworkListData}
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
              onClick={onClose}
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
