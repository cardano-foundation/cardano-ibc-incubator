import React, { useState } from 'react';
import { Box, Button, Checkbox, Heading, Image } from '@chakra-ui/react';

import SwapIcon from '@/assets/icons/swap.svg';
import TokenBox from '@/components/TokenBox';
import CustomInput from '@/components/CustomInput';

import TransactionFee from './TransactionFee';
import SettingSlippage from './SettingSlippage';

import StyledSwap from './index.style';

const SwapContainer = () => {
  const [isCheckedAnotherWallet, setIsCheckAnotherWallet] =
    useState<boolean>(false);

  return (
    <StyledSwap>
      <Box display="flex" justifyContent="space-between">
        <Heading className="title">Swap</Heading>
        <SettingSlippage />
      </Box>
      <TokenBox />
      <Box>
        <Image className="swap-icon" src={SwapIcon.src} alt="" />
      </Box>
      <TokenBox />
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
