/* eslint-disable no-unused-vars */
import React, { useContext, useEffect, useState } from 'react';
import { Box, Image, Text } from '@chakra-ui/react';

import { COLOR } from '@/styles/color';
import { SearchInput } from '@/components/SearchInput/InputSearch';
import { NetworkList } from '@/components/NetworkList/NetworkList';
import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import { TokenItemProps, TokenList } from '@/components/TokenList/TokenList';
import EarchIcon from '@/assets/icons/earth.svg';
import { FROM_TO } from '@/constants';
import { SwapTokenType } from '@/types/SwapDataType';

import { formatTokenSymbol } from '@/utils/string';
import { debounce } from '@/utils/helper';
import { StyledNetworkBox, StyledNetworkBoxHeader } from './index.style';

import { TokenListData } from '../data';

type NetworkTokenBoxProps = {
  fromOrTo?: string;
  onChooseToken?: (token: SwapTokenType) => void;
  networkList: NetworkItemProps[];
  selectedToken?: SwapTokenType;
  disabledToken?: SwapTokenType;
};

const NetworkTokenBox = ({
  fromOrTo = FROM_TO.FROM,
  onChooseToken,
  networkList,
  selectedToken,
  disabledToken,
}: NetworkTokenBoxProps) => {
  const [tokenSelected, setTokenSelected] = useState<TokenItemProps>();
  const [networkSelected, setNetworkSelected] = useState<NetworkItemProps>();
  const [tokenList, setTokenList] = useState<TokenItemProps[]>([]);
  const [displayNetworkList, setDisplayNetworkList] =
    useState<NetworkItemProps[]>(networkList);
  const [displayTokenList, setDisplayTokenList] = useState<TokenItemProps[]>(
    [],
  );

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
    const fetchTokenList = async () => {
      // TODO: fetch token list when selected network
      setTokenList(TokenListData);
      setDisplayTokenList(TokenListData);
    };
    if (networkSelected?.networkId) {
      fetchTokenList();
    }
  }, [networkSelected]);

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
              <Text fontSize="12px">
                {networkSelected?.networkId ? (
                  networkSelected?.networkName
                ) : (
                  <Text fontSize="18px">Select Network</Text>
                )}
              </Text>
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
                  tokenList,
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
            <TokenList
              tokenList={displayTokenList}
              tokenSelected={tokenSelected}
              onClickToken={handleClickTokenItem}
              disabledToken={disabledToken}
            />
          </Box>
        </Box>
      </Box>
    </StyledNetworkBox>
  );
};

export default NetworkTokenBox;
