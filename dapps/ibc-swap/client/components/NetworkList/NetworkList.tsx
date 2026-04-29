import { List, ListItem } from '@chakra-ui/react';
import { NetworkItem, NetworkItemProps } from '../NetworkItem/NetworkItem';

type NetworkListProps = {
  networkList: Array<NetworkItemProps>;
  networkSelected?: NetworkItemProps;
  // eslint-disable-next-line no-unused-vars
  onClickNetwork?: (token: NetworkItemProps) => void;
  disabledNetwork?: NetworkItemProps | undefined;
};

export const NetworkList = ({
  networkSelected,
  networkList,
  onClickNetwork,
  disabledNetwork,
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
            networkId={network.networkId}
            ibcChainId={network.ibcChainId}
            networkName={network.networkName}
            networkLogo={network.networkLogo}
            networkPrettyName={network.networkPrettyName}
            networkType={network.networkType}
            networkRole={network.networkRole}
            disabledReason={network.disabledReason}
            isActive={networkSelected?.networkId === network.networkId}
            onClick={() => handleClickNetworkItem(network)}
            isDisabled={
              network.isDisabled ||
              disabledNetwork?.networkId === network.networkId
            }
          />
        ))}
      </ListItem>
    </List>
  );
};
