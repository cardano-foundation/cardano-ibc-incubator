import { Box, Button, Image, Input, Text } from '@chakra-ui/react';
import { FaChevronDown } from 'react-icons/fa';
import { FROM_TO } from '@/constants';
import { SwapTokenType } from '@/types/SwapDataType';
import { formatTokenSymbol } from '@/utils/string';
import { useContext, useEffect, useState } from 'react';
import { useCosmosChain } from '@/hooks/useCosmosChain';
import SwapContext from '@/contexts/SwapContext';

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
  const { setSwapData } = useContext(SwapContext);

  const [balance, setBalance] = useState<string>('0');
  const cosmosChain = useCosmosChain(token?.network?.networkId!);

  useEffect(() => {
    const fetchBalance = async () => {
      if (token?.tokenId) {
        const balanceData = await cosmosChain.getBalanceByDenom({
          denom: token.tokenId,
        });
        if (balanceData?.amount) {
          setBalance(balanceData.amount);
          if (fromOrTo === FROM_TO.FROM) {
            setSwapData((prev) => ({
              ...prev,
              fromToken: {
                ...prev.fromToken,
                balance: balanceData.amount,
              },
            }));
          } else {
            setSwapData((prev) => ({
              ...prev,
              toToken: {
                ...prev.toToken,
                balance: balanceData.amount,
              },
            }));
          }
        }
      }
    };

    fetchBalance();
  }, [token]);

  return (
    <StyledTokenBox>
      <Box display="flex" justifyContent="space-between">
        <Text className="label">{`${fromOrTo} token`}</Text>
        {fromOrTo === FROM_TO.FROM && (
          <Text className="balance">{`Balance: ${balance}`}</Text>
        )}
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
            disabled={!token?.tokenId || fromOrTo === FROM_TO.TO}
            onChange={(event) => handleChangeAmount(event)}
            value={token?.swapAmount}
          />
        </Box>
      </Box>
    </StyledTokenBox>
  );
};

export default TokenBox;
