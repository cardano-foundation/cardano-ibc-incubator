'use client';

import React, { useContext, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Box,
  Checkbox,
  Heading,
  Image,
  Text,
  Tooltip,
  useDisclosure,
} from '@chakra-ui/react';
import { toast } from 'react-toastify';
import { useAddress, useWallet } from '@meshsdk/react';
import { FaArrowDown } from 'react-icons/fa6';
import * as CSL from '@emurgo/cardano-serialization-lib-browser';
import TokenBox from '@/components/TokenBox';
import CustomInput from '@/components/CustomInput';
import InfoIcon from '@/assets/icons/info.svg';
import DefaultCosmosNetworkIcon from '@/assets/icons/cosmos-icon.svg';
import { COLOR } from '@/styles/color';
import SwapContext from '@/contexts/SwapContext';
import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import { formatNumberInput, formatPrice } from '@/utils/string';
import { allChains } from '@/configs/customChainInfo';
import TransferContext from '@/contexts/TransferContext';
import { verifyAddress } from '@/utils/address';
import { HOUR_IN_NANOSEC } from '@/constants';
import { unsignedTxSwapFromCardano } from '@/utils/buildSwapTx';
import { CARDANO_CHAIN_ID } from '@/configs/runtime';
import { estimateSwap } from '@/apis/restapi/cardano';
import TransactionFee from './TransactionFee';
import SettingSlippage from './SettingSlippage';
import SelectNetworkModal from './SelectNetworkModal';
import { SwapResult } from './SwapResult';

import StyledSwap, {
  StyledSwapButton,
  StyledSwitchNetwork,
  StyledWrapContainer,
} from './index.style';

type EstimateFeeType = {
  display: boolean;
  canEst: boolean;
  msgs: any[];
  estReceiveAmount: string;
  estMinimumReceived: string;
  estTime: string;
  estFee: string;
};

const initEstData = {
  display: false,
  canEst: false,
  msgs: [],
  estReceiveAmount: '',
  estMinimumReceived: '',
  estFee: '----',
  estTime: '----',
};

const SwapContainer = () => {
  const [isCheckedAnotherWallet, setIsCheckAnotherWallet] =
    useState<boolean>(false);

  const cardanoAddress = useAddress();
  const { wallet: cardanoWallet } = useWallet();

  const [networkList, setNetworkList] = useState<NetworkItemProps[]>([]);
  const [lastTxHash, setLastTxHash] = useState<string>('');
  const [isSubmitSwap, setIsSubmitSwap] = useState<boolean>(false);
  const [errorAddressMsg, setErrorAddressMsg] = useState<string>('');
  const [isEstimating, setIsEstimating] = useState<boolean>(false);

  const [estData, setEstimateData] = useState<EstimateFeeType>(initEstData);

  const { isOpen, onOpen, onClose } = useDisclosure();

  const { swapData, setSwapData, handleResetData } = useContext(SwapContext);
  const { handleReset: handleResetTransferData } = useContext(TransferContext);

  const resetLastTxData = () => {
    setEstimateData(initEstData);
    setLastTxHash('');
    handleResetData();
  };

  const openModalSelectNetwork = () => {
    onOpen();
  };

  const handleChangeReceiveAdrress = (value: string) => {
    if (isCheckedAnotherWallet) {
      const isValidAddress = verifyAddress(value, CARDANO_CHAIN_ID);
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
      receiveAdrress: isCheckedAnotherWallet ? value : cardanoAddress,
    });
  };

  const handleChangeAmount = (amount: string, isFromToken?: boolean) => {
    const { fromToken, toToken } = swapData;

    const maxAmount = fromToken.balance;
    const exponent = isFromToken
      ? fromToken.tokenExponent
      : toToken.tokenExponent;
    const displayString = formatNumberInput(amount, exponent || 0, maxAmount);

    setSwapData({
      ...swapData,
      fromToken: {
        ...swapData.fromToken,
        swapAmount: displayString,
      },
      toToken: {
        ...swapData.toToken,
      },
    });
  };

  const handleSwap = async () => {
    if (!estData.canEst || !cardanoWallet?.signTx) {
      return;
    }

    try {
      const signedTx = await cardanoWallet.signTx(estData.msgs[0], true);
      const txHash = await cardanoWallet.submitTx(signedTx);
      if (txHash) {
        setLastTxHash(txHash);
        setIsSubmitSwap(true);
      }
    } catch (e: unknown) {
      console.log(e);
      // @ts-ignore
      toast.error(e?.message?.toString() || '', { theme: 'colored' });
    }
  };

  useEffect(() => {
    const networkListData: NetworkItemProps[] = allChains.map((chain) => ({
      networkId: chain.chain_id,
      ibcChainId: chain.ibc_chain_id || chain.chain_id,
      networkLogo: chain?.logo_URIs?.svg || DefaultCosmosNetworkIcon.src,
      networkName: chain.chain_name,
      networkPrettyName: chain?.pretty_name,
    }));
    handleResetTransferData();
    setNetworkList(networkListData);
  }, [handleResetTransferData]);

  const calculateAndSetSwapEst = async () => {
    setEstimateData({ ...initEstData });
    setIsEstimating(true);

    try {
      const res = await estimateSwap({
        fromChainId: swapData.fromToken.network.networkId!,
        tokenInDenom: swapData.fromToken.tokenId,
        tokenInAmount: swapData.fromToken.swapAmount!,
        toChainId: swapData.toToken.network.networkId!,
        tokenOutDenom: swapData.toToken.tokenId,
      });

      if (!res) {
        setEstimateData({ ...initEstData });
        return;
      }

      const {
        message,
        tokenOutAmount,
        tokenOutTransferBackAmount,
        outToken,
        transferRoutes,
        transferBackRoutes,
      } = res;

      if (message) {
        toast.error(message, { theme: 'colored' });
        setEstimateData({ ...initEstData });
        return;
      }

      if (!outToken) {
        setEstimateData({ ...initEstData });
        return;
      }

      setSwapData({
        ...swapData,
        toToken: {
          ...swapData.toToken,
          swapAmount: tokenOutAmount,
        },
      });

      const msg = await unsignedTxSwapFromCardano({
        sender: cardanoAddress!,
        tokenIn: {
          amount: swapData.fromToken.swapAmount!,
          denom: swapData.fromToken.tokenId,
        },
        tokenOutDenom: outToken,
        receiver: swapData.receiveAdrress || cardanoAddress!,
        transferRoutes,
        transferBackRoutes,
        slippagePercentage: swapData.slippageTolerance!,
        timeoutTimeOffset: HOUR_IN_NANOSEC,
      });

      let estDataResult: any;
      try {
        const unsignedTx = Buffer.from(msg[0].value, 'base64').toString('hex');
        const tx = CSL.Transaction.from_hex(unsignedTx);
        const estFee = tx.body().fee().to_str();
        estDataResult = {
          display: true,
          canEst: true,
          msgs: [unsignedTx],
          estFee: `${formatPrice(estFee)} lovelace`,
          estTime: '~2 mins',
        };
      } catch (e) {
        console.log(e);
        estDataResult = {
          display: false,
          canEst: false,
          msgs: [],
        };
      }

      setEstimateData({
        ...initEstData,
        ...estDataResult,
        estReceiveAmount: tokenOutAmount,
        estMinimumReceived: `${tokenOutTransferBackAmount} ${swapData.toToken.tokenId.toUpperCase()}`,
      });
    } finally {
      setIsEstimating(false);
    }
  };

  useEffect(() => {
    setEstimateData(initEstData);

    if (
      swapData?.fromToken?.swapAmount &&
      cardanoAddress &&
      swapData?.fromToken?.network?.networkId &&
      swapData?.fromToken?.tokenId &&
      swapData?.toToken?.network?.networkId &&
      swapData?.toToken?.tokenId
    ) {
      const timeout = window.setTimeout(() => {
        calculateAndSetSwapEst();
      }, 450);

      return () => {
        window.clearTimeout(timeout);
      };
    }

    return undefined;
  }, [
    JSON.stringify(swapData?.fromToken),
    JSON.stringify(swapData?.toToken?.network),
    swapData?.toToken?.tokenId,
    isCheckedAnotherWallet,
    cardanoAddress,
  ]);

  return (
    <AnimatePresence mode="wait">
      {isSubmitSwap ? (
        <motion.div
          key="swap-result"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.2 }}
        >
          <SwapResult
            setIsSubmitted={setIsSubmitSwap}
            minimumReceived={estData.estMinimumReceived || ''}
            estFee={estData.estFee}
            resetLastTxData={resetLastTxData}
            lastTxHash={lastTxHash}
          />
        </motion.div>
      ) : (
        <motion.div
          key="swap-form"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.22 }}
        >
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
              <motion.div
                animate={{ y: [0, -2, 0] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <StyledSwitchNetwork>
                  <FaArrowDown color={COLOR.neutral_1} />
                </StyledSwitchNetwork>
              </motion.div>
              <TokenBox
                fromOrTo="To"
                handleClick={openModalSelectNetwork}
                token={swapData.toToken}
                handleChangeAmount={() => {}}
              />
              <AnimatePresence initial={false}>
                {(isEstimating || estData.canEst) && (
                  <motion.div
                    key="swap-estimate"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                  >
                    <TransactionFee
                      minimumReceived={estData.estMinimumReceived}
                      estFee={estData.estFee}
                      isLoading={isEstimating}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              <Box display="flex" alignItems="center" mt={4} gap={2}>
                <Checkbox
                  isChecked={isCheckedAnotherWallet}
                  onChange={(e) => {
                    setIsCheckAnotherWallet(e.target.checked);
                    handleChangeReceiveAdrress('');
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
              <AnimatePresence initial={false}>
                {isCheckedAnotherWallet && (
                  <motion.div
                    key="alternate-receiver"
                    initial={{ opacity: 0, height: 0, y: -8 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <CustomInput
                      title="Destination address"
                      placeholder="Enter destination address here..."
                      onChange={handleChangeReceiveAdrress}
                      errorMsg={errorAddressMsg}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              <StyledSwapButton
                disabled={!estData.canEst || isEstimating}
                onClick={() => handleSwap()}
              >
                <Text fontSize={18} fontWeight={700} lineHeight="24px">
                  {isEstimating ? 'Estimating...' : 'Swap'}
                </Text>
              </StyledSwapButton>
            </StyledSwap>
          </StyledWrapContainer>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SwapContainer;
