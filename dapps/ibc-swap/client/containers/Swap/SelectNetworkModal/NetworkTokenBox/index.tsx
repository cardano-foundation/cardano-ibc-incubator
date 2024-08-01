import React, { useState } from 'react';
import { Box, Image, Text } from '@chakra-ui/react';

import { COLOR } from '@/styles/color';
import { SearchInput } from '@/components/SearchInput/InputSearch';
import {
  NetworkItemProps,
  NetworkList,
} from '@/components/NetworkList/NetworkList';
import { TokenItemProps, TokenList } from '@/components/TokenList/TokenList';
import EarchIcon from '@/assets/icons/earth.svg';
import { StyledNetworkBox, StyledNetworkBoxHeader } from './index.style';

import { NetworkListData, TokenListData } from '../data';

type NetworkTokenBoxProps = {
  fromOrTo?: string;
};

const NetworkTokenBox = ({ fromOrTo = 'From' }: NetworkTokenBoxProps) => {
  const [tokenSelected, setTokenSelected] = useState<TokenItemProps>();
  const [networkSelected, setNetworkSelected] = useState<NetworkItemProps>();

  const handleClickTokenItem = (token: TokenItemProps) => {
    setTokenSelected(token);
  };

  const handleClickNetworkItem = (network: NetworkItemProps) => {
    setNetworkSelected(network);
  };

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
                {tokenSelected?.tokenName}
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
      <Box display="flex">
        <Box>
          <Box
            p="16px"
            borderBottomWidth="1px"
            borderRightWidth="1px"
            borderColor={COLOR.neutral_5}
          >
            <SearchInput placeholder="Search network" />
          </Box>
          <Box
            maxH="368px"
            borderRightWidth="1px"
            borderColor={COLOR.neutral_5}
            overflowY="scroll"
          >
            <NetworkList
              networkList={NetworkListData}
              networkSelected={networkSelected}
              onClickNetwork={handleClickNetworkItem}
            />
          </Box>
        </Box>
        <Box>
          <Box
            p="16px"
            borderBottomWidth="1px"
            borderRightWidth="1px"
            borderColor={COLOR.neutral_5}
          >
            <SearchInput placeholder="Search token" />
          </Box>
          <Box
            maxH="368px"
            overflowY="scroll"
            borderRightWidth="1px"
            borderColor={COLOR.neutral_5}
          >
            <TokenList
              tokenList={TokenListData}
              tokenSelected={tokenSelected}
              onClickToken={handleClickTokenItem}
            />
          </Box>
        </Box>
      </Box>
    </StyledNetworkBox>
  );
};

export default NetworkTokenBox;
