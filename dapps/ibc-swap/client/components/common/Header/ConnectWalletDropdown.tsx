import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Spacer,
  useDisclosure,
} from '@chakra-ui/react';
import { IoChevronDown } from 'react-icons/io5';
import Image from 'next/image';
import { COLOR } from '@/styles/color';
import PinkPlusIcon from '@/assets/icons/pink_plus.svg';
import BluePlusIcon from '@/assets/icons/blue_plus.svg';
import CosmosIcon from '@/assets/icons/cosmos-icon.svg';
import LogoutIcon from '@/assets/icons/Logout.svg';
import CardanoIcon from '@/assets/icons/cardano.svg';
import { capitalizeString } from '@/utils/string';
import { useWallet } from '@meshsdk/react';
import { UseCosmosWallet } from './UseCosmosWallet';
import CardanoWalletModal, { WalletProps } from './CardanoWalletModal';

export const ConnectWalletDropdown = () => {
  // cosmos wallet hook
  const {
    connect: connectCosmosWalet,
    wallet: cosmosWallet,
    status: statusCosmosWallet,
    disconnect: disconnectCosmosWallet,
  } = UseCosmosWallet();

  // cardano wallet hook
  const { disconnect: disconnectCardanoWallet } = useWallet();

  const [walletCardano, setWalletCardano] = useState<WalletProps>();

  const {
    isOpen: isOpenCardanoWalletModal,
    onOpen: onOpenCardanoWalletModal,
    onClose: onCloseCardanoWalletModal,
  } = useDisclosure();

  const handleOpenCardanoWalletModal = () => {
    onOpenCardanoWalletModal();
  };

  const handleDisconnectCardanoWallet = async () => {
    setWalletCardano(undefined);
    localStorage.removeItem('cardano-wallet');
    disconnectCardanoWallet();
  };

  useEffect(() => {
    const walletConnected = localStorage?.getItem('cardano-wallet');

    if (walletConnected) {
      const cardanoWallet = JSON.parse(walletConnected);
      setWalletCardano(cardanoWallet);
    }
  }, []);

  return (
    <Menu closeOnSelect={false} closeOnBlur={false}>
      <MenuButton
        h="42px"
        color={COLOR.neutral_1}
        padding="9px 10px"
        borderRadius="10px"
        background={COLOR.neutral_6}
        boxShadow="1px 1px 2px 0px #FCFCFC1F inset"
        _hover={{ bg: COLOR.neutral_6 }}
        _expanded={{ bg: COLOR.neutral_6 }}
        as={Button}
        rightIcon={<IoChevronDown />}
      >
        <Box display="flex" flexDirection="row">
          {/* cardano */}
          {walletCardano?.icon ? (
            <Image
              src={CardanoIcon}
              width={24}
              height={24}
              alt="cardano-icon"
            />
          ) : (
            <Image src={BluePlusIcon} alt="plus-icon" />
          )}
          <>
            {/* cosmos */}
            {statusCosmosWallet !== 'Connected' ? (
              <Image src={PinkPlusIcon} alt="plus-icon" />
            ) : (
              <Image
                width={24}
                height={24}
                src={CosmosIcon}
                alt="Cosmos Wallet"
              />
            )}
          </>
        </Box>
      </MenuButton>
      <MenuList
        maxW="235px"
        maxH="300px"
        bg="white"
        shadow="1px 1px 2px 0px #FCFCFC1F inset"
        rounded="10px"
        color={COLOR.neutral_1}
        background={COLOR.neutral_6}
        boxShadow="1px 1px 2px 0px #FCFCFC1F inset"
        borderWidth={0}
        padding="9px 10px"
        borderRadius="10px"
        minW="none"
      >
        <MenuItem
          h="42px"
          padding="9px 0px"
          gap="8px"
          color={COLOR.neutral_1}
          background={COLOR.neutral_6}
          cursor="default"
        >
          {walletCardano?.name ? (
            <>
              <Image
                src={CardanoIcon.src}
                width={24}
                height={24}
                alt="cardano-icon"
              />
              <span>{capitalizeString(walletCardano?.name)}</span>
            </>
          ) : (
            <Box
              display="flex"
              gap="8px"
              onClick={handleOpenCardanoWalletModal}
              cursor="pointer"
            >
              <Image src={BluePlusIcon} alt="Cardano Wallet" />
              <span>Cardano Wallet</span>
            </Box>
          )}
          {walletCardano?.name && (
            <>
              <Spacer />
              <Box cursor="pointer">
                <Image
                  src={LogoutIcon}
                  alt="Cardano Wallet"
                  onClick={handleDisconnectCardanoWallet}
                />
              </Box>
            </>
          )}
          <CardanoWalletModal
            isOpen={isOpenCardanoWalletModal}
            onClose={onCloseCardanoWalletModal}
            onChooseWallet={(wal) => setWalletCardano(wal)}
          />
        </MenuItem>
        <MenuItem
          h="42px"
          padding="9px 0px"
          gap="8px"
          color={COLOR.neutral_1}
          background={COLOR.neutral_6}
          cursor="default"
          onClick={
            statusCosmosWallet === 'Connected' ? () => {} : connectCosmosWalet
          }
        >
          {statusCosmosWallet !== 'Connected' ? (
            <>
              <Image src={PinkPlusIcon} alt="Cosmos Wallet" />
              <span>Cosmos Wallet</span>
            </>
          ) : (
            <>
              <Image
                width={24}
                height={24}
                src={CosmosIcon}
                alt="Cosmos Wallet"
              />
              <span>{cosmosWallet?.prettyName}</span>
              <Spacer />
              <Box cursor="pointer">
                <Image
                  src={LogoutIcon}
                  alt="Cosmos Wallet"
                  onClick={() => disconnectCosmosWallet()}
                />
              </Box>
            </>
          )}
        </MenuItem>
      </MenuList>
    </Menu>
  );
};
