import { useEffect, useRef, useState } from 'react';
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
import {
  CARDANO_WALLET_STORAGE_KEY,
  forgetStoredCardanoWallet,
  getCardanoWalletErrorMessage,
  isCardanoWalletLockedError,
} from '@/utils/cardanoWalletStatus';
import { useWallet, useWalletList } from '@meshsdk/react';
import { UseCosmosWallet } from './UseCosmosWallet';
import CardanoWalletModal, { WalletProps } from './CardanoWalletModal';

const readStoredCardanoWalletName = () => {
  if (typeof window === 'undefined') return undefined;

  const storedValue = localStorage.getItem(CARDANO_WALLET_STORAGE_KEY);
  if (!storedValue) return undefined;

  try {
    const parsedValue = JSON.parse(storedValue);
    return typeof parsedValue === 'string' ? parsedValue : undefined;
  } catch {
    return storedValue;
  }
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
  const [localCardanoWalletErrorMessage, setLocalCardanoWalletErrorMessage] =
    useState<string>();
  const attemptedCardanoReconnectRef = useRef(false);
  const handledCardanoWalletErrorRef = useRef<unknown>();

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

  const cardanoWalletErrorMessage = localCardanoWalletErrorMessage;

  const handleOpenCardanoWalletModal = () => {
    setLocalCardanoWalletErrorMessage(undefined);
    onOpenCardanoWalletModal();
  };

  const handleConnectCardanoWallet = async (wallet: WalletProps) => {
    setPendingCardanoWalletName(wallet.name);
    setLocalCardanoWalletErrorMessage(undefined);
    handledCardanoWalletErrorRef.current = cardanoWalletError;
    try {
      await connectCardanoWallet(wallet.name);
    } catch (error) {
      setPendingCardanoWalletName(undefined);
      setLocalCardanoWalletErrorMessage(getCardanoWalletErrorMessage(error));
      if (isCardanoWalletLockedError(error)) {
        onOpenCardanoWalletModal();
      }
    }
  };

  const handleDisconnectCardanoWallet = async () => {
    setPendingCardanoWalletName(undefined);
    setLocalCardanoWalletErrorMessage(undefined);
    forgetStoredCardanoWallet();
    disconnectCardanoWallet();
  };

  useEffect(() => {
    if (!cardanoWalletError) return;
    if (handledCardanoWalletErrorRef.current === cardanoWalletError) return;
    handledCardanoWalletErrorRef.current = cardanoWalletError;

    const message = getCardanoWalletErrorMessage(cardanoWalletError);
    setLocalCardanoWalletErrorMessage(message);
    setPendingCardanoWalletName(undefined);

    if (isCardanoWalletLockedError(cardanoWalletError)) {
      onOpenCardanoWalletModal();
    }
  }, [cardanoWalletError, onOpenCardanoWalletModal]);

  useEffect(() => {
    if (isCardanoWalletConnected && connectedCardanoWalletName) {
      localStorage.setItem(
        CARDANO_WALLET_STORAGE_KEY,
        JSON.stringify(connectedCardanoWalletName),
      );
      setLocalCardanoWalletErrorMessage(undefined);
      setPendingCardanoWalletName(undefined);
      onCloseCardanoWalletModal();
      return;
    }

    if (pendingCardanoWalletName && !isConnectingCardanoWallet) {
      setPendingCardanoWalletName(undefined);
    }
  }, [
    connectedCardanoWalletName,
    isCardanoWalletConnected,
    isConnectingCardanoWallet,
    onCloseCardanoWalletModal,
    pendingCardanoWalletName,
  ]);

  useEffect(() => {
    if (
      attemptedCardanoReconnectRef.current ||
      isCardanoWalletConnected ||
      isConnectingCardanoWallet ||
      cardanoWallets.length === 0
    ) {
      return undefined;
    }

    const storedWalletName = readStoredCardanoWalletName();
    if (!storedWalletName) return undefined;

    const installedWallet = cardanoWallets.find(
      (wallet) => wallet.name.toLowerCase() === storedWalletName.toLowerCase(),
    );
    if (!installedWallet) return undefined;

    attemptedCardanoReconnectRef.current = true;
    let cancelled = false;

    const reconnectCardanoWallet = async () => {
      try {
        setPendingCardanoWalletName(installedWallet.name);
        await connectCardanoWallet(installedWallet.name);
      } catch {
        if (!cancelled) {
          setPendingCardanoWalletName(undefined);
        }
      }
    };

    reconnectCardanoWallet();

    return () => {
      cancelled = true;
    };
  }, [
    cardanoWallets,
    connectCardanoWallet,
    isCardanoWalletConnected,
    isConnectingCardanoWallet,
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
