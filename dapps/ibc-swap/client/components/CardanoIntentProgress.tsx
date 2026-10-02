import { useEffect, useRef, useState } from 'react';
import { Box, Text } from '@chakra-ui/react';
import {
  intentRequest,
  type FundedIntent,
  type IntentStatus,
} from '@/utils/cardanoIntent';

export function CardanoIntentProgress({
  intent,
  onStatus,
}: {
  intent: FundedIntent;
  onStatus: (status: IntentStatus) => void;
}) {
  const [status, setStatus] = useState<IntentStatus>({ stage: 'pending' });
  const [error, setError] = useState('');
  const callback = useRef(onStatus);
  callback.current = onStatus;
  const { hash, channel, signer } = intent;
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await intentRequest({ hash, channel, signer });
        if (!stopped) {
          setStatus(next);
          setError('');
          callback.current(next);
        }
      } catch (cause) {
        if (!stopped)
          setError(
            cause instanceof Error ? cause.message : 'Status unavailable',
          );
      } finally {
        if (!stopped) timer = setTimeout(poll, 3000);
      }
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [hash, channel, signer]);
  const titles = {
    pending: 'Waiting for request funding',
    funded: 'Request funded',
    sent: 'Packet sent',
    cancelled: 'Request cancelled',
  };
  const descriptions = {
    pending: 'Waiting for your funding transaction to be included.',
    funded:
      'The relayer will submit your packet and pay the batch transaction fee. No further wallet signature is needed.',
    sent: 'The packet is included. Follow destination delivery below.',
    cancelled: 'The funded request was cancelled. No packet was sent.',
  };
  return (
    <Box p={4} borderWidth="1px" borderRadius="8px">
      <Text fontWeight="bold">{titles[status.stage]}</Text>
      <Text fontSize="sm">{descriptions[status.stage]}</Text>
      {error && <Text color="orange.300">{error}</Text>}
    </Box>
  );
}
