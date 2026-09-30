import { Box, Button, Image, Input, Text } from '@chakra-ui/react';
import { FaChevronDown } from 'react-icons/fa';
import { FROM_TO } from '@/constants';
import { SwapTokenType } from '@/types/SwapDataType';
import { baseAmountToDisplayAmount, formatPrice } from '@/utils/string';
import { TokenAmountUnit, TokenLabel } from '@/components/TokenLabel';
import { useContext, useEffect, useState } from 'react';
import { useCosmosChain } from '@/hooks/useCosmosChain';
import { useCardanoChain } from '@/hooks/useCardanoChain';
import SwapContext from '@/contexts/SwapContext';
import { CARDANO_CHAIN_ID } from '@/configs/runtime';

import {
  cardanoTokenOption,
  tokenTransferDisabledReason,
  tokenUsesBaseUnits,
} from '@/utils/cardanoAssetPresentation';

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
    let cancelled = false;
    const fetchBalance = async () => {
      if (token?.tokenId) {
        let balanceData = '0';
        if (
          token?.network?.networkId &&
          token.network.networkId === CARDANO_CHAIN_ID
        ) {
          const asset = cardano
            .getTotalSupply()
            .find((item) => item.unit === token.tokenId);
          balanceData = asset?.quantity || '0';
          if (fromOrTo === FROM_TO.FROM) {
            setSwapData((prev) => {
              if (
                prev.fromToken.tokenId !== token.tokenId ||
                prev.fromToken.network.networkId !== token.network.networkId
              )
                return prev;
              const presentation = asset
                ? cardanoTokenOption(asset, token.tokenLogo)
                : {
                    ...prev.fromToken,
                    balance: '0',
                    tokenDisabledReason:
                      'Wallet asset verification unavailable. Reload to retry.',
                  };
              const fromToken = {
                ...prev.fromToken,
                ...presentation,
                tokenName: presentation.tokenName || '',
                swapAmount:
                  presentation.tokenExponent === prev.fromToken.tokenExponent
                    ? prev.fromToken.swapAmount
                    : '',
              };
              return JSON.stringify(fromToken) ===
                JSON.stringify(prev.fromToken)
                ? prev
                : { ...prev, fromToken };
            });
          }
        } else {
          balanceData = await cosmosChain.getBalanceByDenom({
            denom: token.tokenId,
          });
        }

        if (!cancelled && balanceData) {
          setBalance(balanceData);
          if (
            fromOrTo === FROM_TO.FROM &&
            token.network.networkId !== CARDANO_CHAIN_ID
          ) {
            setSwapData((prev) =>
              prev.fromToken.tokenId !== token.tokenId
                ? prev
                : {
                    ...prev,
                    fromToken: {
                      ...prev.fromToken,
                      balance: balanceData,
                    },
                  },
            );
          }
        }
      }
    };

    fetchBalance();
    return () => {
      cancelled = true;
    };
  }, [
    cardano,
    cosmosChain,
    fromOrTo,
    setSwapData,
    token?.network?.networkId,
    token?.tokenId,
    token?.tokenLogo,
  ]);
  const boxValue = { value: token?.swapAmount || '' };
  return (
    <StyledTokenBox>
      <Box display="flex" justifyContent="space-between">
        <Text className="label">{`${fromOrTo} token`}</Text>
        {fromOrTo === FROM_TO.FROM && (
          <Text className="balance">
            {`Balance: ${formatPrice(
              baseAmountToDisplayAmount(balance, token?.tokenExponent ?? 0),
            )}`}
            <TokenAmountUnit token={token} />
          </Text>
        )}
      </Box>
      <Box display="flex" justifyContent="space-between" marginTop="5px">
        <Box display="flex" alignItems="center" minW={0} flex={1}>
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
              <TokenLabel token={token} />
            </Text>
          </Box>
        </Box>
        <Box width="35%">
          <Input
            className="input-quantity"
            variant="unstyled"
            textAlign="right"
            placeholder="0"
            aria-label={
              tokenUsesBaseUnits(token) ? 'Amount in base units' : 'Amount'
            }
            disabled={
              Boolean(tokenTransferDisabledReason(token)) ||
              fromOrTo === FROM_TO.TO
            }
            onChange={(event) => handleChangeAmount(event)}
            {...boxValue}
          />
          <Text fontSize={12}>
            <TokenAmountUnit token={token} />
          </Text>
        </Box>
      </Box>
      {token?.tokenId && tokenTransferDisabledReason(token) && (
        <Text fontSize={12}>{tokenTransferDisabledReason(token)}</Text>
      )}
    </StyledTokenBox>
  );
};

export default TokenBox;
