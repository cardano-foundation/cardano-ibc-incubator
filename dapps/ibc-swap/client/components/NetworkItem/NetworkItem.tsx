import { Box, Image } from '@chakra-ui/react';
import {
  CustomNetworkItemName,
  CustomNetworkItemWrapper,
} from './index.styled';

export type NetworkItemProps = {
  networkName: string;
  networkLogo: string;
};

export const NetworkItem = ({ networkName, networkLogo }: NetworkItemProps) => {
  return (
    <CustomNetworkItemWrapper>
      <Box borderRadius="100%">
        <Image src={networkLogo} alt={networkName} width={30} height={30} />
      </Box>
      <CustomNetworkItemName>{networkName}</CustomNetworkItemName>
    </CustomNetworkItemWrapper>
  );
};
