import { Box, Button, Image, Input, Text } from '@chakra-ui/react';
import { FaChevronDown } from 'react-icons/fa';
import { FROM_TO } from '@/constants';
import { SwapTokenType } from '@/types/SwapDataType';
import { formatTokenSymbol } from '@/utils/string';
import { useEffect, useState } from 'react';
import { useCosmosChain } from '@/hooks/useCosmosChain';

import StyledTokenBox from './index.style';

type TokenBoxProps = {
  handleClick: () => void;
  token?: SwapTokenType;
  fromOrTo?: string;
  handleChangeAmount: (
    // eslint-disable-next-line no-unused-vars
    event: React.ChangeEvent<HTMLInputElement>,
    balance: string,
  ) => void;
};

const TokenBox = ({
  fromOrTo = FROM_TO.FROM,
  token,
  handleClick,
  handleChangeAmount,
}: TokenBoxProps) => {
  const [balance, setBalance] = useState<string>('0');
  const cosmosChain = useCosmosChain(token?.network?.networkName!);

  useEffect(() => {
    const fetchBalance = async () => {
      if (token?.tokenId) {
        const balanceData = await cosmosChain.getBalanceByDenom({
          denom: token.tokenId,
        });
        if (balanceData?.amount) {
          setBalance(balanceData.amount);
        }
      }
    };

    fetchBalance();
  }, [token]);

  return (
    <StyledTokenBox>
      <Box display="flex" justifyContent="space-between">
        <Text className="label">{`${fromOrTo} token`}</Text>
        <Text className="balance">{`Balance: ${balance}`}</Text>
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
                <Text>
                  {token?.network?.networkPrettyName || 'Select Network'}
                </Text>
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
            onChange={(event) => handleChangeAmount(event, balance)}
            value={token?.swapAmount}
          />
        </Box>
      </Box>
    </StyledTokenBox>
  );
};

export default TokenBox;
