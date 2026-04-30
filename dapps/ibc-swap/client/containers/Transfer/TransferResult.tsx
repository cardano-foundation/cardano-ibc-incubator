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
import type {
  TransferPacketHop,
  TransferStatusResponse,
} from '@/types/transferStatus';

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

type ProgressStepStatus = 'complete' | 'active' | 'pending';

const getShortTxHash = (txHash?: string): string =>
  txHash ? shortenHash(txHash) : 'transaction pending';

const hasAnyHopValue = (
  packets: TransferPacketHop[],
  key: 'recv' | 'writeAcknowledgement' | 'acknowledge' | 'timeout',
): boolean => packets.some((packet) => Boolean(packet[key]));

const stepStatus = (complete: boolean, active: boolean): ProgressStepStatus => {
  if (complete) return 'complete';
  if (active) return 'active';
  return 'pending';
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
  const [transferStatus, setTransferStatus] =
    useState<TransferStatusResponse | null>(null);
  const [transferStatusError, setTransferStatusError] = useState('');

  useEffect(() => {
    const interval = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const sourceChainId = fromNetwork.networkId;
    const destinationChainId = toNetwork.networkId;
    if (!lastTxHash || !sourceChainId || !destinationChainId) {
      return undefined;
    }

    let cancelled = false;
    const fetchTransferStatus = async () => {
      const params = new URLSearchParams({
        sourceTxHash: lastTxHash,
        sourceChainId,
        destinationChainId,
      });
      const response = await fetch(`/api/transfer/status?${params}`);
      const data = (await response.json()) as TransferStatusResponse;
      if (!response.ok) {
        throw new Error(data.error || data.message || 'Status query failed.');
      }
      if (!cancelled) {
        setTransferStatus(data);
        setTransferStatusError('');
      }
    };

    fetchTransferStatus().catch((error) => {
      if (!cancelled) {
        setTransferStatusError(
          error instanceof Error
            ? error.message
            : 'Unable to query live transfer status.',
        );
      }
    });

    const interval = window.setInterval(() => {
      fetchTransferStatus().catch((error) => {
        if (!cancelled) {
          setTransferStatusError(
            error instanceof Error
              ? error.message
              : 'Unable to query live transfer status.',
          );
        }
      });
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [fromNetwork.networkId, lastTxHash, toNetwork.networkId]);

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

  const firstHop = transferStatus?.packets[0];
  const packets = transferStatus?.packets || [];
  const sourcePacketIndexed = Boolean(firstHop?.send);
  const recvObserved =
    packets.length > 0 && packets.every((packet) => Boolean(packet.recv));
  const writeAckObserved =
    packets.length > 0 &&
    packets.every((packet) => Boolean(packet.writeAcknowledgement));
  const acknowledgeObserved =
    packets.length > 0 &&
    packets.every((packet) => Boolean(packet.acknowledge));
  const timeoutObserved = hasAnyHopValue(packets, 'timeout');

  let sourceStepDescription = 'Waiting for the source wallet transaction.';
  if (firstHop?.send) {
    sourceStepDescription = `Bridge history indexed packet ${
      firstHop.packet.sourceChannel
    }/${firstHop.packet.sequence} from tx ${getShortTxHash(
      firstHop.send.txHash,
    )}.`;
  } else if (lastTxHash) {
    sourceStepDescription = `Wallet returned source tx ${shortenHash(
      lastTxHash,
    )}. Waiting for bridge history to index the IBC send_packet.`;
  }

  const relayStepStatus = stepStatus(recvObserved, sourcePacketIndexed);
  const writeAckStepStatus = stepStatus(writeAckObserved, recvObserved);
  const sourceAckStepStatus = stepStatus(
    acknowledgeObserved || timeoutObserved,
    writeAckObserved,
  );

  let sourceAckDescription =
    'After the destination writes an acknowledgement, the relayer must relay it back to the source chain.';
  if (timeoutObserved) {
    sourceAckDescription =
      'A timeout_packet has been observed for this transfer.';
  } else if (acknowledgeObserved) {
    sourceAckDescription =
      'acknowledge_packet has been observed back on the source side.';
  }

  const progressSteps: Array<{
    title: string;
    description: string;
    status: ProgressStepStatus;
  }> = [
    {
      title: 'Source send_packet indexed',
      description: sourceStepDescription,
      status: sourcePacketIndexed ? 'complete' : 'active',
    },
    {
      title: 'Relayer delivery',
      description: firstHop?.recv
        ? `recv_packet observed on ${runtimeChainLabel(
            firstHop.destinationChainId,
          )} in tx ${getShortTxHash(firstHop.recv.txHash)}.`
        : 'The relayer needs to deliver the indexed packet to the next chain in the route.',
      status: relayStepStatus,
    },
    {
      title: 'Destination acknowledgement',
      description: writeAckObserved
        ? 'write_acknowledgement has been observed on the packet destination side.'
        : 'The receiving chain must process the packet and write the IBC acknowledgement.',
      status: writeAckStepStatus,
    },
    {
      title: timeoutObserved ? 'Packet timed out' : 'Source acknowledgement',
      description: sourceAckDescription,
      status: sourceAckStepStatus,
    },
  ];

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
            <Text fontSize={12} fontWeight={700} color={COLOR.neutral_3}>
              Live IBC status
            </Text>
            <Text fontSize={13} lineHeight="18px" color={COLOR.neutral_1}>
              {transferStatusError ||
                transferStatus?.message ||
                'Querying packet status from bridge and chain events...'}
            </Text>
            {transferStatus?.updatedAt && (
              <Text fontSize={11} lineHeight="16px" color={COLOR.neutral_2}>
                Updated{' '}
                {new Date(transferStatus.updatedAt).toLocaleTimeString()}
              </Text>
            )}
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
            {packets.length > 0 && (
              <Box display="inline-grid" gap="6px" pt="2px">
                <Text fontSize={12} fontWeight={700} color={COLOR.neutral_3}>
                  Packet hops
                </Text>
                {packets.map((packet) => (
                  <Text
                    key={`${packet.sourceChainId}-${packet.destinationChainId}-${packet.packet.sequence}`}
                    fontSize={12}
                    lineHeight="18px"
                    color={COLOR.neutral_2}
                  >
                    Hop {packet.index + 1}:{' '}
                    {runtimeChainLabel(packet.sourceChainId)} {'->'}{' '}
                    {runtimeChainLabel(packet.destinationChainId)} -{' '}
                    {packet.packet.sourceChannel}/{packet.packet.sequence} -{' '}
                    {packet.status.replaceAll('_', ' ')}
                  </Text>
                ))}
              </Box>
            )}
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
          {IBC_SWAP_MODE !== 'local' && !transferStatus && (
            <Text fontSize={12} lineHeight="18px" color={COLOR.neutral_2}>
              Live packet status is starting. The source transaction link is
              still available while the bridge history catches up.
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
