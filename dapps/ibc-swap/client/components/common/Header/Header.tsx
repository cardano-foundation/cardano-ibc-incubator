import { Box, Center, Flex, Spacer } from '@chakra-ui/react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import CardanoLogo from '@/assets/icons/cardano-logo-blue 1.svg';
import { COLOR } from '@/styles/color';
import { routes } from '@/constants';

import styles from './Header.module.css';
import { ConnectWalletDropdown } from './ConnectWalletDropdown';

export const Header = () => {
  const isActive = (path: String) => {
    return path === usePathname();
  };

  return (
    <Box className={styles.headerContainer}>
      <Flex>
        <Box className={styles.headerLogo}>
          <Image src={CardanoLogo} alt="Cardano logo" />
        </Box>
        <Box className={styles.headerLink}>
          <Flex gap="16px" color={COLOR.neutral_3}>
            {routes.map((route) => (
              <Center key={route.path}>
                <Link
                  className={`${styles.headerLinkBox} ${
                    isActive(route.path) ? styles.active : ''
                  }`}
                  href={route.path}
                >
                  <p>{route.name}</p>
                </Link>
              </Center>
            ))}
          </Flex>
        </Box>
      </Flex>
      <Spacer />
      <Box className="header-connect-wallet">
        <ConnectWalletDropdown />
      </Box>
    </Box>
  );
};
