import { useEffect, useRef, useState } from 'react';
import { useWallet } from '@meshsdk/react';
import { useSafeCardanoAddress } from '@/hooks/useSafeCardanoAddress';
import { signAndSubmitCardanoTxWithCip30 } from '@/utils/cardanoWalletTx';
import { TxHashLink } from '@/components/TxHashLink';
import { CARDANO_CHAIN_ID } from '@/configs/runtime';
import { Box, Button, Text } from '@chakra-ui/react';
import {
  intentRequest,
  cancelIntent,
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
  const [cancelError, setCancelError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancellationTx, setCancellationTx] = useState('');
  const address = useSafeCardanoAddress();
  const { name: walletName, connected } = useWallet();
  const callback = useRef(onStatus);
  callback.current = onStatus;
  const { hash, channel, signer } = intent;
  useEffect(() => {
    setStatus({ stage: 'pending' });
    setCancelError('');
    setCancellationTx('');
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
  const cancel = async () => {
    setCancelling(true);
    setCancelError('');
    try {
      const txHash = await cancelIntent(intent, address || '', (unsignedTx) =>
        signAndSubmitCardanoTxWithCip30(unsignedTx, walletName),
      );
      setCancellationTx(txHash);
    } catch (cause) {
      setCancelError(
        cause instanceof Error ? cause.message : 'Cancellation failed',
      );
    } finally {
      setCancelling(false);
    }
  };
  const titles = {
    pending: 'Waiting for request funding',
    funded: 'Request funded',
    sent: 'Packet sent',
    cancelled: 'Request cancelled',
  };
  const descriptions = {
    pending: 'Waiting for your funding transaction to be included.',
    funded:
      'The relayer will submit your packet and pay the batch transaction fee. You can close this page and resume later. You can also cancel before the packet is sent.',
    sent: 'The packet is included. Follow destination delivery below.',
    cancelled:
      'The funded request was cancelled. Its funds were returned to the funding wallet minus the transaction fee.',
  };
  return (
    <Box p={4} borderWidth="1px" borderRadius="8px">
      <Text fontWeight="bold">{titles[status.stage]}</Text>
      <Text fontSize="sm">{descriptions[status.stage]}</Text>
      {status.stage === 'funded' && (
        <Box mt={3}>
          <Button
            onClick={cancel}
            isLoading={cancelling}
            isDisabled={!connected || address !== signer}
          >
            Cancel request and return funds
          </Button>
          <Text fontSize="sm">
            Cancellation needs the funding wallet's signature and a transaction
            fee.
          </Text>
          {(!connected || address !== signer) && (
            <Text fontSize="sm">
              Connect the wallet that funded this request to cancel it.
            </Text>
          )}
        </Box>
      )}
      {cancellationTx && status.stage === 'funded' && (
        <Text fontSize="sm">
          Cancellation submitted in{' '}
          <TxHashLink chainId={CARDANO_CHAIN_ID} txHash={cancellationTx} />.
          Waiting for inclusion. If the request remains funded you can retry
          cancellation.
        </Text>
      )}
      {cancelError && <Text color="orange.300">{cancelError}</Text>}
      {error && <Text color="orange.300">{error}</Text>}
    </Box>
  );
}
