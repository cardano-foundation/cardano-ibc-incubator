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
import { useWallet, useWalletList } from '@meshsdk/react';
import { UseCosmosWallet } from './UseCosmosWallet';
import CardanoWalletModal, { WalletProps } from './CardanoWalletModal';

const CARDANO_WALLET_STORAGE_KEY = 'cardano-wallet';

const getStoredCardanoWalletName = (): string | undefined => {
  const rawWallet = localStorage.getItem(CARDANO_WALLET_STORAGE_KEY);

  if (!rawWallet) {
    return undefined;
  }

  try {
    const parsedWallet = JSON.parse(rawWallet);

    if (typeof parsedWallet === 'string') {
      return parsedWallet;
    }

    if (
      parsedWallet &&
      typeof parsedWallet === 'object' &&
      typeof parsedWallet.name === 'string'
    ) {
      return parsedWallet.name;
    }
  } catch {
    return rawWallet;
  }

  return undefined;
};

export const ConnectWalletDropdown = () => {
  // cosmos wallet hook
  const {
    connect: connectCosmosWalet,
    wallet: cosmosWallet,
    status: statusCosmosWallet,
    disconnect: disconnectCosmosWallet,
  } = UseCosmosWallet();

  // cardano wallet hook
  const {
    connect: connectCardanoWallet,
    connecting: isConnectingCardanoWallet,
    connected: isCardanoWalletConnected,
    name: connectedCardanoWalletName,
    disconnect: disconnectCardanoWallet,
    error: cardanoWalletError,
  } = useWallet();
  const cardanoWallets = useWalletList();
  const [pendingCardanoWalletName, setPendingCardanoWalletName] =
    useState<string>();
  const [hasAttemptedRestore, setHasAttemptedRestore] = useState(false);

  const {
    isOpen: isOpenCardanoWalletModal,
    onOpen: onOpenCardanoWalletModal,
    onClose: onCloseCardanoWalletModal,
  } = useDisclosure();

  const walletCardano = isCardanoWalletConnected
    ? cardanoWallets.find(
        (wallet) => wallet.name === connectedCardanoWalletName,
      )
    : undefined;

  const cardanoWalletLabel =
    walletCardano?.name || connectedCardanoWalletName || undefined;

  let cardanoWalletErrorMessage: string | undefined;

  if (typeof cardanoWalletError === 'string') {
    cardanoWalletErrorMessage = cardanoWalletError;
  } else if (cardanoWalletError instanceof Error) {
    cardanoWalletErrorMessage = cardanoWalletError.message;
  }

  const handleOpenCardanoWalletModal = () => {
    onOpenCardanoWalletModal();
  };

  const handleConnectCardanoWallet = async (wallet: WalletProps) => {
    setPendingCardanoWalletName(wallet.name);
    await connectCardanoWallet(wallet.name);
  };

  const handleDisconnectCardanoWallet = async () => {
    setPendingCardanoWalletName(undefined);
    localStorage.removeItem(CARDANO_WALLET_STORAGE_KEY);
    disconnectCardanoWallet();
  };

  useEffect(() => {
    if (hasAttemptedRestore) {
      return;
    }

    setHasAttemptedRestore(true);

    const storedWalletName = getStoredCardanoWalletName();

    if (storedWalletName) {
      setPendingCardanoWalletName(storedWalletName);
      connectCardanoWallet(storedWalletName);
    }
  }, [connectCardanoWallet, hasAttemptedRestore]);

  useEffect(() => {
    if (isCardanoWalletConnected && connectedCardanoWalletName) {
      localStorage.setItem(
        CARDANO_WALLET_STORAGE_KEY,
        JSON.stringify(connectedCardanoWalletName),
      );
      setPendingCardanoWalletName(undefined);
      onCloseCardanoWalletModal();
      return;
    }

    if (pendingCardanoWalletName && !isConnectingCardanoWallet) {
      localStorage.removeItem(CARDANO_WALLET_STORAGE_KEY);
      setPendingCardanoWalletName(undefined);
    }
  }, [
    connectedCardanoWalletName,
    isCardanoWalletConnected,
    isConnectingCardanoWallet,
    onCloseCardanoWalletModal,
    pendingCardanoWalletName,
  ]);

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
          {isCardanoWalletConnected ? (
            <Image
              src={CardanoIcon}
              width={24}
              height={24}
              style={{ width: '24px', height: '24px' }}
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
                style={{ width: '24px', height: '24px' }}
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
          {cardanoWalletLabel ? (
            <>
              <Image
                src={CardanoIcon.src}
                width={24}
                height={24}
                style={{ width: '24px', height: '24px' }}
                alt="cardano-icon"
              />
              <span>{capitalizeString(cardanoWalletLabel)}</span>
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
          {cardanoWalletLabel && (
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
            onSelectWallet={handleConnectCardanoWallet}
            connectingWalletName={pendingCardanoWalletName}
            errorMessage={cardanoWalletErrorMessage}
            wallets={cardanoWallets}
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
                style={{ width: '24px', height: '24px' }}
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
