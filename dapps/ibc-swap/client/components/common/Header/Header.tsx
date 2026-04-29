import {
  Box,
  Center,
  Flex,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Spacer,
  Text,
} from '@chakra-ui/react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import CardanoLogo from '@/assets/icons/cardano-logo-blue 1.svg';
import { COLOR } from '@/styles/color';
import { routes } from '@/constants';
import { useRuntimeConfig } from '@/contexts/RuntimeConfigContext';

import styles from './Header.module.css';
import { ConnectWalletDropdown } from './ConnectWalletDropdown';

export const Header = () => {
  const runtimeConfig = useRuntimeConfig();
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
      <Popover placement="bottom-end">
        <PopoverTrigger>
          <Box
            cursor="pointer"
            mr="16px"
            px="12px"
            py="7px"
            borderRadius="999px"
            border="1px solid #FFFFFF1F"
            background="#26262A"
          >
            <Text fontSize="12px" color={COLOR.neutral_1} fontWeight={700}>
              Mode: {runtimeConfig.label}
            </Text>
          </Box>
        </PopoverTrigger>
        <PopoverContent
          background={COLOR.neutral_6}
          borderColor="#FFFFFF1F"
          color={COLOR.neutral_1}
          width="320px"
        >
          <PopoverBody>
            <Text fontSize="14px" fontWeight={700}>
              {runtimeConfig.label} profile
            </Text>
            <Text mt="4px" fontSize="12px" color={COLOR.neutral_3}>
              {runtimeConfig.description}
            </Text>
            {runtimeConfig.disabledReason && (
              <Text mt="8px" fontSize="12px" color="#FF6B6B">
                {runtimeConfig.disabledReason}
              </Text>
            )}
            <Box mt="12px">
              {runtimeConfig.chains.map((chain) => (
                <Text key={chain.id} fontSize="12px" color={COLOR.neutral_2}>
                  {chain.prettyName}
                  {chain.role === 'route-infra' ? ' (route infra)' : ''}
                </Text>
              ))}
            </Box>
          </PopoverBody>
        </PopoverContent>
      </Popover>
      <Box className="header-connect-wallet">
        <ConnectWalletDropdown />
      </Box>
    </Box>
  );
};
