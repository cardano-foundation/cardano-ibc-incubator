'use client';
import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  Box,
  Checkbox,
  Heading,
  Image,
  Text,
  Tooltip,
  useDisclosure,
} from '@chakra-ui/react';

import { FaArrowDown } from 'react-icons/fa6';
import TokenBox from '@/components/TokenBox';
import CustomInput from '@/components/CustomInput';
import InfoIcon from '@/assets/icons/info.svg';
import DefaultCosmosNetworkIcon from '@/assets/icons/cosmos-icon.svg';
import { COLOR } from '@/styles/color';
import SwapContext from '@/contexts/SwapContext';
import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import BigNumber from 'bignumber.js';
import { formatNumberInput } from '@/utils/string';
import { allChains } from '@/configs/customChainInfo';
import TransferContext from '@/contexts/TransferContext';
import { verifyAddress } from '@/utils/address';
import IBCParamsContext from '@/contexts/IBCParamsContext';
import TransactionFee from './TransactionFee';
import SettingSlippage from './SettingSlippage';
import SelectNetworkModal from './SelectNetworkModal';
import { SwapResult } from './SwapResult';

// import debounce from 'lodash/debounce';
import { debounce } from '@/utils/helper';

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
  const [errorAddressMsg, setErrorAddressMsg] = useState<string>('');

  const { isOpen, onOpen, onClose } = useDisclosure();

  const { swapData, setSwapData } = useContext(SwapContext);
  const { calculateSwapEst } = useContext(IBCParamsContext);
  const { handleReset: handleResetTransferData } = useContext(TransferContext);

  const openModalSelectNetwork = () => {
    onOpen();
  };

  // const handleChangePositionToken = () => {
  //   handleSwitchToken();
  // };

  const handleChangeReceiveAdrress = (value: string) => {
    if (isCheckedAnotherWallet) {
      const isValidAddress = verifyAddress(
        value,
        process.env.NEXT_PUBLIC_CARDANO_CHAIN_ID,
      );
      if (!value) {
        setErrorAddressMsg('Address is required');
      } else if (!isValidAddress) {
        setErrorAddressMsg('Invalid address');
      } else {
        setErrorAddressMsg('');
      }
    } else {
      setErrorAddressMsg('');
    }
    setSwapData({
      ...swapData,
      receiveAdrress: value,
    });
  };

  const handleChangeAmount = (amount: string, isFromToken?: boolean) => {
    const { fromToken, toToken } = swapData;

    const maxAmount = isFromToken
      ? fromToken.balance
      : BigNumber(fromToken.balance!)
          .dividedBy(rate)
          .toFixed(toToken.tokenExponent || 0)
          .toString();

    const exponent = isFromToken
      ? fromToken.tokenExponent
      : toToken.tokenExponent;
    const displayString = formatNumberInput(amount, exponent || 0, maxAmount);
    let fromSwapAmount = '';
    if (displayString !== '0') {
      if (isFromToken) {
        fromSwapAmount = displayString;
      } else {
        fromSwapAmount = BigNumber(displayString)
          .multipliedBy(rate)
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
    calculateSwapEst({
      fromChain: swapData.fromToken.network.networkId!,
      tokenInDenom: swapData.fromToken.tokenId,
      tokenInAmount: swapData.fromToken.swapAmount! || '123',
      toChain: swapData.toToken.network.networkId!,
      tokenOutDenom: swapData.toToken.tokenId,
    });
    // setIsSubmitSwap(true);
    // setIsCheckAnotherWallet(false);
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
      } else if (swapData?.receiveAdrress && !errorAddressMsg) {
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

  const calculateAndSetSwapEst = (swapData: any) => {
    console.log(swapData);
    calculateSwapEst({
      fromChain: swapData.fromToken.network.networkId!,
      tokenInDenom: swapData.fromToken.tokenId,
      tokenInAmount: swapData.fromToken.swapAmount! || '123',
      toChain: swapData.toToken.network.networkId!,
      tokenOutDenom: swapData.toToken.tokenId,
    }).then(console.log);
  };

  const debounceEstAmount = () =>
    debounce(calculateAndSetSwapEst, 1000)(swapData);

  useEffect(() => {
    // check amount out
    if (
      swapData?.fromToken?.swapAmount &&
      swapData?.fromToken?.network?.networkId &&
      swapData?.fromToken?.tokenId &&
      swapData?.toToken?.network?.networkId &&
      swapData?.toToken?.tokenId
    ) {
      debounceEstAmount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(swapData), isCheckedAnotherWallet]);

  const enableSwitch =
    swapData?.fromToken?.tokenId && swapData?.toToken?.tokenId;

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
          handleChangeAmount={(event: React.ChangeEvent<HTMLInputElement>) =>
            handleChangeAmount(event.target.value, true)
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
          <FaArrowDown color={COLOR.neutral_1} />
        </StyledSwitchNetwork>
        <TokenBox
          fromOrTo="To"
          handleClick={openModalSelectNetwork}
          token={swapData.toToken}
          handleChangeAmount={() => {}}
        />
        {onShowEstimateFee()}
        <Box display="flex" alignItems="center" mt={4} gap={2}>
          <Checkbox
            isChecked={isCheckedAnotherWallet}
            onChange={(e) => {
              setIsCheckAnotherWallet(e.target.checked);
              const errMsg = e.target.checked ? 'Address is requred' : '';
              setErrorAddressMsg(errMsg);
            }}
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
            errorMsg={errorAddressMsg}
          />
        )}

        {/* <StyledSwapButton disabled={!enableSwap} onClick={() => handleSwap()}> */}
        <StyledSwapButton onClick={() => handleSwap()}>
          <Text fontSize={18} fontWeight={700} lineHeight="24px">
            Swap
          </Text>
        </StyledSwapButton>
      </StyledSwap>
    </StyledWrapContainer>
  );
};

export default SwapContainer;
