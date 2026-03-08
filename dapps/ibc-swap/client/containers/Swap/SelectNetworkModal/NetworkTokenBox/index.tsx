/* eslint-disable no-unused-vars */
import React, { useEffect, useState } from 'react';
import { Box, Image, Text } from '@chakra-ui/react';
import { COLOR } from '@/styles/color';
import { SearchInput } from '@/components/SearchInput/InputSearch';
import { NetworkList } from '@/components/NetworkList/NetworkList';
import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import { TokenItemProps, TokenList } from '@/components/TokenList/TokenList';
import EarchIcon from '@/assets/icons/earth.svg';
import { FROM_TO } from '@/constants';
import { SwapTokenType } from '@/types/SwapDataType';
import DefaultCardanoNetworkIcon from '@/assets/icons/cardano.svg';
import { formatTokenSymbol } from '@/utils/string';
import { debounce } from '@/utils/helper';
import { Loading } from '@/components/Loading/Loading';
import { useCardanoChain } from '@/hooks/useCardanoChain';
import { CARDANO_CHAIN_ID } from '@/configs/runtime';
import { getLocalOsmosisSwapOptions } from '@/apis/restapi/cardano';
import DefaultCosmosNetworkIcon from '@/assets/icons/cosmos-icon.svg';

import { StyledNetworkBox, StyledNetworkBoxHeader } from './index.style';

type NetworkTokenBoxProps = {
  fromOrTo?: string;
  onChooseToken?: (token: SwapTokenType) => void;
  networkList: NetworkItemProps[];
  selectedToken?: SwapTokenType;
  disabledToken?: SwapTokenType;
  disabledNetwork?: {
    fromNetworkDisabled: NetworkItemProps | undefined;
    toNetworkDisabled: NetworkItemProps | undefined;
  };
  setDisabledNetwork?: (network: NetworkItemProps) => void;
};

const NetworkTokenBox = ({
  fromOrTo = FROM_TO.FROM,
  onChooseToken,
  networkList,
  selectedToken,
  disabledToken,
  disabledNetwork,
  setDisabledNetwork,
}: NetworkTokenBoxProps) => {
  const [tokenSelected, setTokenSelected] = useState<TokenItemProps>();
  const [networkSelected, setNetworkSelected] = useState<NetworkItemProps>();
  const [displayNetworkList, setDisplayNetworkList] =
    useState<NetworkItemProps[]>(networkList);
  const [displayTokenList, setDisplayTokenList] = useState<TokenItemProps[]>(
    [],
  );
  const [isFetchingData, setIsFetchingData] = useState<boolean>(false);

  const { getTotalSupply: getCardanoTotalSupply } = useCardanoChain();
  const hasNetworkChoice = networkList.length > 1;

  const handleClickTokenItem = (token: TokenItemProps) => {
    if (!networkSelected) return;
    setTokenSelected(token);
    onChooseToken?.({
      tokenId: token.tokenId!,
      tokenName: token.tokenName!,
      tokenLogo: token.tokenLogo!,
      network: networkSelected,
    });
  };

  const handleClickNetworkItem = (network: NetworkItemProps) => {
    setNetworkSelected(network);
    setDisabledNetwork?.(network);
    setTokenSelected({} as TokenItemProps);
    setDisplayTokenList([]);
    onChooseToken?.({} as SwapTokenType);
  };

  const handleSearch = debounce(
    (
      setCurrentList: any,
      searchString: string,
      searchList: any[],
      searchKey: string,
    ) => {
      if (searchList?.length) {
        const newList = searchList.filter((item) =>
          item?.[searchKey]
            ?.toLowerCase()
            ?.includes(searchString.toLowerCase()),
        );
        setCurrentList(newList);
      }
    },
    250,
  );

  useEffect(() => {
    if (selectedToken?.tokenId) {
      setTokenSelected({
        tokenId: selectedToken?.tokenId,
        tokenLogo: selectedToken?.tokenLogo,
        tokenName: selectedToken?.tokenName,
      });
      setNetworkSelected(selectedToken.network);
    }
  }, [selectedToken]);

  useEffect(() => {
    if (!hasNetworkChoice && networkList[0] && !networkSelected?.networkId) {
      setNetworkSelected(networkList[0]);
      setDisabledNetwork?.(networkList[0]);
    }
  }, [hasNetworkChoice, networkList, networkSelected?.networkId, setDisabledNetwork]);

  useEffect(() => {
    let cancelled = false;

    const fetchTokenList = async () => {
      const selectedNetworkId = networkSelected?.networkId;

      if (!selectedNetworkId) {
        setDisplayTokenList([]);
        return;
      }

      setIsFetchingData(true);
      try {
        if (selectedNetworkId === CARDANO_CHAIN_ID) {
          const totalSupplyOnCardano = getCardanoTotalSupply();
          const formatTokenList = totalSupplyOnCardano?.map((asset) => {
            const assetWithName = asset as typeof asset & { assetName: string };
            return {
              tokenId: assetWithName.unit,
              tokenName: assetWithName.assetName,
              tokenLogo: DefaultCardanoNetworkIcon.src,
            };
          });
          if (!cancelled) {
            setDisplayTokenList(formatTokenList || []);
          }
          return;
        }

        const swapOptions = await getLocalOsmosisSwapOptions();
        const formatTokenList =
          swapOptions?.toChainId === selectedNetworkId
            ? swapOptions.toTokens.map((token) => ({
                tokenId: token.tokenId,
                tokenName: token.tokenName,
                tokenLogo: token.tokenLogo || DefaultCosmosNetworkIcon.src,
              }))
            : [];

        if (!cancelled) {
          setDisplayTokenList(formatTokenList);
        }
      } finally {
        if (!cancelled) {
          setIsFetchingData(false);
        }
      }
    };

    fetchTokenList();

    return () => {
      cancelled = true;
    };
  }, [getCardanoTotalSupply, networkSelected?.networkId]);

  useEffect(() => {
    setDisplayNetworkList(networkList);
  }, [networkList]);

  return (
    <StyledNetworkBox isChoseToken={!!tokenSelected?.tokenId}>
      <StyledNetworkBoxHeader isChoseToken={!!tokenSelected?.tokenId}>
        <Text display="flex" alignItems="center">
          {fromOrTo}
        </Text>
        <Box borderRadius="100%" display="flex">
          <Image
            src={tokenSelected?.tokenLogo || EarchIcon.src}
            alt={tokenSelected?.tokenName || ''}
            width="32px"
            height="32px"
          />
          <Box ml="10px" display="flex" alignItems="center">
            <Box>
              <Text fontWeight="700" fontSize="18px">
                {formatTokenSymbol(tokenSelected?.tokenName || '')}
              </Text>
              {networkSelected?.networkId ? (
                <Text fontSize="12px">
                  {networkSelected?.networkPrettyName}
                </Text>
              ) : (
                <Text fontSize="18px">Select Network</Text>
              )}
            </Box>
          </Box>
        </Box>
      </StyledNetworkBoxHeader>
      <Box display="flex" height={472}>
        {hasNetworkChoice && (
          <Box h="100%" width="50%">
            <Box
              p="16px"
              borderBottomWidth="1px"
              borderRightWidth="1px"
              borderColor={COLOR.neutral_5}
            >
              <SearchInput
                placeholder="Search network"
                onChange={(e: any) => {
                  const searchString = e.target.value;
                  handleSearch(
                    setDisplayNetworkList,
                    searchString,
                    networkList,
                    'networkPrettyName',
                  );
                }}
              />
            </Box>
            <Box
              maxH="368px"
              h="368px"
              borderRightWidth="1px"
              borderColor={COLOR.neutral_5}
              overflowY="scroll"
            >
              <NetworkList
                networkList={displayNetworkList}
                networkSelected={networkSelected}
                onClickNetwork={handleClickNetworkItem}
                disabledNetwork={
                  fromOrTo === FROM_TO.FROM
                    ? disabledNetwork?.fromNetworkDisabled
                    : disabledNetwork?.toNetworkDisabled
                }
              />
            </Box>
          </Box>
        )}
        <Box width={hasNetworkChoice ? '50%' : '100%'}>
          <Box
            p="16px"
            borderBottomWidth="1px"
            borderRightWidth="1px"
            borderColor={COLOR.neutral_5}
          >
            <SearchInput
              placeholder="Search token"
              onChange={(e: any) => {
                const searchString = e.target.value;
                handleSearch(
                  setDisplayTokenList,
                  searchString,
                  displayTokenList,
                  'tokenName',
                );
              }}
            />
          </Box>
          <Box
            maxH="368px"
            overflowY="scroll"
            borderRightWidth="1px"
            borderColor={COLOR.neutral_5}
          >
            {isFetchingData ? (
              <Box mt={4}>
                <Loading />
              </Box>
            ) : displayTokenList.length === 0 ? (
              <Box py={10} px={6} textAlign="center">
                <Text color={COLOR.neutral_3}>
                  No supported tokens available for this network yet.
                </Text>
              </Box>
            ) : (
              <TokenList
                tokenList={displayTokenList}
                tokenSelected={tokenSelected}
                onClickToken={handleClickTokenItem}
                disabledToken={disabledToken}
              />
            )}
          </Box>
        </Box>
      </Box>
    </StyledNetworkBox>
  );
};

export default NetworkTokenBox;
