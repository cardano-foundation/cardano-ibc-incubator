import axios from 'axios';
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

export interface CardanoAssetDenomTrace {
  assetId: string;
  kind: 'native' | 'ibc_voucher';
  path: string;
  baseDenom: string;
  fullDenom: string;
  voucherTokenName: string | null;
  voucherPolicyId: string | null;
  ibcDenomHash: string | null;
  txHash: string | null;
  firstSeen: string | null;
}

export interface SwapOptionToken {
  tokenId: string;
  tokenName: string;
  tokenLogo: string | null;
}

export interface SwapOptions {
  fromChainId: string;
  fromChainName: string;
  toChainId: string;
  toChainName: string;
  toTokens: SwapOptionToken[];
}

export interface SwapEstimateResponse {
  message: string;
  tokenOutAmount: string;
  tokenOutTransferBackAmount: string;
  tokenSwapAmount: string;
  outToken: string | null;
  transferRoutes: string[];
  transferBackRoutes: string[];
  transferChains: string[];
}

function getGatewayErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data as
      | {
          message?: string;
          error?: string;
          exceptionName?: string;
          type?: string;
        }
      | undefined;

    if (typeof responseData?.message === 'string' && responseData.message.trim()) {
      return responseData.message;
    }

    if (typeof responseData?.error === 'string' && responseData.error.trim()) {
      return responseData.error;
    }

    if (typeof error.message === 'string' && error.message.trim()) {
      return error.message;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Request failed.';
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
    const errorMessage = getGatewayErrorMessage(error);
    toast.error(errorMessage, { theme: 'colored' });
    return { unsignedTx: undefined };
  }
}

export async function lookupCardanoAssetDenomTrace(
  assetId: string,
): Promise<CardanoAssetDenomTrace | null> {
  try {
    const response = await API({
      method: 'GET',
      url: `/api/cardano/assets/${encodeURIComponent(assetId)}/denom-trace`,
    });
    return response.data as CardanoAssetDenomTrace;
  } catch (error) {
    const errorMessage = getGatewayErrorMessage(error);
    toast.error(errorMessage, { theme: 'colored' });
    return null;
  }
}

export async function listCardanoIbcAssets(): Promise<CardanoAssetDenomTrace[]> {
  try {
    const response = await API({
      method: 'GET',
      url: '/api/cardano/ibc-assets',
    });
    return (response.data || []) as CardanoAssetDenomTrace[];
  } catch (error) {
    const errorMessage = getGatewayErrorMessage(error);
    toast.error(errorMessage, { theme: 'colored' });
    return [];
  }
}

export async function getSwapOptions(): Promise<SwapOptions | null> {
  try {
    const response = await API({
      method: 'GET',
      url: '/api/swap/options',
    });
    return response.data as SwapOptions;
  } catch (error) {
    const errorMessage = getGatewayErrorMessage(error);
    toast.error(errorMessage, { theme: 'colored' });
    return null;
  }
}

export async function estimateSwap(params: {
  fromChainId: string;
  tokenInDenom: string;
  tokenInAmount: string;
  toChainId: string;
  tokenOutDenom: string;
}): Promise<SwapEstimateResponse | null> {
  try {
    const response = await API({
      method: 'POST',
      url: '/api/swap/estimate',
      data: {
        from_chain_id: params.fromChainId,
        token_in_denom: params.tokenInDenom,
        token_in_amount: params.tokenInAmount,
        to_chain_id: params.toChainId,
        token_out_denom: params.tokenOutDenom,
      },
    });
    return response.data as SwapEstimateResponse;
  } catch (error) {
    const errorMessage = getGatewayErrorMessage(error);
    toast.error(errorMessage, { theme: 'colored' });
    return null;
  }
}
