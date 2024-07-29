import {
  Button,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Spacer,
} from '@chakra-ui/react';
import { IoChevronDown } from 'react-icons/io5';
import Image from 'next/image';
import { COLOR } from '@/styles/color';
import PinkPlusIcon from '@/assets/icons/pink_plus.svg';
import BluePlusIcon from '@/assets/icons/blue_plus.svg';
import LogoutIcon from '@/assets/icons/Logout.svg';
import { UseCosmosWallet } from './UseCosmosWallet';

export const ConnectWalletDropdown = () => {
  const {
    connect: connectCosmosWalet,
    wallet,
    status,
    disconnect,
  } = UseCosmosWallet();

  return (
    <Menu>
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
        Connect Wallet
      </MenuButton>
      <MenuList
        maxW="216px"
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
      >
        <MenuItem
          h="42px"
          padding="9px 0px"
          gap="8px"
          color={COLOR.neutral_1}
          background={COLOR.neutral_6}
        >
          <Image src={BluePlusIcon} alt="Cardano Wallet" />
          <span>Cardano Wallet</span>
        </MenuItem>
        <MenuItem
          h="42px"
          padding="9px 0px"
          gap="8px"
          color={COLOR.neutral_1}
          background={COLOR.neutral_6}
          onClick={status === 'Connected' ? () => {} : connectCosmosWalet}
        >
          {status !== 'Connected' ? (
            <>
              <Image src={PinkPlusIcon} alt="Cosmos Wallet" />
              <span>Cosmos Wallet</span>
            </>
          ) : (
            <>
              <Image
                width={24}
                height={24}
                src={wallet?.logo?.toString() || ''}
                alt="Cosmos Wallet"
              />
              <span>{wallet?.name}</span>
              <Spacer />
              <Image
                src={LogoutIcon}
                alt="Cosmos Wallet"
                onClick={disconnect}
              />
            </>
          )}
        </MenuItem>
      </MenuList>
    </Menu>
  );
};
