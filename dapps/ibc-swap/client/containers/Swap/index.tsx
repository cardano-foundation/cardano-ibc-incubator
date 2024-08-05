import React, { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Heading,
  Image,
  useDisclosure,
} from '@chakra-ui/react';

import SwitchIcon from '@/assets/icons/transfer.svg';
import TokenBox from '@/components/TokenBox';
import CustomInput from '@/components/CustomInput';

import { COLOR } from '@/styles/color';
import TransactionFee from './TransactionFee';
import SettingSlippage from './SettingSlippage';

import { TokenNetworkSelectedProps } from './SelectNetworkModal/NetworkTokenBox';
import SelectNetworkModal from './SelectNetworkModal';

import StyledSwap, { StyledSwitchNetwork } from './index.style';

const SwapContainer = () => {
  const [isCheckedAnotherWallet, setIsCheckAnotherWallet] =
    useState<boolean>(false);
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [tokenSelected, setTokenSelected] =
    useState<TokenNetworkSelectedProps>();

  const handleSaveModal = ({
    tokenFrom,
    tokenTo,
  }: TokenNetworkSelectedProps) => {
    setTokenSelected({ tokenFrom, tokenTo });
    onClose();
  };

  const openModalSelectNetwork = () => {
    onOpen();
  };

  const handleChangePositionToken = () => {
    setTokenSelected({
      tokenFrom: tokenSelected?.tokenTo,
      tokenTo: tokenSelected?.tokenFrom,
    });
  };

  return (
    <StyledSwap>
      <Box display="flex" justifyContent="space-between">
        <Heading className="title">Swap</Heading>
        <SettingSlippage />
      </Box>
      <SelectNetworkModal
        isOpen={isOpen}
        onClose={onClose}
        onSave={handleSaveModal}
        selectedToken={tokenSelected}
      />
      <TokenBox
        handleClick={openModalSelectNetwork}
        token={tokenSelected?.tokenFrom}
      />
      <StyledSwitchNetwork
        _hover={{
          bgColor: COLOR.neutral_4,
        }}
        onClick={handleChangePositionToken}
      >
        <Image src={SwitchIcon.src} alt="" />
      </StyledSwitchNetwork>
      <TokenBox
        fromOrTo="To"
        handleClick={openModalSelectNetwork}
        token={tokenSelected?.tokenTo}
      />
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
