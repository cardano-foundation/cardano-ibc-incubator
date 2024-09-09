import { Box, Image } from '@chakra-ui/react';
import EllipseIcon from '@/assets/icons/elippse.svg';
import { StyledNetworkItemName, StyledNetworkItemWrapper } from './index.style';

export type NetworkItemProps = {
  networkId?: string;
  networkName?: string;
  networkLogo?: string;
  networkPrettyName?: string;
  isActive?: boolean;
  onClick?: () => void;
  isDisabled?: boolean;
};

export const NetworkItem = ({
  networkId,
  networkName,
  networkLogo,
  networkPrettyName,
  isActive,
  onClick,
  isDisabled,
}: NetworkItemProps) => {
  return (
    <StyledNetworkItemWrapper
      onClick={isDisabled ? () => {} : onClick}
      isActive={isActive}
      id={`${networkId}`}
      isDisabled={isDisabled}
    >
      <Box borderRadius="100%" width={30}>
        <Image src={networkLogo} alt={networkName} width={30} height={30} />
      </Box>
      <StyledNetworkItemName>{networkPrettyName}</StyledNetworkItemName>
      <Box
        flex="1"
        display={isActive ? 'flex' : 'none'}
        justifyContent="flex-end"
        alignItems="center"
        width={8}
      >
        <Image src={EllipseIcon.src} width="8px" alt="" />
      </Box>
    </StyledNetworkItemWrapper>
  );
};
