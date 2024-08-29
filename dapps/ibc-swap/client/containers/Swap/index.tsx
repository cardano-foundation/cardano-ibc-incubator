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
import { toast } from 'react-toastify';
import { useAddress, useWallet } from '@meshsdk/react';
import { FaArrowDown } from 'react-icons/fa6';
import TokenBox from '@/components/TokenBox';
import CustomInput from '@/components/CustomInput';
import InfoIcon from '@/assets/icons/info.svg';
import DefaultCosmosNetworkIcon from '@/assets/icons/cosmos-icon.svg';
import { COLOR } from '@/styles/color';
import SwapContext from '@/contexts/SwapContext';
import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import * as CSL from '@emurgo/cardano-serialization-lib-browser';
import { formatNumberInput, formatPrice } from '@/utils/string';
import { allChains } from '@/configs/customChainInfo';
import TransferContext from '@/contexts/TransferContext';
import { verifyAddress } from '@/utils/address';
import IBCParamsContext from '@/contexts/IBCParamsContext';
import TransactionFee from './TransactionFee';
import SettingSlippage from './SettingSlippage';
import SelectNetworkModal from './SelectNetworkModal';
import { SwapResult } from './SwapResult';

import { HOUR_IN_NANOSEC } from '@/constants';

// import debounce from 'lodash/debounce';
import { debounce } from '@/utils/helper';

import StyledSwap, {
  StyledSwapButton,
  StyledSwitchNetwork,
  StyledWrapContainer,
} from './index.style';
import { unsignedTxSwapFromCardano } from '@/utils/buildSwapTx';

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

  // swap est state
  const [estData, setEstimateData] = useState<EstimateFeeType>(initEstData);
  // swap est state

  const { isOpen, onOpen, onClose } = useDisclosure();

  const { swapData, setSwapData, handleResetData } = useContext(SwapContext);
  const { calculateSwapEst } = useContext(IBCParamsContext);
  const { handleReset: handleResetTransferData } = useContext(TransferContext);

  const resetLastTxData = () => {
    setEstimateData(initEstData);
    setLastTxHash('');
    handleResetData();
  };

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

  const onShowEstimateFee = (): React.JSX.Element | null => {
    if (estData.canEst) {
      return (
        <TransactionFee
          minimumReceived={estData.estMinimumReceived}
          estFee={estData.estFee}
        />
      );
    }
    return null;
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

  // useEffect(() => {
  //   if (
  //     BigNumber(swapData?.fromToken?.swapAmount || '').isGreaterThan(
  //       BigNumber(0),
  //     ) &&
  //     BigNumber(swapData?.toToken?.swapAmount || '').isGreaterThan(BigNumber(0))
  //   ) {
  //     if (!isCheckedAnotherWallet) {
  //       setEnableSwap(true);
  //     } else if (swapData?.receiveAdrress && !errorAddressMsg) {
  //       // if isValidAddress
  //       setEnableSwap(true);
  //     } else {
  //       setEnableSwap(false);
  //     }
  //   } else {
  //     setEnableSwap(false);
  //   }
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [JSON.stringify(swapData), isCheckedAnotherWallet]);

  const calculateAndSetSwapEst = (swapData: any) => {
    setEstimateData({...initEstData});
    calculateSwapEst({
      fromChain: swapData.fromToken.network.networkId!,
      tokenInDenom: swapData.fromToken.tokenId,
      tokenInAmount: swapData.fromToken.swapAmount!,
      toChain: swapData.toToken.network.networkId!,
      tokenOutDenom: swapData.toToken.tokenId,
    }).then(async (res: any) => {
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
        setEstimateData({...initEstData});
      } else {
        setSwapData({
          ...swapData,
          toToken: {
            ...swapData.toToken,
            swapAmount: tokenOutAmount.toString(),
          },
        });
        const msg = await unsignedTxSwapFromCardano({
          sender: cardanoAddress!,
          tokenIn: {
            amount: swapData.fromToken.swapAmount!,
            denom: swapData.fromToken.tokenId,
          },
          tokenOutDenom: outToken,
          receiver: swapData.receiveAdrress || cardanoAddress,
          transferRoutes,
          transferBackRoutes,
          slippagePercentage: swapData.slippageTolerance,
          timeoutTimeOffset: HOUR_IN_NANOSEC,
        });
        let estDataResult: any;
        try {
          const unsignedTx = Buffer.from(msg[0].value, 'base64').toString(
            'hex',
          );
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
          estReceiveAmount: tokenOutAmount.toString(),
          estMinimumReceived: `${tokenOutTransferBackAmount.toString()} ${swapData.toToken.tokenId.toUpperCase()}`,
        });
      }
    });
  };

  const debounceEstAmount = () =>
    debounce(calculateAndSetSwapEst, 1000)(swapData);

  useEffect(() => {
    // check amount out
    if (
      swapData?.fromToken?.swapAmount &&
      cardanoAddress &&
      swapData?.fromToken?.network?.networkId &&
      swapData?.fromToken?.tokenId &&
      swapData?.toToken?.network?.networkId &&
      swapData?.toToken?.tokenId
    ) {
      debounceEstAmount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(swapData?.fromToken),
    JSON.stringify(swapData?.toToken?.network),
    swapData?.toToken?.tokenId,
    isCheckedAnotherWallet,
    cardanoAddress,
  ]);

  return isSubmitSwap ? (
    <SwapResult
      setIsSubmitted={setIsSubmitSwap}
      minimumReceived={estData.estMinimumReceived || ''}
      estFee={estData.estFee}
      resetLastTxData={resetLastTxData}
      lastTxHash={lastTxHash}
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
        {isCheckedAnotherWallet && (
          <CustomInput
            title="Destination address"
            placeholder="Enter destination address here..."
            onChange={handleChangeReceiveAdrress}
            errorMsg={errorAddressMsg}
          />
        )}

        {/* <StyledSwapButton disabled={!enableSwap} onClick={() => handleSwap()}> */}
        <StyledSwapButton
          disabled={!estData.canEst}
          onClick={() => handleSwap()}
        >
          <Text fontSize={18} fontWeight={700} lineHeight="24px">
            Swap
          </Text>
        </StyledSwapButton>
      </StyledSwap>
    </StyledWrapContainer>
  );
};

export default SwapContainer;
