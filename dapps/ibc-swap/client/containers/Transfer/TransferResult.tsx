import { useContext, useEffect, useState } from 'react';
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

const stepStatus = (complete: boolean, active: boolean): ProgressStepStatus => {
  if (complete) return 'complete';
  if (active) return 'active';
  return 'pending';
};

type HopProgressStep = {
  title: string;
  description: string;
  status: ProgressStepStatus;
};

type RouteHopProgress = {
  index: number;
  sourceChainId: string;
  destinationChainId: string;
  status: ProgressStepStatus;
  statusLabel: string;
  packetLabel: string;
  steps: HopProgressStep[];
};

const getPacketLabel = (packetHop?: TransferPacketHop): string =>
  packetHop
    ? `${packetHop.packet.sourceChannel}/${packetHop.packet.sequence}`
    : 'not emitted yet';

const getEventTxLabel = (txHash?: string): string =>
  txHash ? ` in tx ${getShortTxHash(txHash)}` : '';

// Convert packet milestones into stable copy for the compact per-hop progress UI.
const formatPacketSequenceList = (sequences: string[]): string =>
  sequences.length > 0 ? sequences.join(', ') : 'unknown earlier packets';

const buildRouteHopProgress = (params: {
  index: number;
  sourceChainId: string;
  destinationChainId: string;
  packetHop?: TransferPacketHop;
  previousPacketHop?: TransferPacketHop;
  sourceTxHash?: string;
}): RouteHopProgress => {
  const {
    index,
    sourceChainId,
    destinationChainId,
    packetHop,
    previousPacketHop,
    sourceTxHash,
  } = params;
  const sourceLabel = runtimeChainLabel(sourceChainId);
  const destinationLabel = runtimeChainLabel(destinationChainId);
  const packetLabel = getPacketLabel(packetHop);

  // The most advanced observed event on the hop determines the summary label.
  let statusLabel = 'Waiting for previous hop';
  if (packetHop?.timeout) statusLabel = 'Timed out';
  else if (packetHop?.acknowledge) statusLabel = 'Acknowledged';
  else if (packetHop?.writeAcknowledgement)
    statusLabel = 'Returning acknowledgement';
  else if (packetHop?.recv) statusLabel = `Received on ${destinationLabel}`;
  else if (packetHop?.blockedByPriorPackets)
    statusLabel = 'Blocked by earlier packet(s)';
  else if (packetHop?.send) statusLabel = `Relaying to ${destinationLabel}`;
  else if (index === 0 && sourceTxHash) statusLabel = 'Indexing source packet';
  else if (previousPacketHop?.recv)
    statusLabel = `Waiting for ${sourceLabel} forwarding`;

  let sendDescription = `This hop can start after the previous hop reaches ${sourceLabel}.`;
  let sendStatus = stepStatus(false, false);
  if (packetHop?.send) {
    sendDescription = `${sourceLabel} emitted send_packet ${packetLabel}${getEventTxLabel(
      packetHop.send.txHash,
    )}.`;
    sendStatus = 'complete';
  } else if (index === 0 && sourceTxHash) {
    sendDescription = `Wallet returned source tx ${shortenHash(
      sourceTxHash,
    )}. Waiting for bridge history to index its IBC send_packet.`;
    sendStatus = 'active';
  } else if (previousPacketHop?.recv) {
    sendDescription = `${sourceLabel} received the previous hop. Waiting for the forwarded send_packet for ${destinationLabel}.`;
    sendStatus = 'active';
  }

  let receiveDescription = `No packet exists yet for ${destinationLabel}.`;
  if (packetHop?.recv) {
    receiveDescription = `${destinationLabel} observed recv_packet ${packetLabel}${getEventTxLabel(
      packetHop.recv.txHash,
    )}.`;
  } else if (packetHop?.blockedByPriorPackets) {
    const blockedSequences = formatPacketSequenceList(
      packetHop.blockedByPriorPackets.pendingPacketSequencesBeforeCurrent,
    );
    receiveDescription = `Ordered channel ${packetHop.blockedByPriorPackets.channelId} is blocked by earlier pending packet(s) ${blockedSequences}. The relayer must receive or time out those packet(s) before packet ${packetLabel} can reach ${destinationLabel}.`;
  } else if (packetHop?.send) {
    receiveDescription = `Waiting for a relayer to deliver packet ${packetLabel} to ${destinationLabel}.`;
  }

  let acknowledgementDescription = `Waiting for recv_packet before ${destinationLabel} can acknowledge this hop.`;
  if (packetHop?.writeAcknowledgement) {
    acknowledgementDescription = `${destinationLabel} wrote the IBC acknowledgement${getEventTxLabel(
      packetHop.writeAcknowledgement.txHash,
    )}.`;
  } else if (packetHop?.recv) {
    acknowledgementDescription = `Waiting for ${destinationLabel} to process the packet and write an acknowledgement.`;
  }

  let sourceAckDescription = `Waiting for acknowledgement relay back to ${sourceLabel}.`;
  if (packetHop?.timeout) {
    sourceAckDescription = `${sourceLabel} observed timeout_packet ${packetLabel}${getEventTxLabel(
      packetHop.timeout.txHash,
    )}.`;
  } else if (packetHop?.acknowledge) {
    sourceAckDescription = `${sourceLabel} observed acknowledge_packet ${packetLabel}${getEventTxLabel(
      packetHop.acknowledge.txHash,
    )}.`;
  } else if (!packetHop?.writeAcknowledgement) {
    sourceAckDescription = `Waiting for destination acknowledgement before it can return to ${sourceLabel}.`;
  }

  const status = stepStatus(
    Boolean(packetHop?.acknowledge),
    Boolean(packetHop || sourceTxHash || previousPacketHop?.recv),
  );

  return {
    index,
    sourceChainId,
    destinationChainId,
    status,
    statusLabel,
    packetLabel,
    steps: [
      {
        title: 'send_packet',
        description: sendDescription,
        status: sendStatus,
      },
      {
        title: 'recv_packet',
        description: receiveDescription,
        status: stepStatus(Boolean(packetHop?.recv), Boolean(packetHop?.send)),
      },
      {
        title: 'destination acknowledgement',
        description: acknowledgementDescription,
        status: stepStatus(
          Boolean(packetHop?.writeAcknowledgement),
          Boolean(packetHop?.recv),
        ),
      },
      {
        title: packetHop?.timeout ? 'timeout' : 'source acknowledgement',
        description: sourceAckDescription,
        status: stepStatus(
          Boolean(packetHop?.acknowledge || packetHop?.timeout),
          Boolean(packetHop?.writeAcknowledgement),
        ),
      },
    ],
  };
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
      // Poll through the Next API so the browser never talks directly to chain REST endpoints.
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

  // Fall back to local route config until the live status endpoint returns the canonical route.
  const routeChainIds = transferStatus?.routeChainIds.length
    ? transferStatus.routeChainIds
    : runtimeRouteChainIds(fromNetwork.networkId, toNetwork.networkId);
  const routeLabels = routeChainIds.map(runtimeChainLabel);

  const sourceExplorerUrl =
    fromNetwork.networkId === CARDANO_CHAIN_ID
      ? getCardanoExplorerTxUrl(lastTxHash)
      : undefined;

  const packets = transferStatus?.packets || [];
  // Render every route edge even before its packet is indexed so stalled hops remain visible.
  const routeHopProgress = routeChainIds
    .slice(0, -1)
    .map((sourceChainId, index) =>
      buildRouteHopProgress({
        index,
        sourceChainId,
        destinationChainId: routeChainIds[index + 1],
        packetHop: packets.find((packet) => packet.index === index),
        previousPacketHop:
          index > 0
            ? packets.find((packet) => packet.index === index - 1)
            : undefined,
        sourceTxHash: index === 0 ? lastTxHash : undefined,
      }),
    );

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
            <Box display="inline-grid" gap="10px" pt="2px">
              <Text fontSize={12} fontWeight={700} color={COLOR.neutral_3}>
                Packet route progress
              </Text>
              {routeHopProgress.length > 1 && (
                <Text fontSize={11} lineHeight="16px" color={COLOR.neutral_2}>
                  Multi-hop transfers settle hop by hop. If a later hop stalls
                  after an intermediary receives funds, the hop status below
                  shows where the transfer is currently held.
                </Text>
              )}
              {routeHopProgress.map((hop) => {
                const hopMarkerColor = getStepMarkerColor(hop.status);
                return (
                  <Box
                    key={`${hop.sourceChainId}-${hop.destinationChainId}-${hop.index}`}
                    display="inline-grid"
                    gap="8px"
                    p="10px"
                    borderRadius="10px"
                    border="1px solid #FFFFFF0D"
                    background="#0E0E124D"
                  >
                    <Box
                      display="flex"
                      justifyContent="space-between"
                      gap="10px"
                      alignItems="start"
                    >
                      <Box display="inline-grid" gap="2px">
                        <Text fontSize={13} fontWeight={700}>
                          Hop {hop.index + 1}:{' '}
                          {runtimeChainLabel(hop.sourceChainId)} {'->'}{' '}
                          {runtimeChainLabel(hop.destinationChainId)}
                        </Text>
                        <Text
                          fontSize={11}
                          lineHeight="16px"
                          color={COLOR.neutral_2}
                        >
                          Packet {hop.packetLabel}
                        </Text>
                      </Box>
                      <Box
                        display="inline-flex"
                        alignItems="center"
                        gap="6px"
                        flexShrink={0}
                      >
                        <Box
                          w="8px"
                          h="8px"
                          borderRadius="50%"
                          background={hopMarkerColor}
                          boxShadow={
                            hop.status === 'active'
                              ? `0 0 10px ${COLOR.warning}`
                              : undefined
                          }
                        />
                        <Text
                          fontSize={11}
                          lineHeight="16px"
                          color={COLOR.neutral_2}
                        >
                          {hop.statusLabel}
                        </Text>
                      </Box>
                    </Box>
                    {hop.steps.map((step) => {
                      const markerColor = getStepMarkerColor(step.status);
                      return (
                        <Box
                          key={step.title}
                          display="grid"
                          gridTemplateColumns="16px 1fr"
                          gap="8px"
                          alignItems="start"
                        >
                          <Box
                            mt="4px"
                            w="8px"
                            h="8px"
                            borderRadius="50%"
                            background={markerColor}
                            boxShadow={
                              step.status === 'active'
                                ? `0 0 10px ${COLOR.warning}`
                                : undefined
                            }
                          />
                          <Box>
                            <Text fontSize={12} fontWeight={700}>
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
                );
              })}
            </Box>
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
