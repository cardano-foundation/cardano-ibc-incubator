import { toast } from 'react-toastify';
import API from './api';

interface TransferParams {
  sourcePort: string;
  sourceChannel: string;
  token: {
    denom: string;
    amount: string;
  };
  sender?: string;
  receiver: string;
  timeoutHeight?: {
    revisionNumber: string;
    revisionHeight: string;
  };
  timeoutTimestamp?: string;
  memo?: string;
  signer: string;
}

interface UnsignedTx {
  type_url: string;
  value: any;
}

interface TransferResponseData {
  unsignedTx?: UnsignedTx;
}

export async function transfer({
  sourcePort,
  sourceChannel,
  token,
  sender,
  receiver,
  timeoutHeight,
  timeoutTimestamp,
  memo,
  signer,
}: TransferParams): Promise<TransferResponseData> {
  try {
    const response = await API({
      method: 'POST',
      url: '/api/transfer',
      data: {
        source_port: sourcePort,
        source_channel: sourceChannel,
        token,
        sender,
        receiver,
        timeout_height: timeoutHeight,
        timeout_timestamp: timeoutTimestamp,
        memo,
        signer,
      },
    });
    return response.data;
  } catch (error) {
    const errorMessage = (error as Error).message?.toString() || '';
    toast.error(errorMessage, { theme: 'colored' });
    return { unsignedTx: undefined };
  }
}
