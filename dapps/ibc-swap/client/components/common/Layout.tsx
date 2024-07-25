import { Box, Container } from '@interchain-ui/react';
import { Header } from './Header';

export const Layout = ({ children }: { children?: React.ReactNode }) => {
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
      <Container
        maxWidth="64rem"
        attributes={{
          paddingY: '$14',
        }}
      >
        <div id="body">{children}</div>
      </Container>
    </Box>
  );
};
