import React, { useContext, useEffect, useState } from 'react';
import {
  Box,
  Checkbox,
  Heading,
  Image,
  Text,
  Tooltip,
  useDisclosure,
} from '@chakra-ui/react';

import SwitchIcon from '@/assets/icons/transfer.svg';
import TokenBox from '@/components/TokenBox';
import CustomInput from '@/components/CustomInput';
import InfoIcon from '@/assets/icons/info.svg';
import DefaultCosmosNetworkIcon from '@/assets/icons/cosmos-icon.svg';
import { COLOR } from '@/styles/color';
import SwapContext from '@/contexts/SwapContext';
import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import { SwapTokenType } from '@/types/SwapDataType';
import BigNumber from 'bignumber.js';
import { formatNumberInput } from '@/utils/string';
import { allChains } from '@/configs/customChainInfo';
import TransferContext from '@/contexts/TransferContext';
import TransactionFee from './TransactionFee';
import SettingSlippage from './SettingSlippage';
import SelectNetworkModal from './SelectNetworkModal';
import { SwapResult } from './SwapResult';

import StyledSwap, {
  StyledSwapButton,
  StyledSwitchNetwork,
  StyledWrapContainer,
} from './index.style';

const SwapContainer = () => {
  const [isCheckedAnotherWallet, setIsCheckAnotherWallet] =
    useState<boolean>(false);
  const [networkList, setNetworkList] = useState<NetworkItemProps[]>([]);
  const [rate, setRate] = useState<string>('0');
  const [enableSwap, setEnableSwap] = useState<boolean>(false);
  const [isSubmitSwap, setIsSubmitSwap] = useState<boolean>(false);

  const { isOpen, onOpen, onClose } = useDisclosure();

  const { swapData, setSwapData, handleSwitchToken } = useContext(SwapContext);
  const { handleReset: handleResetTransferData } = useContext(TransferContext);

  const openModalSelectNetwork = () => {
    onOpen();
  };

  const handleChangePositionToken = () => {
    handleSwitchToken();
  };

  const handleChangeReceiveAdrress = (value: string) => {
    setSwapData({
      ...swapData,
      receiveAdrress: value,
    });
  };

  const handleChangeAmount = (
    token: SwapTokenType,
    amount: string,
    balance?: string,
    isFromToken?: boolean,
  ) => {
    const displayString = formatNumberInput(
      amount,
      token.tokenExponent || 0,
      balance,
    );
    let toSwapAmount = '';
    let fromSwapAmount = '';
    if (displayString !== '0') {
      if (isFromToken) {
        fromSwapAmount = displayString;
        toSwapAmount = BigNumber(displayString)
          .dividedBy(BigNumber(rate))
          .toFixed(swapData.toToken?.tokenExponent || 0)
          .toString();
      } else {
        toSwapAmount = displayString;
        fromSwapAmount = BigNumber(displayString)
          .multipliedBy(BigNumber(rate))
          .toFixed(swapData.fromToken?.tokenExponent || 0)
          .toString();
      }
    }
    setSwapData({
      ...swapData,
      fromToken: {
        ...swapData.fromToken,
        swapAmount: fromSwapAmount,
      },
      toToken: {
        ...swapData.toToken,
        swapAmount: toSwapAmount,
      },
    });
  };

  const onShowEstimateFee = (): React.JSX.Element | null => {
    if (swapData?.fromToken?.swapAmount && swapData?.toToken?.swapAmount) {
      return <TransactionFee />;
    }
    return null;
  };

  const handleSwap = async () => {
    console.log(swapData);
    setIsSubmitSwap(true);
  };

  useEffect(() => {
    const fetchNetworkList = async () => {
      // TODO: fetch network list
      const networkListData: NetworkItemProps[] = allChains.map((chain) => ({
        networkId: chain.chain_id,
        networkLogo: chain?.logo_URIs?.svg || DefaultCosmosNetworkIcon.src,
        networkName: chain.chain_name,
        networkPrettyName: chain?.pretty_name,
      }));
      setNetworkList(networkListData);
    };
    handleResetTransferData();
    fetchNetworkList();
  }, []);

  useEffect(() => {
    const calculateRate = async () => {
      if (!!swapData?.fromToken?.tokenId && !!swapData?.toToken?.tokenId) {
        // TODO: calculate rate
        // fake rate tokenFrom/tokenTo
        setRate('2.0');
      }
    };

    calculateRate();
  }, [swapData?.fromToken?.tokenId, swapData?.toToken?.tokenId]);

  useEffect(() => {
    if (
      BigNumber(swapData?.fromToken?.swapAmount || '').isGreaterThan(
        BigNumber(0),
      ) &&
      BigNumber(swapData?.toToken?.swapAmount || '').isGreaterThan(BigNumber(0))
    ) {
      if (!isCheckedAnotherWallet) {
        setEnableSwap(true);
      } else if (swapData?.receiveAdrress) {
        // if isValidAddress
        setEnableSwap(true);
      } else {
        setEnableSwap(false);
      }
    } else {
      setEnableSwap(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(swapData), isCheckedAnotherWallet]);

  return isSubmitSwap ? (
    <SwapResult
      setIsSubmitted={setIsSubmitSwap}
      minimumReceived={swapData.toToken.swapAmount || ''}
      estFee="0.123"
      resetLastTxData={() => {}}
      lastTxHash=""
    />
  ) : (
    <StyledWrapContainer>
      <StyledSwap>
        <Box display="flex" justifyContent="space-between">
          <Heading className="title">Swap</Heading>
          <SettingSlippage />
        </Box>
        <SelectNetworkModal
          isOpen={isOpen}
          onClose={onClose}
          networkList={networkList}
        />
        <TokenBox
          handleClick={openModalSelectNetwork}
          token={swapData.fromToken}
          handleChangeAmount={(
            event: React.ChangeEvent<HTMLInputElement>,
            balance: string,
          ) =>
            handleChangeAmount(
              swapData.fromToken,
              event.target.value,
              balance,
              true,
            )
          }
        />
        <StyledSwitchNetwork
          _hover={{
            bgColor: swapData?.fromToken?.tokenId && COLOR.neutral_4,
            cursor: swapData?.fromToken?.tokenId ? 'pointer' : 'default',
          }}
          onClick={handleChangePositionToken}
        >
          <Image src={SwitchIcon.src} alt="" />
        </StyledSwitchNetwork>
        <TokenBox
          fromOrTo="To"
          handleClick={openModalSelectNetwork}
          token={swapData.toToken}
          handleChangeAmount={(
            event: React.ChangeEvent<HTMLInputElement>,
            // eslint-disable-next-line no-unused-vars
            balance: string,
          ) =>
            handleChangeAmount(
              swapData.fromToken,
              event.target.value,
              '',
              false,
            )
          }
        />
        {onShowEstimateFee()}
        <Box display="flex" alignItems="center" mt={4} gap={2}>
          <Checkbox
            isChecked={isCheckedAnotherWallet}
            onChange={(e) => setIsCheckAnotherWallet(e.target.checked)}
            size="md"
          >
            Receive to another wallet
          </Checkbox>
          <Tooltip
            borderRadius="8px"
            bg={COLOR.background}
            hasArrow
            label="Receive to another wallet"
          >
            <Image src={InfoIcon.src} alt="" />
          </Tooltip>
        </Box>
        {isCheckedAnotherWallet && (
          <CustomInput
            title="Destination address"
            placeholder="Enter destination address here..."
            onChange={handleChangeReceiveAdrress}
          />
        )}

        <StyledSwapButton disabled={!enableSwap} onClick={() => handleSwap()}>
          <Text fontSize={18} fontWeight={700} lineHeight="24px">
            Swap
          </Text>
        </StyledSwapButton>
      </StyledSwap>
    </StyledWrapContainer>
  );
};

export default SwapContainer;
