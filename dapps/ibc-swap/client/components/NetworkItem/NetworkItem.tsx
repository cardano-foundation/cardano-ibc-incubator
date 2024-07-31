import { Box, Image } from '@chakra-ui/react';
import { StyledNetworkItemName, StyledNetworkItemWrapper } from './index.style';

export type NetworkItemProps = {
  networkName: string;
  networkLogo: string;
};

export const NetworkItem = ({ networkName, networkLogo }: NetworkItemProps) => {
  return (
    <StyledNetworkItemWrapper>
      <Box borderRadius="100%">
        <Image src={networkLogo} alt={networkName} width={30} height={30} />
      </Box>
      <StyledNetworkItemName>{networkName}</StyledNetworkItemName>
    </StyledNetworkItemWrapper>
  );
};
