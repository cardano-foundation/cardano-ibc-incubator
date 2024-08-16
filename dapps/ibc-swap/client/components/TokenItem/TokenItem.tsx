import { Box, Image } from '@chakra-ui/react';
import EllipseIcon from '@/assets/icons/elippse.svg';
import { formatTokenSymbol } from '@/utils/string';

import {
  StyledCustomTokenItemName,
  StyledCustomTokenItemWrapper,
} from './index.styled';

export type TokenItemProps = {
  tokenName?: string;
  tokenLogo?: string;
  isActive?: boolean;
  onClick?: () => void;
  disabled?: boolean;
};

export const TokenItem = ({
  tokenName,
  tokenLogo,
  isActive,
  onClick,
  disabled,
}: TokenItemProps) => {
  return (
    <StyledCustomTokenItemWrapper
      disabled={disabled}
      onClick={onClick}
      isActive={isActive}
    >
      <Box borderRadius="100%" width={30}>
        <Image src={tokenLogo} alt={tokenName} width={30} height={30} />
      </Box>
      <StyledCustomTokenItemName>
        {formatTokenSymbol(tokenName || '')}
      </StyledCustomTokenItemName>
      <Box
        flex="1"
        display={isActive ? 'flex' : 'none'}
        justifyContent="flex-end"
        alignItems="center"
        width={8}
      >
        <Image src={EllipseIcon.src} width="8px" alt="" />
      </Box>
    </StyledCustomTokenItemWrapper>
  );
};
