import { Box, Image, Text } from '@chakra-ui/react';
import { TokenLabel } from '@/components/TokenLabel';
import { shortAssetId } from '@/utils/cardanoAssetPresentation';
import type { TokenPresentation } from '@/types/token';
import { COLOR } from '@/styles/color';
import { baseAmountToDisplayAmount, formatPrice } from '@/utils/string';

import { StyledTokenItemName, StyledTokenItemWrapper } from './index.style';

export type TransferTokenItemProps = TokenPresentation & {
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
  tokenDescription,
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
      <Box display="flex" gap="16px" alignItems="center" minW={0}>
        <Box borderRadius="100%" flexShrink={0}>
          <Image src={tokenLogo} alt={tokenName} width={30} height={30} />
        </Box>
        <Box display="block" minW={0}>
          <StyledTokenItemName noOfLines={1}>
            <TokenLabel
              token={{ tokenId, tokenName, tokenSymbol, tokenDescription }}
              showName
            />
          </StyledTokenItemName>
          <Text
            fontSize={12}
            fontWeight={400}
            lineHeight="18px"
            color={COLOR.neutral_3}
            noOfLines={1}
          >
            <TokenLabel
              token={{ tokenId, tokenName, tokenSymbol, tokenDescription }}
            />
            {' · '}
            {shortAssetId(tokenId || '')}
          </Text>
        </Box>
      </Box>
      <Box display="block" alignContent="center" flexShrink={0}>
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
