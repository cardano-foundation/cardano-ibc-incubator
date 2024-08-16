import React from 'react';
import { Box, Button, Image, Input, Text } from '@chakra-ui/react';
import { FaChevronDown } from 'react-icons/fa';
import { FROM_TO } from '@/constants';
import { SwapTokenType } from '@/types/SwapDataType';
import { formatTokenSymbol } from '@/utils/string';

import StyledTokenBox from './index.style';

type TokenBoxProps = {
  handleClick: () => void;
  token?: SwapTokenType;
  fromOrTo?: string;
  handleChangeAmount: (
    // eslint-disable-next-line no-unused-vars
    event: React.ChangeEvent<HTMLInputElement>,
  ) => void;
};

const TokenBox = ({
  fromOrTo = FROM_TO.FROM,
  token,
  handleClick,
  handleChangeAmount,
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
                    src={token?.tokenLogo}
                    alt={token?.tokenName}
                    width={30}
                    height={30}
                  />
                )}
                <Text>{token?.network?.networkPrettyName || 'Select Network'}</Text>
              </Box>
            </Button>
            <Text fontSize="14px" color="#A8A8A9" pb="12px">
              {formatTokenSymbol(token?.tokenName || '')}
            </Text>
          </Box>
        </Box>
        <Box>
          <Input
            className="input-quantity"
            variant="unstyled"
            textAlign="right"
            placeholder="0"
            disabled={!token?.tokenId}
            onChange={(event) => handleChangeAmount(event)}
            value={token?.swapAmount}
          />
        </Box>
      </Box>
    </StyledTokenBox>
  );
};

export default TokenBox;
