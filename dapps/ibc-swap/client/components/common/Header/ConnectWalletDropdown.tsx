import { Button, Menu, MenuButton, MenuItem, MenuList } from '@chakra-ui/react';
import { IoChevronDown } from 'react-icons/io5';
import Image from 'next/image';
import { COLOR } from '@/styles/color';
import PinkPlusIcon from '@/assets/icons/pink_plus.svg';
import BluePlusIcon from '@/assets/icons/blue_plus.svg';
import { UseCosmosWallet } from './UseCosmosWallet';

export const ConnectWalletDropdown = () => {
  const { connect: connectCosmosWalet, username } = UseCosmosWallet();

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
          onClick={connectCosmosWalet}
        >
          <Image src={PinkPlusIcon} alt="Cosmos Wallet" />
          <span>{username || 'Cosmos Wallet'}</span>
        </MenuItem>
      </MenuList>
    </Menu>
  );
};
