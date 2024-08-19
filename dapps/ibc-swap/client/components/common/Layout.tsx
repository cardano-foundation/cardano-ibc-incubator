import { Box, Container } from '@chakra-ui/react';
import { useWallet } from '@meshsdk/react';
import { useEffect } from 'react';
import { Header } from './Header';

export const Layout = ({ children }: { children?: React.ReactNode }) => {
  const { connect } = useWallet();

  useEffect(() => {
    const walletConnected = localStorage?.getItem('cardano-wallet');

    if (walletConnected) {
      const cardanoWallet = JSON.parse(walletConnected);
      connect(cardanoWallet?.name);
    }
  }, []);

  return (
    <Box
      top="0"
      bottom="0"
      left="0"
      right="0"
      height="max(1dvh, 100%)"
      data-part-id="layout-container"
    >
      <Header />
      <Container maxWidth="64rem" paddingY={14}>
        <div id="body">{children}</div>
      </Container>
    </Box>
  );
};
