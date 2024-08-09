import React from 'react';
import { Box, Button, Image, Input, Text } from '@chakra-ui/react';
import { FaChevronDown } from 'react-icons/fa';
import { TokenSelectedProps } from '@/containers/Swap/SelectNetworkModal/NetworkTokenBox';
import { FROM_TO } from '@/constants';
import StyledTokenBox from './index.style';

type TokenBoxProps = {
  handleClick: () => void;
  token?: TokenSelectedProps;
  fromOrTo?: string;
};

const TokenBox = ({
  fromOrTo = FROM_TO.FROM,
  token,
  handleClick,
}: TokenBoxProps) => {
  return (
    <StyledTokenBox>
      <Box display="flex" justifyContent="space-between">
        <Text className="label">{`${fromOrTo} token`}</Text>
        <Text className="balance">Balance: 0</Text>
      </Box>
      <Box display="flex" justifyContent="space-between" marginTop="5px">
        <Box display="flex" alignItems="center">
          <Box>
            <Button
              rightIcon={<FaChevronDown />}
              colorScheme="white"
              variant="outline"
              border="none"
              padding="0"
              fontWeight="700"
              onClick={handleClick}
            >
              <Box
                borderRadius="100%"
                display="flex"
                gap="10px"
                alignItems="center"
              >
                {token?.network?.networkName && (
                  <Image
                    src={token?.token?.tokenLogo}
                    alt={token?.token?.tokenName}
                    width={30}
                    height={30}
                  />
                )}

                <Text>{token?.network?.networkName || 'Select Network'}</Text>
              </Box>
            </Button>
            <Text fontSize="14px" color="#A8A8A9" pb="12px">
              {token?.token?.tokenName || ''}
            </Text>
          </Box>
        </Box>
        <Box>
          <Input
            className="input-quantity"
            variant="unstyled"
            textAlign="right"
            placeholder="0"
          />
        </Box>
      </Box>
    </StyledTokenBox>
  );
};

export default TokenBox;
