import { useContext, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';

import { Box, Text } from '@chakra-ui/react';
import { COLOR } from '@/styles/color';
import RightArrowIcon from '@/assets/icons/Arrow-right.svg';
import TimerIcon from '@/assets/icons/timer.svg';
import TransferContext from '@/contexts/TransferContext';
import { formatTokenSymbol } from '@/utils/string';
import {
  CARDANO_CHAIN_ID,
  IBC_SWAP_MODE,
  MAINNET_CARDANO_CHAIN_ID,
  PREPROD_CARDANO_CHAIN_ID,
} from '@/configs/runtime';
import {
  runtimeChainLabel,
  runtimeRouteChainIds,
} from '@/configs/runtimeConfig';

import {
  StyledSwitchNetwork,
  StyledTimerBox,
  StyledTransferCalculatorBox,
  StyledTransferContainer,
  StyledTransferDetailButton,
  StyledTransferFromToBox,
  StyledWrapContainer,
} from './index.style';

type TransferResultProps = {
  // eslint-disable-next-line no-unused-vars
  setIsSubmitted: (isSubmitted: boolean) => void;
  resetLastTxData: () => void;
  estReceiveAmount: string;
  estTime: string;
  estFee: string;
  lastTxHash: string;
};

const shortenHash = (hash: string): string =>
  hash.length > 18 ? `${hash.slice(0, 10)}...${hash.slice(-8)}` : hash;

const formatElapsedTime = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0
    ? `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`
    : `${remainingSeconds}s`;
};

const getCardanoExplorerTxUrl = (txHash: string): string | undefined => {
  if (!txHash) return undefined;
  if (CARDANO_CHAIN_ID === PREPROD_CARDANO_CHAIN_ID) {
    return `https://preprod.cexplorer.io/tx/${txHash}`;
  }
  if (CARDANO_CHAIN_ID === MAINNET_CARDANO_CHAIN_ID) {
    return `https://cexplorer.io/tx/${txHash}`;
  }
  return undefined;
};

const getStepMarkerColor = (status: 'complete' | 'active' | 'pending') => {
  if (status === 'complete') return COLOR.success;
  if (status === 'active') return COLOR.warning;
  return COLOR.neutral_4;
};

export const TransferResult = ({
  setIsSubmitted,
  estReceiveAmount,
  estTime,
  estFee,
  lastTxHash,
  resetLastTxData,
}: TransferResultProps) => {
  const { handleReset, fromNetwork, toNetwork, selectedToken, sendAmount } =
    useContext(TransferContext);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const routeLabels = useMemo(
    () =>
      runtimeRouteChainIds(fromNetwork.networkId, toNetwork.networkId).map(
        runtimeChainLabel,
      ),
    [fromNetwork.networkId, toNetwork.networkId],
  );

  const sourceExplorerUrl =
    fromNetwork.networkId === CARDANO_CHAIN_ID
      ? getCardanoExplorerTxUrl(lastTxHash)
      : undefined;

  const progressSteps = [
    {
      title: 'Source transaction submitted',
      description: lastTxHash
        ? `Wallet returned source tx ${shortenHash(
            lastTxHash,
          )}. It still needs source-chain confirmation before the relayer can act.`
        : 'The wallet returned a source transaction hash.',
      status: 'active',
    },
    {
      title: 'Waiting for relayer',
      description:
        'After source-chain confirmation, the relayer observes the packet and relays it through the configured route.',
      status: 'pending',
    },
    {
      title: 'Destination chain receive',
      description:
        'The destination chain will process the relayed packet and credit the receiving account.',
      status: 'pending',
    },
  ] as const;

  const handleBackToTransfer = () => {
    resetLastTxData();
    handleReset();
    setIsSubmitted(false);
  };

  return (
    <StyledWrapContainer>
      <StyledTransferContainer
        style={{
          minWidth: '492px',
          maxHeight: 'calc(100vh - 180px)',
          overflowY: 'auto',
        }}
      >
        <Box display="inline-grid" gap={4} position="relative" pt={4}>
          <StyledTimerBox>
            <Image width={32} height={32} src={TimerIcon} alt="timer icon" />
          </StyledTimerBox>
          <Box display="inline-grid" justifyContent="center" gap={2}>
            <Text
              textAlign="center"
              fontWeight={700}
              fontSize={20}
              lineHeight="28px"
            >
              IBC Transfer in Progress
            </Text>
            <Text
              textAlign="center"
              fontWeight={400}
              fontSize={12}
              lineHeight="18px"
              color={COLOR.neutral_2}
            >
              Source transaction submitted. The transfer is now waiting on
              relayer and destination-chain processing.
            </Text>
          </Box>
          <Box
            display="flex"
            position="relative"
            justifyContent="space-between"
            gap={4}
          >
            <StyledTransferFromToBox>
              <Text
                fontSize={14}
                fontWeight={600}
                lineHeight="20px"
                color={COLOR.neutral_3}
              >
                From
              </Text>
              <Text
                wordBreak="break-all"
                fontWeight={700}
                fontSize={16}
                lineHeight="22px"
              >
                {sendAmount}{' '}
                {formatTokenSymbol(selectedToken.tokenSymbol || '')}/
                {fromNetwork.networkPrettyName}
              </Text>
            </StyledTransferFromToBox>
            <StyledSwitchNetwork
              style={{ borderRadius: '100%', cursor: 'auto' }}
              _hover={{
                bgColor: COLOR.neutral_6,
              }}
            >
              <Image src={RightArrowIcon} alt="Icon" />
            </StyledSwitchNetwork>
            <StyledTransferFromToBox>
              <Text
                fontSize={14}
                fontWeight={600}
                lineHeight="20px"
                color={COLOR.neutral_3}
              >
                To
              </Text>
              <Text
                wordBreak="break-all"
                fontWeight={700}
                fontSize={16}
                lineHeight="22px"
              >
                {estReceiveAmount}{' '}
                {formatTokenSymbol(selectedToken.tokenSymbol || '')}/
                {toNetwork.networkPrettyName}
              </Text>
            </StyledTransferFromToBox>
          </Box>
          <StyledTransferCalculatorBox style={{ height: 'auto' }}>
            <Box
              alignItems="center"
              display="flex"
              justifyContent="space-between"
            >
              <Text
                fontSize={16}
                fontWeight={400}
                lineHeight="22px"
                color={COLOR.neutral_3}
              >
                Time
              </Text>
              <Text>{estTime}</Text>
            </Box>
            <Box
              alignItems="center"
              display="flex"
              justifyContent="space-between"
            >
              <Text
                fontSize={16}
                fontWeight={400}
                lineHeight="22px"
                color={COLOR.neutral_3}
              >
                Elapsed
              </Text>
              <Text>{formatElapsedTime(elapsedSeconds)}</Text>
            </Box>
            <Box
              alignItems="center"
              display="flex"
              justifyContent="space-between"
            >
              <Text
                fontSize={16}
                fontWeight={400}
                lineHeight="22px"
                color={COLOR.neutral_3}
              >
                Est. Fee
              </Text>
              <Text
                fontSize={16}
                fontWeight={400}
                lineHeight="20px"
                color={COLOR.success}
              >
                {estFee}
              </Text>
            </Box>
          </StyledTransferCalculatorBox>
          <Box
            display="inline-grid"
            gap="10px"
            p="12px"
            borderRadius="10px"
            background={COLOR.neutral_5}
          >
            <Text fontSize={12} fontWeight={700} color={COLOR.neutral_3}>
              Route
            </Text>
            <Text fontSize={14} fontWeight={700} color={COLOR.neutral_1}>
              {routeLabels.join(' -> ')}
            </Text>
          </Box>
          <Box
            display="inline-grid"
            gap="10px"
            p="12px"
            borderRadius="10px"
            background={COLOR.neutral_5}
          >
            {progressSteps.map((step) => {
              const markerColor = getStepMarkerColor(step.status);
              return (
                <Box
                  key={step.title}
                  display="grid"
                  gridTemplateColumns="18px 1fr"
                  gap="10px"
                  alignItems="start"
                >
                  <Box
                    mt="3px"
                    w="10px"
                    h="10px"
                    borderRadius="50%"
                    background={markerColor}
                    boxShadow={
                      step.status === 'active'
                        ? `0 0 10px ${COLOR.warning}`
                        : undefined
                    }
                  />
                  <Box>
                    <Text fontSize={13} fontWeight={700}>
                      {step.title}
                    </Text>
                    <Text
                      fontSize={12}
                      lineHeight="18px"
                      color={COLOR.neutral_2}
                    >
                      {step.description}
                    </Text>
                  </Box>
                </Box>
              );
            })}
          </Box>
          {lastTxHash && (
            <Box
              display="inline-grid"
              gap="6px"
              p="12px"
              borderRadius="10px"
              background="#0E0E124D"
              border="1px solid #FFFFFF0D"
            >
              <Text fontSize={12} fontWeight={700} color={COLOR.neutral_3}>
                Source transaction
              </Text>
              <Text fontSize={12} color={COLOR.neutral_1} wordBreak="break-all">
                {lastTxHash}
              </Text>
            </Box>
          )}
          {IBC_SWAP_MODE !== 'local' && (
            <Text fontSize={12} lineHeight="18px" color={COLOR.neutral_2}>
              This screen does not yet have live packet acknowledgements. Use
              the source transaction link for chain confirmation while the
              relayer completes the IBC path.
            </Text>
          )}
          <Box display="inline-grid" w="100%" gap={2}>
            <StyledTransferDetailButton
              bg={COLOR.primary}
              shadow="2px 2px 3px 0px #FCFCFC66 inset"
              _hover={{
                bg: COLOR.primary,
              }}
              color={COLOR.neutral_1}
              isDisabled={!sourceExplorerUrl}
              onClick={() => {
                if (sourceExplorerUrl) {
                  window.open(
                    sourceExplorerUrl,
                    '_blank',
                    'noopener,noreferrer',
                  );
                }
              }}
            >
              {sourceExplorerUrl
                ? 'View Source Transaction'
                : 'Source Explorer Unavailable'}
            </StyledTransferDetailButton>
            <StyledTransferDetailButton
              bg={COLOR.neutral_6}
              border="1px solid #FFFFFF0D"
              onClick={handleBackToTransfer}
              color={COLOR.neutral_1}
              _hover={{
                bg: COLOR.neutral_6,
              }}
            >
              Start a new Transfer
            </StyledTransferDetailButton>
          </Box>
        </Box>
      </StyledTransferContainer>
    </StyledWrapContainer>
  );
};
