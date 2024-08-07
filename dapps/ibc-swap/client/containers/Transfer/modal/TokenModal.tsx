import { useContext, useEffect, useState } from 'react';
import {
  Box,
  Button,
  List,
  ListItem,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
} from '@chakra-ui/react';
import { COLOR } from '@/styles/color';
import { SearchInput } from '@/components/SearchInput/InputSearch';
import {
  TransferTokenItem,
  TransferTokenItemProps,
} from '@/components/TransferTokenItem/TransferTokenItem';
import TransferContext from '@/contexts/TransferContext';
import { useChain } from '@cosmos-kit/react';
import { cosmos } from 'interchain';
import { defaultChainName } from '@/constants';

import { StyledTokenBox } from '../index.style';

type TokenBoxComponentProps = {
  tokenList: Array<TransferTokenItemProps>;
  currentToken: TransferTokenItemProps;
  balanceList: string[];
  // eslint-disable-next-line no-unused-vars
  setCurrentToken: (token: TransferTokenItemProps) => void;
};

const TokenBoxComponent = ({
  tokenList,
  currentToken,
  balanceList,
  setCurrentToken,
}: TokenBoxComponentProps) => {
  return (
    <StyledTokenBox>
      <Box
        borderBottomWidth="1px"
        pb="16px"
        borderBottomColor={COLOR.neutral_5}
      >
        <SearchInput placeholder="Search Token" />
      </Box>
      <List maxH="416px" overflowY="scroll">
        <ListItem mb={4}>
          {tokenList?.map((token, i) => (
            <TransferTokenItem
              key={token.tokenName}
              tokenId={token.tokenId}
              tokenName={token.tokenName}
              tokenLogo={token.tokenLogo}
              tokenSymbol={token.tokenSymbol}
              balance={balanceList?.[i] || '0.00'}
              onClick={() =>
                setCurrentToken({ ...token, balance: balanceList?.[i] })
              }
              isActive={currentToken?.tokenId === token.tokenId}
            />
          ))}
        </ListItem>
      </List>
    </StyledTokenBox>
  );
};

export type NetworkModalProps = {
  isOpen: boolean;
  onClose: () => void;
  tokenList: TransferTokenItemProps[];
  chainName?: string;
};

export const TokenModal = ({
  isOpen,
  onClose,
  tokenList,
  chainName,
}: NetworkModalProps) => {
  const { selectedToken, setSelectedToken } = useContext(TransferContext);
  const { address, getRpcEndpoint } = useChain(chainName || defaultChainName);
  const [balanceList, setbalanceList] = useState<string[]>([]);

  const [currentToken, setCurrentToken] =
    useState<TransferTokenItemProps>(selectedToken);

  const handleSave = () => {
    setSelectedToken(currentToken);
    onClose();
  };

  const handleClose = () => {
    setCurrentToken(selectedToken);
    onClose();
  };

  useEffect(() => {
    if (selectedToken) {
      setCurrentToken(selectedToken);
    }
  }, [selectedToken]);

  useEffect(() => {
    setbalanceList([]);
    const fetchBalances = async () => {
      const rpcEndpoint = (await getRpcEndpoint()) as string;
      if (!rpcEndpoint || !address) {
        return;
      }
      const client = await cosmos.ClientFactory.createRPCQueryClient({
        rpcEndpoint,
      });
      if (!client) {
        return;
      }

      const allBl = await client.cosmos.bank.v1beta1.allBalances({
        address,
      });

      const balances = tokenList.map((token) => {
        return allBl?.balances?.find(
          (balance) => balance.denom === token.tokenId,
        )?.amount;
      }) as string[];
      setbalanceList(balances);
    };
    fetchBalances();
  }, [tokenList, address, chainName]);

  return (
    <>
      <Modal isCentered onClose={handleClose} isOpen={isOpen}>
        <ModalOverlay backdropFilter="blur(2px)" />
        <ModalContent
          backgroundColor={COLOR.neutral_6}
          borderRadius="16px"
          padding="24px"
          gap="24px"
          h="670px"
          maxW="432px"
        >
          <ModalHeader p={0}>Select token</ModalHeader>
          <ModalCloseButton w="24px" h="24px" top="24px" right="24px" />
          <ModalBody p={0}>
            <Box
              h="504px"
              gap="16px"
              display="flex"
              justifyContent="space-between"
            >
              <TokenBoxComponent
                tokenList={tokenList}
                balanceList={balanceList}
                currentToken={currentToken}
                setCurrentToken={setCurrentToken}
              />
            </Box>
          </ModalBody>
          <ModalFooter p={0} display="flex" justifyContent="space-between">
            <Button
              w={184}
              h={42}
              borderRadius={10}
              borderWidth={1}
              borderColor={COLOR.neutral_4}
              backgroundColor={COLOR.neutral_6}
              shadow="1px 1px 2px 0px #FCFCFC1F inset"
              p="10px 18px 10px 18px"
              mr={3}
              onClick={handleClose}
              color={COLOR.neutral_1}
              fontSize={16}
              fontWeight={700}
              lineHeight="22px"
              _hover={{
                bg: COLOR.neutral_6,
              }}
            >
              Cancel
            </Button>
            <Button
              w={184}
              h={42}
              p="10px 18px 10px 18px"
              borderRadius={10}
              bg={COLOR.primary}
              shadow="2px 2px 3px 0px #FCFCFC66 inset"
              color={COLOR.neutral_1}
              fontSize={16}
              fontWeight={700}
              lineHeight="22px"
              onClick={handleSave}
              _hover={{
                bg: COLOR.primary,
              }}
            >
              Save & Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};
