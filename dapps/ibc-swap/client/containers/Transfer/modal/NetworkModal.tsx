import { useContext, useEffect, useState } from 'react';
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
import { debounce } from '@/utils/helper';

import {
  StyledNetworkBox,
  StyledNetworkBoxHeader,
  StyledSwitchNetwork,
} from '../index.style';

type NetworkBoxComponentProps = {
  title?: string;
  networkList: Array<NetworkItemProps>;
  selectedNetwork: NetworkItemProps;
  // eslint-disable-next-line no-unused-vars
  onSelectNetwork: (token: NetworkItemProps) => void;
  // eslint-disable-next-line no-unused-vars
  onSearch?: (event: any) => void;
};

const NetworkBoxComponent = ({
  title,
  networkList,
  selectedNetwork,
  onSelectNetwork,
  onSearch,
}: NetworkBoxComponentProps) => {
  return (
    <StyledNetworkBox isActive={!!selectedNetwork?.networkId}>
      <StyledNetworkBoxHeader isActive={!!selectedNetwork?.networkId}>
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
                {selectedNetwork?.networkPrettyName || 'Select Network'}
              </Text>
            </Box>
          </Box>
        </Box>
      </StyledNetworkBoxHeader>
      <Box p="16px" borderBottomWidth="1px" borderBottomColor={COLOR.neutral_5}>
        <SearchInput placeholder="Search network" onChange={onSearch} />
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
  networkList: NetworkItemProps[];
};

export const NetworkModal = ({
  isOpen,
  onClose,
  networkList,
}: NetworkModalProps) => {
  const { fromNetwork, toNetwork, setFromNetwork, setToNetwork } =
    useContext(TransferContext);

  const [currentFromNetwork, setCurrentFromNetwork] =
    useState<NetworkItemProps>(fromNetwork);
  const [currentToNetwork, setCurrentToNetwork] =
    useState<NetworkItemProps>(toNetwork);
  const [toNetworkList, setToNetworkList] = useState<NetworkItemProps[]>([]);
  const [fromNetworkList, setFromNetworkList] =
    useState<NetworkItemProps[]>(networkList);

  const handleSelectFromNetwork = (network: NetworkItemProps) => {
    const newToNetworkList = networkList.filter(
      (networkItem) => networkItem.networkId !== network.networkId,
    );
    setToNetworkList(newToNetworkList);
    setCurrentFromNetwork(network);
    setCurrentToNetwork({});
  };

  const HandleSwitchNetwork = () => {
    const newToNetwork = currentFromNetwork;
    const newFromNetwork = currentToNetwork;
    setCurrentToNetwork(newToNetwork);
    handleSelectFromNetwork(newFromNetwork);
  };

  const handleSave = () => {
    setFromNetwork(currentFromNetwork);
    setToNetwork(currentToNetwork);
    onClose();
  };

  const handleClose = () => {
    setCurrentFromNetwork(fromNetwork);
    setCurrentToNetwork(toNetwork);
    onClose();
  };

  const handleSearch = debounce(
    (setCurrentList: any, searchString: string, isToNetWorkList?: boolean) => {
      if (networkList?.length) {
        let newList = networkList.filter((item) =>
          item?.networkPrettyName
            ?.toLowerCase()
            ?.includes(searchString.toLowerCase()),
        );
        if (isToNetWorkList) {
          newList = newList.filter(
            (item) => item.networkId !== currentFromNetwork.networkId,
          );
        }
        setCurrentList(newList);
      }
    },
    500,
  );

  useEffect(() => {
    if (fromNetwork) {
      handleSelectFromNetwork(fromNetwork);
    }
    if (toNetwork) {
      setCurrentToNetwork(toNetwork);
    }
  }, [fromNetwork, toNetwork]);

  useEffect(() => {
    if (networkList.length) {
      setFromNetworkList(networkList);
    }
  }, [networkList]);

  return (
    <>
      <Modal isCentered onClose={handleClose} isOpen={isOpen}>
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
                selectedNetwork={currentFromNetwork}
                onSelectNetwork={handleSelectFromNetwork}
                networkList={fromNetworkList}
                onSearch={(e: any) => {
                  const searchString = e.target.value;
                  handleSearch(setFromNetworkList, searchString, false);
                }}
              />
              <StyledSwitchNetwork
                _hover={{
                  bgColor: COLOR.neutral_4,
                }}
                style={{
                  top: '15%',
                  translate: '-50% -50%',
                }}
                onClick={HandleSwitchNetwork}
              >
                <Image src={SwitchIcon} alt="switch icon" />
              </StyledSwitchNetwork>
              <NetworkBoxComponent
                title="To"
                selectedNetwork={currentToNetwork}
                onSelectNetwork={setCurrentToNetwork}
                networkList={toNetworkList}
                onSearch={(e: any) => {
                  const searchString = e.target.value;
                  handleSearch(setToNetworkList, searchString, true);
                }}
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
              onClick={handleClose}
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
              onClick={handleSave}
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
