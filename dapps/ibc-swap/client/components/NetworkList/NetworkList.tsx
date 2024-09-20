import { List, ListItem } from '@chakra-ui/react';
import { OSMOSIS_CHAIN_ID } from '@/constants';
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
            networkName={network.networkName}
            networkLogo={network.networkLogo}
            networkPrettyName={network.networkPrettyName}
            isActive={networkSelected?.networkId === network.networkId}
            onClick={() => handleClickNetworkItem(network)}
            isDisabled={
              !!(
                disabledNetwork?.networkId === OSMOSIS_CHAIN_ID &&
                network?.networkId === OSMOSIS_CHAIN_ID
              )
            }
          />
        ))}
      </ListItem>
    </List>
  );
};
