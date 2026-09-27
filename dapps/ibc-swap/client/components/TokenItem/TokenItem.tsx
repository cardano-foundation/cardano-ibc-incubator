import { Box, Image, Text } from '@chakra-ui/react';
import EllipseIcon from '@/assets/icons/elippse.svg';
import { TokenLabel } from '@/components/TokenLabel';
import { shortAssetId } from '@/utils/cardanoAssetPresentation';
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
  tokenName,
  tokenLogo,
  tokenId,
  tokenSymbol,
  tokenDescription,
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
      <Box borderRadius="100%" width={30} flexShrink={0}>
        <Image src={tokenLogo} alt={tokenName} width={30} height={30} />
      </Box>
      <Box minW={0} flex={1}>
        <StyledCustomTokenItemName noOfLines={1} textAlign="left">
          <TokenLabel
            token={{ tokenId, tokenName, tokenSymbol, tokenDescription }}
            showName
          />
        </StyledCustomTokenItemName>
        <Text fontSize={12} noOfLines={1}>
          <TokenLabel
            token={{ tokenId, tokenName, tokenSymbol, tokenDescription }}
          />
          {' · '}
          {shortAssetId(tokenId || '')}
        </Text>
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
