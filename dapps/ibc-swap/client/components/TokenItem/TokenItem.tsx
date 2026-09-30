import { Box, Image, Text } from '@chakra-ui/react';
import EllipseIcon from '@/assets/icons/elippse.svg';
import { TokenLabel } from '@/components/TokenLabel';
import {
  shortAssetId,
  tokenSecondaryLabel,
  tokenTransferDisabledReason,
} from '@/utils/cardanoAssetPresentation';
import type { TokenPresentation } from '@/types/token';

import {
  StyledCustomTokenItemName,
  StyledCustomTokenItemWrapper,
} from './index.styled';

export type TokenItemProps = TokenPresentation & {
  isActive?: boolean;
  onClick?: () => void;
  disabled?: boolean;
};

export const TokenItem = ({
  isActive,
  onClick,
  disabled,
  ...token
}: TokenItemProps) => {
  const { tokenId, tokenName, tokenLogo } = token;
  const disabledReason = tokenTransferDisabledReason(token);
  const isDisabled = disabled || Boolean(disabledReason);
  return (
    <StyledCustomTokenItemWrapper
      disabled={isDisabled}
      aria-disabled={isDisabled}
      title={disabledReason}
      onClick={isDisabled ? undefined : onClick}
      isActive={isActive}
    >
      <Box borderRadius="100%" width={30} flexShrink={0}>
        <Image src={tokenLogo} alt={tokenName} width={30} height={30} />
      </Box>
      <Box minW={0} flex={1}>
        <StyledCustomTokenItemName textAlign="left">
          <TokenLabel token={token} />
        </StyledCustomTokenItemName>
        <Text fontSize={12} noOfLines={1}>
          {tokenSecondaryLabel(token)}
          {tokenSecondaryLabel(token) && ' · '}
          {shortAssetId(tokenId || '')}
        </Text>
        {disabledReason && <Text fontSize={12}>{disabledReason}</Text>}
      </Box>
      <Box
        flexShrink={0}
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
