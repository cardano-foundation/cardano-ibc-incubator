/* eslint-disable no-unused-vars */
import React, { useEffect, useState } from 'react';
import { Coin } from 'interchain/types/codegen/cosmos/base/v1beta1/coin';
import { Box, Image, Text } from '@chakra-ui/react';
import { COLOR } from '@/styles/color';
import { SearchInput } from '@/components/SearchInput/InputSearch';
import { NetworkList } from '@/components/NetworkList/NetworkList';
import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import { TokenItemProps, TokenList } from '@/components/TokenList/TokenList';
import EarchIcon from '@/assets/icons/earth.svg';
import { cosmosChainsSupported, FROM_TO } from '@/constants';
import { SwapTokenType } from '@/types/SwapDataType';
import DefaultCardanoNetworkIcon from '@/assets/icons/cardano.svg';

import { formatTokenSymbol } from '@/utils/string';
import { customSortTotalSupllyHasBalance, debounce } from '@/utils/helper';
import { useCosmosChain } from '@/hooks/useCosmosChain';
import DefaultCosmosNetworkIcon from '@/assets/icons/cosmos-icon.svg';
import { Loading } from '@/components/Loading/Loading';
import { useCardanoChain } from '@/hooks/useCardanoChain';

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

  const cosmos = useCosmosChain(networkSelected?.networkId!);

  const cardano = useCardanoChain();

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
    500,
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
    const fetchTokenListOfCosmos = async () => {
      if (
        networkSelected?.networkId &&
        cosmosChainsSupported.includes(networkSelected.networkId)
      ) {
        let formatTokenList = [] as TokenItemProps[];
        setIsFetchingData(true);

        let totalSupplyOnCosmos = (await cosmos.getTotalSupply()) as Coin[];
        if (fromOrTo === FROM_TO.FROM) {
          const balances = (await cosmos.getAllBalances()) as Coin[];
          totalSupplyOnCosmos = customSortTotalSupllyHasBalance(
            totalSupplyOnCosmos,
            balances,
          );
        }
        formatTokenList = totalSupplyOnCosmos?.map((token) => ({
          tokenId: token.denom,
          tokenName: token.denom,
          tokenLogo: DefaultCosmosNetworkIcon.src,
        }));
        setDisplayTokenList(formatTokenList);
        setIsFetchingData(false);
      }
    };
    if (
      !cosmos?.isWalletConnected &&
      cosmosChainsSupported.includes(networkSelected?.networkId!)
    ) {
      cosmos?.connect();
    } else {
      fetchTokenListOfCosmos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkSelected, cosmos?.isWalletConnected]);

  useEffect(() => {
    const fetchTokenListOfCardano = async () => {
      if (
        networkSelected?.networkId &&
        networkSelected.networkId === process.env.NEXT_PUBLIC_CARDANO_CHAIN_ID
      ) {
        let formatTokenList = [] as TokenItemProps[];
        setIsFetchingData(true);
        const totalSupplyOnCardano = cardano.getTotalSupply();
        formatTokenList = totalSupplyOnCardano?.map((asset) => {
          const assetWithName = asset as typeof asset & { assetName: string };
          return {
            tokenId: assetWithName.unit,
            tokenName: assetWithName.assetName,
            tokenLogo: DefaultCardanoNetworkIcon.src,
          };
        });
        setDisplayTokenList(formatTokenList);
        setIsFetchingData(false);
      }
    };
    fetchTokenListOfCardano();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkSelected, cardano.getTotalSupply().length]);

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
        <Box width="50%">
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
