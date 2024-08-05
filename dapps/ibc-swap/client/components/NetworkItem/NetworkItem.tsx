import { Box, Image } from '@chakra-ui/react';
import EllipseIcon from '@/assets/icons/elippse.svg';
import { StyledNetworkItemName, StyledNetworkItemWrapper } from './index.style';

export type NetworkItemProps = {
  networkId?: number;
  networkName?: string;
  networkLogo?: string;
  isActive?: boolean;
  onClick?: () => void;
};

export const NetworkItem = ({
  networkId,
  networkName,
  networkLogo,
  isActive,
  onClick,
}: NetworkItemProps) => {
  return (
    <StyledNetworkItemWrapper
      onClick={onClick}
      isActive={isActive}
      id={`${networkId}`}
    >
      <Box borderRadius="100%">
        <Image src={networkLogo} alt={networkName} width={30} height={30} />
      </Box>
      <StyledNetworkItemName>{networkName}</StyledNetworkItemName>
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
    </StyledNetworkItemWrapper>
  );
};
