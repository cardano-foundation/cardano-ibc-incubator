import { List, ListItem } from '@chakra-ui/react';
import { useState } from 'react';
import { NetworkItem } from '../NetworkItem/NetworkItem';

type NetworkItemProps = {
  networkId: string;
  networkName: string;
  networkLogo: string;
  isActive: boolean;
  onClick: () => void;
};

type NetworkListProps = {
  networkList: Array<NetworkItemProps>;
};

export const NetworkList = ({ networkList }: NetworkListProps) => {
  const [networkSelected, setNetworkSelected] = useState<string>();
  const handleClickNetworkItem = (networkId: string) => {
    setNetworkSelected(networkId);
  };

  return (
    <List spacing="16px">
      <ListItem padding="16px">
        {networkList.map((network) => (
          <NetworkItem
            key={network.networkId}
            networkName={network.networkName}
            networkLogo={network.networkLogo}
            isActive={networkSelected === network.networkId}
            onClick={() => handleClickNetworkItem(network.networkId)}
          />
        ))}
      </ListItem>
    </List>
  );
};
