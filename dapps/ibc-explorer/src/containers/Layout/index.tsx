import { FC, ReactNode } from 'react';
import { Box } from '@mui/material';
import { Header } from './Header';

interface LayoutProps {
  children: ReactNode;
}

const Layout: FC<LayoutProps> = ({ children }) => {
  return (
    <Box sx={{ overflowX: 'hidden' }}>
      <Header />
      {children}
    </Box>
  );
};

export default Layout;
