import React, { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Heading,
  Image,
  useDisclosure,
} from '@chakra-ui/react';

import SwapIcon from '@/assets/icons/swap.svg';
import TokenBox from '@/components/TokenBox';
import CustomInput from '@/components/CustomInput';

import TransactionFee from './TransactionFee';
import SettingSlippage from './SettingSlippage';

import StyledSwap from './index.style';
import SelectNetworkModal from './SelectNetworkModal';

const SwapContainer = () => {
  const [isCheckedAnotherWallet, setIsCheckAnotherWallet] =
    useState<boolean>(false);
  const { isOpen, onOpen, onClose } = useDisclosure();

  const openModalSelectNetwork = () => {
    onOpen();
  };

  return (
    <StyledSwap>
      <Box display="flex" justifyContent="space-between">
        <Heading className="title">Swap</Heading>
        <SettingSlippage />
      </Box>
      <SelectNetworkModal isOpen={isOpen} onClose={onClose} />
      <TokenBox handleClick={openModalSelectNetwork} />
      <Box>
        <Image className="swap-icon" src={SwapIcon.src} alt="" />
      </Box>
      <TokenBox handleClick={openModalSelectNetwork} />
      <TransactionFee />
      <Checkbox
        isChecked={isCheckedAnotherWallet}
        onChange={(e) => setIsCheckAnotherWallet(e.target.checked)}
        size="md"
        mt="15px"
      >
        Receive to another wallet
      </Checkbox>
      {isCheckedAnotherWallet && (
        <CustomInput
          title="Destination address"
          placeholder="Enter destination address here..."
        />
      )}

      <Button className="swap-button">Swap</Button>
    </StyledSwap>
  );
};

export default SwapContainer;
