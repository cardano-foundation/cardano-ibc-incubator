import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import HelpIcon from '@src/assets/logo/Help.svg';
import { COLOR } from '@src/styles/color';
import { TokenType } from '@src/types/transaction';
import { SearchInput } from '../SearchInput';

import {
  StyledConfirmedButton,
  StyledTokenItemBox,
  StyledTokenListBox,
  StyledWrapper,
} from './index.style';

type TokenListBoxProps = {
  tokenList: TokenType[];
  selectedToken: TokenType;
  // eslint-disable-next-line no-unused-vars
  setSelectedToken: (token: TokenType) => void;
};

export const TokenListBox = ({
  tokenList,
  selectedToken,
  setSelectedToken,
}: TokenListBoxProps) => {
  const [currentToken, setCurrentToken] = useState<TokenType>(selectedToken);

  const handleConfirmClick = () => {
    setSelectedToken(currentToken);
  };

  const renderTokenItem = (token: TokenType) => {
    return (
      <StyledTokenItemBox
        onClick={() => setCurrentToken(token)}
        display="flex"
        key={token.tokenId}
        className={currentToken?.tokenId === token.tokenId ? 'selected' : ''}
      >
        {token.tokenLogo && (
          <img src={token.tokenLogo} alt="token logo" width={24} height={24} />
        )}
        <Typography>{token.tokenDenom}</Typography>
      </StyledTokenItemBox>
    );
  };

  return (
    <Box sx={StyledWrapper}>
      <Box mb={2}>
        <Box display="flex" gap={1} alignItems="center">
          <Typography fontWeight={600} color={COLOR.neutral_3}>
            Custom IBC Tokens
          </Typography>
          <Box display="flex" alignItems="center">
            <img width={18} height={18} src={HelpIcon} alt="help" />
          </Box>
        </Box>
        <Box mt={1}>
          <SearchInput placeholder="Search by ibc/ hash" />
        </Box>
      </Box>
      <Box>
        <Typography fontWeight={600} color={COLOR.neutral_3}>
          Authed IBC Tokens
        </Typography>
        <StyledTokenListBox>
          <Box>{tokenList?.map((token) => renderTokenItem(token))}</Box>
        </StyledTokenListBox>
      </Box>
      <Box mt={2}>
        <StyledConfirmedButton
          disabled={
            !currentToken?.tokenId ||
            currentToken?.tokenId === selectedToken?.tokenId
          }
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
