import { Box, Image } from '@chakra-ui/react';
import EllipseIcon from '@/assets/icons/elippse.svg';
import {
  StyledCustomTokenItemName,
  StyledCustomTokenItemWrapper,
} from './index.styled';

export type TokenItemProps = {
  tokenName: string;
  tokenLogo: string;
  isActive: boolean;
  onClick: () => void;
};

export const TokenItem = ({
  tokenName,
  tokenLogo,
  isActive,
  onClick,
}: TokenItemProps) => {
  return (
    <StyledCustomTokenItemWrapper onClick={onClick} isActive={isActive}>
      <Box borderRadius="100%">
        <Image src={tokenLogo} alt={tokenName} width={30} height={30} />
      </Box>
      <StyledCustomTokenItemName>{tokenName}</StyledCustomTokenItemName>
      {isActive && (
        <Box
          flex="1"
          display="flex"
          justifyContent="flex-end"
          alignItems="center"
        >
          <Image src={EllipseIcon.src} width="8px" alt="" />
        </Box>
      )}
    </StyledCustomTokenItemWrapper>
  );
};
