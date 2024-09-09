import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { ChainType } from '@src/types/transaction';
import { debounce } from '@src/utils/helper';
import { SearchInput } from '../SearchInput';

import {
  StyledConfirmedButton,
  StyledChainItemBox,
  StyledChainListBox,
  StyledWrapper,
} from './index.style';

type ChainListBoxProps = {
  chainList: ChainType[];
  selectedChain: ChainType | null;
  setSelectedChain: (
    // eslint-disable-next-line no-unused-vars
    transferChain: ChainType,
  ) => void;
};

export const ChainListBox = ({
  chainList,
  selectedChain,
  setSelectedChain,
}: ChainListBoxProps) => {
  const [currentTransferChain, setCurrentTransferChain] =
    useState<ChainType | null>(selectedChain);
  const [displayList, setDisplayList] = useState<ChainType[]>(chainList);

  const handleConfirmClick = () => {
    if (currentTransferChain) {
      setSelectedChain(currentTransferChain);
    }
  };

  const handleClick = (chain: ChainType) => {
    setCurrentTransferChain(chain);
  };

  const handleSearch = debounce((setCurrentList: any, searchString: string) => {
    if (chainList?.length) {
      const newList = chainList.filter((item) =>
        item?.chainName?.toLowerCase()?.includes(searchString.toLowerCase()),
      );
      setCurrentList(newList);
    }
  }, 500);

  const renderChainItem = (chain: ChainType) => {
    return (
      <StyledChainItemBox
        onClick={() => handleClick(chain)}
        display="flex"
        justifyContent="space-between"
        key={chain.chainId}
        className={
          currentTransferChain?.chainId === chain.chainId ? 'selected' : ''
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
      </StyledChainItemBox>
    );
  };

  return (
    <Box sx={StyledWrapper}>
      <Box mb={2}>
        <Box>
          <SearchInput
            placeholder="Search by Chain name, Chain name...."
            handleChangeInput={(
              e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
            ) => {
              const inputString = e.target.value;
              handleSearch(setDisplayList, inputString);
            }}
          />
        </Box>
      </Box>
      <Box>
        <StyledChainListBox>
          <Box>{displayList?.map((chain) => renderChainItem(chain))}</Box>
        </StyledChainListBox>
      </Box>
      <Box mt={2}>
        <StyledConfirmedButton
          variant="contained"
          color="primary"
          onClick={handleConfirmClick}
          disabled={selectedChain?.chainId === currentTransferChain?.chainId}
        >
          <Typography fontWeight={700}>Confirm</Typography>
        </StyledConfirmedButton>
      </Box>
    </Box>
  );
};
