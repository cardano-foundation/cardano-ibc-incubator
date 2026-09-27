'use client';

import React, { useContext, useEffect, useRef, useState } from 'react';
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
import { useWallet } from '@meshsdk/react';
import { FaArrowDown } from 'react-icons/fa6';
import * as CSL from '@emurgo/cardano-serialization-lib-browser';
import TokenBox from '@/components/TokenBox';
import { useSafeCardanoAddress } from '@/hooks/useSafeCardanoAddress';
import CustomInput from '@/components/CustomInput';
import InfoIcon from '@/assets/icons/info.svg';
import DefaultCosmosNetworkIcon from '@/assets/icons/cosmos-icon.svg';
import { COLOR } from '@/styles/color';
import SwapContext from '@/contexts/SwapContext';
import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import {
  baseAmountToDisplayAmount,
  formatNumberInput,
  formatPrice,
} from '@/utils/string';
import { swapRequestKey, tokenAmount } from '@/utils/token';
import {
  tokenPrimaryLabel,
  tokenUsesBaseUnits,
} from '@/utils/cardanoAssetPresentation';
import { allChains } from '@/configs/customChainInfo';
import TransferContext from '@/contexts/TransferContext';
import {
  verifyAddress,
  verifyCardanoPaymentKeyHashAddress,
} from '@/utils/address';
import { PACKET_TIMEOUT_NANOSEC } from '@/constants';
import { unsignedTxSwapFromCardano } from '@/utils/buildSwapTx';
import { CARDANO_CHAIN_ID } from '@/configs/runtime';
import { estimateLocalOsmosisSwap } from '@/apis/restapi/cardano';
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
  requestKey?: string;
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

  const cardanoAddress = useSafeCardanoAddress();
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

  const receiver = isCheckedAnotherWallet
    ? swapData.receiveAdrress
    : cardanoAddress;
  const requestKey = errorAddressMsg
    ? undefined
    : swapRequestKey(
        swapData,
        cardanoAddress || undefined,
        receiver || undefined,
      );
  const currentRequestKey = useRef(requestKey);
  currentRequestKey.current = requestKey;
  const estimateGeneration = useRef(0);
  const estimateMatches = Boolean(
    requestKey && estData.canEst && estData.requestKey === requestKey,
  );

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
      } else if (!verifyCardanoPaymentKeyHashAddress(value)) {
        setErrorAddressMsg(
          'Cardano receiver must be a base or enterprise address with a payment key credential',
        );
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
    if (!estimateMatches || !cardanoWallet?.signTx) {
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

  const calculateAndSetSwapEst = async (generation: number, key: string) => {
    const isCurrent = () =>
      estimateGeneration.current === generation &&
      currentRequestKey.current === key;
    setEstimateData({ ...initEstData });
    const inputToken = tokenAmount(
      swapData.fromToken,
      swapData.fromToken.swapAmount || '',
    );
    if (!inputToken) return;
    setIsEstimating(true);

    try {
      const res = await estimateLocalOsmosisSwap({
        fromChainId:
          swapData.fromToken.network.ibcChainId ||
          swapData.fromToken.network.networkId!,
        tokenInDenom: inputToken.denom,
        tokenInAmount: inputToken.amount,
        toChainId:
          swapData.toToken.network.ibcChainId ||
          swapData.toToken.network.networkId!,
        tokenOutDenom: swapData.toToken.tokenId,
      });

      if (!isCurrent()) return;
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

      const msg = await unsignedTxSwapFromCardano({
        sender: cardanoAddress!,
        tokenIn: inputToken,
        tokenOutDenom: outToken,
        receiver: receiver!,
        transferRoutes,
        transferBackRoutes,
        slippagePercentage: swapData.slippageTolerance!,
        timeoutTimeOffset: PACKET_TIMEOUT_NANOSEC,
      });

      if (!isCurrent()) return;
      setSwapData((prev) => ({
        ...prev,
        toToken: {
          ...prev.toToken,
          swapAmount: baseAmountToDisplayAmount(
            tokenOutAmount,
            swapData.toToken.tokenExponent ?? 0,
          ),
        },
      }));

      let estDataResult: any;
      try {
        const unsignedTx = msg[0].unsignedTxCborHex;
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
        requestKey: key,
        estReceiveAmount: baseAmountToDisplayAmount(
          tokenOutAmount,
          swapData.toToken.tokenExponent ?? 0,
        ),
        estMinimumReceived: `${baseAmountToDisplayAmount(
          tokenOutTransferBackAmount,
          swapData.toToken.tokenExponent ?? 0,
        )} ${
          tokenUsesBaseUnits(swapData.toToken) ? 'base units ' : ''
        }${tokenPrimaryLabel(swapData.toToken)}`,
      });
    } catch (error) {
      if (isCurrent()) {
        setEstimateData(initEstData);
        toast.error(
          error instanceof Error ? error.message : 'Swap estimation failed',
          { theme: 'colored' },
        );
      }
    } finally {
      if (isCurrent()) setIsEstimating(false);
    }
  };

  useEffect(() => {
    estimateGeneration.current += 1;
    const generation = estimateGeneration.current;
    setEstimateData(initEstData);
    setIsEstimating(false);
    if (!requestKey) return undefined;
    const timeout = window.setTimeout(() => {
      calculateAndSetSwapEst(generation, requestKey);
    }, 450);
    return () => {
      estimateGeneration.current = generation + 1;
      window.clearTimeout(timeout);
    };
    // The key includes every transaction input. Output display amounts do not
    // change the request and must not start another estimate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

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
                <Heading className="title">Swap Via Local Osmosis</Heading>
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
                ) => handleChangeAmount(event.target.value, true)}
              />
              <motion.div
                animate={{ y: [0, -2, 0] }}
                transition={{
                  duration: 2.2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
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
                {(isEstimating || estimateMatches) && (
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
                disabled={!estimateMatches || isEstimating}
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
