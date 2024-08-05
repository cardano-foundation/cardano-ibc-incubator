import { List, ListItem } from '@chakra-ui/react';
import { NetworkItem, NetworkItemProps } from '../NetworkItem/NetworkItem';

type NetworkListProps = {
  networkList: Array<NetworkItemProps>;
  networkSelected?: NetworkItemProps;
  // eslint-disable-next-line no-unused-vars
  onClickNetwork?: (token: NetworkItemProps) => void;
};

export const NetworkList = ({
  networkSelected,
  networkList,
  onClickNetwork,
}: NetworkListProps) => {
  const handleClickNetworkItem = (network: NetworkItemProps) => {
    onClickNetwork?.(network);
  };

  return (
    <List spacing="16px">
      <ListItem padding="16px">
        {networkList.map((network) => (
          <NetworkItem
            key={network.networkId}
            networkName={network.networkName}
            networkLogo={network.networkLogo}
            isActive={networkSelected?.networkId === network.networkId}
            onClick={() => handleClickNetworkItem(network)}
          />
        ))}
      </ListItem>
    </List>
  );
};
