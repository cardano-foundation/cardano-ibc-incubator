/* eslint-disable no-unused-vars */
import React, { useContext, useEffect, useState } from 'react';
import {
  Modal,
  ModalOverlay,
  ModalHeader,
  ModalContent,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  Button,
  Box,
  Image,
} from '@chakra-ui/react';
import { COLOR } from '@/styles/color';
import SwitchIcon from '@/assets/icons/transfer.svg';
import { FaArrowRight } from 'react-icons/fa';
import { SwapTokenType } from '@/types/SwapDataType';
import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import SwapContext from '@/contexts/SwapContext';
import { FROM_TO, OSMOSIS_CHAIN_ID } from '@/constants';
import NetworkTokenBox from './NetworkTokenBox';

import { StyledSwitchNetwork } from './index.style';

type SelectNetworkModalProps = {
  isOpen: boolean;
  onClose: () => void;
  networkList: NetworkItemProps[];
};

const SelectNetworkModal = ({
  isOpen,
  onClose,
  networkList,
}: SelectNetworkModalProps) => {
  const { swapData, setSwapData } = useContext(SwapContext);

  const [tokenFromSelected, setTokenFromSelected] = useState<SwapTokenType>(
    swapData.fromToken,
  );
  const [tokenToSelected, setTokenToSelected] = useState<SwapTokenType>(
    swapData.toToken,
  );
  const [disabledNetwork, setDisabledNetwork] = useState<{
    fromNetworkDisabled: NetworkItemProps | undefined;
    toNetworkDisabled: NetworkItemProps | undefined;
  }>({ fromNetworkDisabled: undefined, toNetworkDisabled: undefined });

  const handleSaveModal = () => {
    setSwapData({
      ...swapData,
      fromToken: tokenFromSelected!,
      toToken: tokenToSelected!,
    });
    onClose();
  };

  const handleChangePositionToken = () => {
    const tokenFrom = tokenFromSelected;
    const tokenTo = tokenToSelected;
    setTokenFromSelected(tokenTo);
    setTokenToSelected(tokenFrom);
    setDisabledNetwork({
      fromNetworkDisabled: tokenFrom?.network,
      toNetworkDisabled: tokenTo?.network,
    });
  };

  const handleCancel = () => {
    setTokenFromSelected(swapData?.fromToken);
    setTokenToSelected(swapData?.toToken);
    onClose();
  };

  const handleChangeNetwork = (network: NetworkItemProps, fromOrTo: string) => {
    if (fromOrTo === FROM_TO.FROM) {
      setDisabledNetwork((prev) => ({
        ...prev,
        toNetworkDisabled: network,
      }));
    } else {
      setDisabledNetwork((prev) => ({
        ...prev,
        fromNetworkDisabled: network,
      }));
    }
  };

  useEffect(() => {
    if (swapData?.fromToken?.tokenId) {
      setTokenFromSelected(swapData.fromToken);
    }
    if (swapData?.toToken?.tokenId) {
      setTokenToSelected(swapData.toToken);
    }
    if (swapData?.fromToken?.network && swapData?.toToken?.network) {
      setDisabledNetwork({
        fromNetworkDisabled: swapData.toToken.network,
        toNetworkDisabled: swapData.fromToken.network,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapData?.fromToken?.tokenId, swapData?.toToken?.tokenId]);

  const enableSwitch = tokenToSelected?.tokenId && tokenFromSelected?.tokenId;

  return (
    <Modal isCentered onClose={onClose} isOpen={isOpen}>
      <ModalOverlay backdropFilter="blur(2px)" />
      <ModalContent
        backgroundColor={COLOR.neutral_6}
        borderRadius="16px"
        padding="24px"
        gap="24px"
        h="694px"
        maxW="990px"
      >
        <ModalHeader p={0}>Select network & token</ModalHeader>
        <ModalCloseButton w="24px" h="24px" top="24px" right="24px" />
        <ModalBody p={0}>
          <Box
            h="528px"
            gap="16px"
            display="flex"
            justifyContent="space-between"
          >
            <NetworkTokenBox
              onChooseToken={setTokenFromSelected}
              networkList={networkList.filter(
                (network) =>
                  network.networkId ===
                  process.env.NEXT_PUBLIC_CARDANO_CHAIN_ID,
              )}
              selectedToken={tokenFromSelected}
              disabledToken={tokenToSelected}
              disabledNetwork={disabledNetwork}
              setDisabledNetwork={(network: NetworkItemProps) =>
                handleChangeNetwork(network, 'From')
              }
            />
            <StyledSwitchNetwork
            // _hover={{
            //   bgColor: enableSwitch && COLOR.neutral_4,
            //   cursor: enableSwitch ? 'pointer' : 'default',
            // }}
            // onClick={enableSwitch ? handleChangePositionToken : () => {}}
            >
              {/* <Image src={SwitchIcon.src} alt="" /> */}
              <FaArrowRight color={COLOR.neutral_1} />
            </StyledSwitchNetwork>
            <NetworkTokenBox
              fromOrTo="To"
              onChooseToken={setTokenToSelected}
              networkList={networkList.filter(
                (n) => n.networkId === OSMOSIS_CHAIN_ID,
              )}
              selectedToken={tokenToSelected}
              disabledToken={tokenFromSelected}
              disabledNetwork={disabledNetwork}
              setDisabledNetwork={(network: NetworkItemProps) =>
                handleChangeNetwork(network, 'To')
              }
            />
          </Box>
        </ModalBody>
        <ModalFooter p={0}>
          <Button
            w={90}
            h={42}
            borderRadius={10}
            borderWidth={1}
            borderColor={COLOR.neutral_4}
            backgroundColor={COLOR.neutral_6}
            shadow="1px 1px 2px 0px #FCFCFC1F inset"
            p="10px 18px 10px 18px"
            mr={3}
            onClick={handleCancel}
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
            p="10px 18px 10px 18px"
            borderRadius={10}
            bg={COLOR.primary}
            shadow="2px 2px 3px 0px #FCFCFC66 inset"
            color={COLOR.neutral_1}
            isDisabled={!enableSwitch}
            fontSize={16}
            fontWeight={700}
            lineHeight="22px"
            _hover={{
              bg: COLOR.primary,
            }}
            onClick={handleSaveModal}
          >
            Save & Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default SelectNetworkModal;
