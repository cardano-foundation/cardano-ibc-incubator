import { Box, Image, Text } from '@chakra-ui/react';
import { TokenAmountUnit, TokenLabel } from '@/components/TokenLabel';
import {
  shortAssetId,
  tokenSecondaryLabel,
  tokenTransferDisabledReason,
} from '@/utils/cardanoAssetPresentation';
import type { TokenPresentation } from '@/types/token';
import { COLOR } from '@/styles/color';
import { baseAmountToDisplayAmount, formatPrice } from '@/utils/string';

import { StyledTokenItemName, StyledTokenItemWrapper } from './index.style';

export type TransferTokenItemProps = TokenPresentation & {
  isActive?: boolean;
  onClick?: () => void;
};

export const TransferTokenItem = ({
  isActive,
  onClick,
  ...token
}: TransferTokenItemProps) => {
  const { tokenId, tokenLogo, tokenName, balance, tokenExponent } = token;
  const disabledReason = tokenTransferDisabledReason(token);
  const displayBalance = baseAmountToDisplayAmount(
    balance || '0',
    tokenExponent ?? 0,
  );

  return (
    <StyledTokenItemWrapper
      onClick={disabledReason ? undefined : onClick}
      aria-disabled={Boolean(disabledReason)}
      title={disabledReason}
      isActive={isActive}
      id={`${tokenId}`}
    >
      <Box display="flex" gap="16px" alignItems="center" minW={0}>
        <Box borderRadius="100%" flexShrink={0}>
          <Image src={tokenLogo} alt={tokenName} width={30} height={30} />
        </Box>
        <Box display="block" minW={0}>
          <StyledTokenItemName>
            <TokenLabel token={token} />
          </StyledTokenItemName>
          <Text
            fontSize={12}
            fontWeight={400}
            lineHeight="18px"
            color={COLOR.neutral_3}
            noOfLines={1}
          >
            {tokenSecondaryLabel(token)}
            {tokenSecondaryLabel(token) && ' · '}
            {shortAssetId(tokenId || '')}
          </Text>
          {disabledReason && <Text fontSize={12}>{disabledReason}</Text>}
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
          <TokenAmountUnit token={token} />
        </Text>
      </Box>
    </StyledTokenItemWrapper>
  );
};
