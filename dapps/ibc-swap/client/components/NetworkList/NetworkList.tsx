import { List, ListItem } from '@chakra-ui/react';
import { NetworkItem, NetworkItemProps } from '../NetworkItem/NetworkItem';

type NetworkListProps = {
  networkList: Array<NetworkItemProps>;
};

export const NetworkList = ({ networkList }: NetworkListProps) => {
  return (
    <List spacing="16px">
      <ListItem padding="16px">
        {networkList.map((network) => (
          <NetworkItem
            key={network.networkName}
            networkName={network.networkName}
            networkLogo={network.networkLogo}
          />
        ))}
      </ListItem>
    </List>
  );
};
