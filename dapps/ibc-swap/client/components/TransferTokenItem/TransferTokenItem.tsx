import { Box, Image, Text } from '@chakra-ui/react';
import { COLOR } from '@/styles/color';
import { StyledTokenItemName, StyledTokenItemWrapper } from './index.style';

export type TransferTokenItemProps = {
  tokenId?: number;
  tokenName?: string;
  tokenLogo?: string;
  tokenSymbol?: string;
  isActive?: boolean;
  onClick?: () => void;
};

export const TransferTokenItem = ({
  tokenId,
  tokenLogo,
  tokenName,
  tokenSymbol,
  isActive,
  onClick,
}: TransferTokenItemProps) => {
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
          <StyledTokenItemName>{tokenName}</StyledTokenItemName>
          <Text
            fontSize={12}
            fontWeight={400}
            lineHeight="18px"
            color={COLOR.neutral_3}
          >
            {tokenSymbol}
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
          0.00
        </Text>
      </Box>
    </StyledTokenItemWrapper>
  );
};
