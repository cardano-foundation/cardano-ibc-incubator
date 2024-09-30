import { Box, Button, Image, Input, Text } from '@chakra-ui/react';
import { FaChevronDown } from 'react-icons/fa';
import { FROM_TO } from '@/constants';
import { SwapTokenType } from '@/types/SwapDataType';
import { formatPrice, formatTokenSymbol } from '@/utils/string';
import { useContext, useEffect, useState } from 'react';
import { useCosmosChain } from '@/hooks/useCosmosChain';
import { useCardanoChain } from '@/hooks/useCardanoChain';
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
  const cardano = useCardanoChain();

  useEffect(() => {
    const fetchBalance = async () => {
      if (token?.tokenId) {
        let balanceData = '0';
        if (
          token?.network?.networkId &&
          token.network.networkId === process.env.NEXT_PUBLIC_CARDANO_CHAIN_ID
        ) {
          balanceData = cardano.getBalanceByDenom(token.tokenId);
        } else {
          balanceData = await cosmosChain.getBalanceByDenom({
            denom: token.tokenId,
          });
        }

        if (balanceData) {
          setBalance(balanceData);
          if (fromOrTo === FROM_TO.FROM) {
            setSwapData((prev) => ({
              ...prev,
              fromToken: {
                ...prev.fromToken,
                balance: balanceData,
              },
            }));
          }
        }
      }
    };

    fetchBalance();
  }, [token?.tokenId]);
  const boxValue =
    fromOrTo === FROM_TO.FROM
      ? { value: token?.swapAmount || '0' }
      : { defaultValue: token?.swapAmount || '0' };
  return (
    <StyledTokenBox>
      <Box display="flex" justifyContent="space-between">
        <Text className="label">{`${fromOrTo} token`}</Text>
        {fromOrTo === FROM_TO.FROM && (
          <Text className="balance">{`Balance: ${formatPrice(balance)}`}</Text>
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
            {...boxValue}
          />
        </Box>
      </Box>
    </StyledTokenBox>
  );
};

export default TokenBox;
