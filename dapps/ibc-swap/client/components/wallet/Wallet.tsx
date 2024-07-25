// @ts-nocheck
import { useChain } from '@cosmos-kit/react';
import { MouseEventHandler } from 'react';
import { Box, Stack, useTheme } from '@interchain-ui/react';
import { ChainName } from 'cosmos-kit';
import { defaultChainName } from '@/constants';

import {
  Connected,
  Connecting,
  Disconnected,
  NotExist,
  Error,
  Rejected,
  WalletConnectComponent,
  ConnectWalletButton,
} from './WalletConnect';
import { ConnectedShowAddress, CopyAddressBtn } from './AddressCard';
import { UserInfo } from './UserInfo';

export interface WalletSectionProps {
  providedChainName?: ChainName;
  setChainName?: (chainName: ChainName | undefined) => void;
}

export const WalletSection = ({
  providedChainName,
  setChainName,
}: WalletSectionProps) => {
  const {
    connect,
    openView,
    status,
    username,
    address,
    message,
    wallet,
    chain: chainInfo,
  } = useChain(providedChainName || defaultChainName);

  const { theme } = useTheme();

  // Events
  const onClickConnect: MouseEventHandler = async (e) => {
    e.preventDefault();
    await connect();
  };

  const onClickOpenView: MouseEventHandler = (e) => {
    e.preventDefault();
    openView();
  };

  // Components
  const connectWalletButton = (
    <WalletConnectComponent
      walletStatus={status}
      disconnect={
        <Disconnected buttonText="Connect Wallet" onClick={onClickConnect} />
      }
      connecting={<Connecting />}
      connected={<Connected buttonText="My Wallet" onClick={onClickOpenView} />}
      rejected={<Rejected buttonText="Reconnect" onClick={onClickConnect} />}
      error={<Error buttonText="Change Wallet" onClick={onClickOpenView} />}
      notExist={
        <NotExist buttonText="Install Wallet" onClick={onClickOpenView} />
      }
    />
  );

  const userInfo = username && <UserInfo username={username} />;

  const addressBtn = (
    <CopyAddressBtn
      walletStatus={status}
      connected={<ConnectedShowAddress address={address} isLoading={false} />}
    />
  );

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      py="$12"
      width="100%"
      attributes={{
        'data-part-id': 'wallet-section',
      }}
    >
      <Box
        display="grid"
        width="$full"
        maxWidth={{
          mobile: '100%',
          tablet: '450px',
        }}
        gridTemplateColumns="1fr"
        rowGap="$10"
        alignItems="center"
        justifyContent="center"
      >
        <Box px={6}>
          <Stack
            direction="vertical"
            attributes={{
              px: '$2',
              py: '$12',
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: '$lg',
              backgroundColor: theme === 'light' ? '$white' : '$cardBg',
              boxShadow:
                theme === 'light'
                  ? '0 0 2px #dfdfdf, 0 0 6px -2px #d3d3d3'
                  : '0 0 2px #363636, 0 0 8px -2px #4f4f4f',
            }}
            space="$8"
          >
            {userInfo}
            {addressBtn}

            <Box
              width="100%"
              maxWidth="200px"
              attributes={{ id: 'connect-button' }}
            >
              {connectWalletButton}
            </Box>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
};
