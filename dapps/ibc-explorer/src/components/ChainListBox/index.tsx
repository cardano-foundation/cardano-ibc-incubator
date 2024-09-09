import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { ChainType } from '@src/types/transaction';
import { COLOR } from '@src/styles/color';
import { SearchInput } from '../SearchInput';

import {
  StyledConfirmedButton,
  StyledChainItemBox,
  StyledChainListBox,
  StyledWrapper,
  StyledSelectedLabel,
} from './index.style';

type ChainListBoxProps = {
  chainList: ChainType[];
  selectedChains: {
    transferChain: ChainType | null;
    receiveChain: ChainType | null;
  };
  setSelectedChains: (
    // eslint-disable-next-line no-unused-vars
    transferChain: ChainType,
    // eslint-disable-next-line no-unused-vars
    receiveChain: ChainType,
  ) => void;
};

export const ChainListBox = ({
  chainList,
  selectedChains,
  setSelectedChains,
}: ChainListBoxProps) => {
  const [currentTransferChain, setCurrentTransferChain] =
    useState<ChainType | null>(selectedChains.transferChain);
  const [currentReceiveChain, setCurrentReceiveChain] =
    useState<ChainType | null>(selectedChains.receiveChain);

  const handleConfirmClick = () => {
    if (!!currentTransferChain && !!currentReceiveChain) {
      setSelectedChains(currentTransferChain, currentReceiveChain);
    }
  };

  const handleClick = (chain: ChainType) => {
    if (!currentTransferChain?.chainId || !!currentReceiveChain?.chainId) {
      setCurrentTransferChain(chain);
      setCurrentReceiveChain(null);
    } else if (
      (!currentReceiveChain?.chainId &&
        currentTransferChain?.chainId !== chain.chainId) ||
      chain.chainId === 'all'
    ) {
      setCurrentReceiveChain(chain);
    }
  };

  const renderChainItem = (chain: ChainType) => {
    return (
      <StyledChainItemBox
        onClick={() => handleClick(chain)}
        display="flex"
        justifyContent="space-between"
        key={chain.chainId}
        className={
          currentTransferChain?.chainId === chain.chainId ||
          currentReceiveChain?.chainId === chain.chainId
            ? 'selected'
            : ''
        }
      >
        <Box display="flex" gap={1}>
          {chain.chainLogo && (
            <img
              src={chain.chainLogo}
              alt="chain logo"
              width={24}
              height={24}
            />
          )}
          <Typography>{chain.chainName}</Typography>
        </Box>
        <Box display="flex" gap={1}>
          {currentTransferChain?.chainId === chain.chainId && (
            <StyledSelectedLabel>
              <Typography
                fontSize={10}
                fontWeight={700}
                lineHeight="16px"
                color={COLOR.white}
              >
                Transfer
              </Typography>
            </StyledSelectedLabel>
          )}
          {currentReceiveChain?.chainId === chain.chainId && (
            <StyledSelectedLabel>
              <Typography
                fontSize={10}
                fontWeight={700}
                lineHeight="16px"
                color={COLOR.white}
              >
                Receive
              </Typography>
            </StyledSelectedLabel>
          )}
        </Box>
      </StyledChainItemBox>
    );
  };

  return (
    <Box sx={StyledWrapper}>
      <Box mb={2}>
        <Box>
          <SearchInput placeholder="Search by Chain name, Chain name...." />
        </Box>
      </Box>
      <Box>
        <StyledChainListBox>
          <Box>{chainList?.map((chain) => renderChainItem(chain))}</Box>
        </StyledChainListBox>
      </Box>
      <Box mt={2}>
        <StyledConfirmedButton
          variant="contained"
          color="primary"
          onClick={handleConfirmClick}
        >
          <Typography fontWeight={700}>Confirm</Typography>
        </StyledConfirmedButton>
      </Box>
    </Box>
  );
};
