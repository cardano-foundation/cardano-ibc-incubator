import { Box, Image, Text } from '@chakra-ui/react';
import { COLOR } from '@/styles/color';
import {
  baseAmountToDisplayAmount,
  formatPrice,
  formatTokenSymbol,
} from '@/utils/string';

import { StyledTokenItemName, StyledTokenItemWrapper } from './index.style';

export type TransferTokenItemProps = {
  tokenId?: string;
  tokenName?: string;
  tokenLogo?: string;
  tokenSymbol?: string;
  balance?: string;
  tokenExponent?: number;
  isActive?: boolean;
  onClick?: () => void;
};

export const TransferTokenItem = ({
  tokenId,
  tokenLogo,
  tokenName,
  tokenSymbol,
  balance,
  tokenExponent,
  isActive,
  onClick,
}: TransferTokenItemProps) => {
  const displayBalance = baseAmountToDisplayAmount(
    balance || '0',
    tokenExponent ?? 0,
  );

  return (
    <StyledTokenItemWrapper
      onClick={onClick}
      isActive={isActive}
      id={`${tokenId}`}
    >
      <Box display="flex" gap="16px" alignItems="center">
        <Box borderRadius="100%">
          <Image src={tokenLogo} alt={tokenName} width={30} height={30} />
        </Box>
        <Box display="block">
          <StyledTokenItemName>
            {formatTokenSymbol(tokenName || '')}
          </StyledTokenItemName>
          <Text
            fontSize={12}
            fontWeight={400}
            lineHeight="18px"
            color={COLOR.neutral_3}
          >
            {formatTokenSymbol(tokenSymbol || '')}
          </Text>
        </Box>
      </Box>
      <Box display="block" alignContent="center">
        <Text
          fontSize={14}
          fontWeight={400}
          lineHeight="20px"
          color={COLOR.neutral_3}
        >
          {formatPrice(displayBalance)}
        </Text>
      </Box>
    </StyledTokenItemWrapper>
  );
};
