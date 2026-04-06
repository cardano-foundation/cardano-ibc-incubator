import axios from 'axios';
import { toast } from 'react-toastify';
import API from './api';
import type { CardanoAssetDenomTrace } from '@/types/cardanoTrace';
import {
  listCardanoIbcAssetsFromRegistry,
  lookupCardanoAssetDenomTraceFromRegistry,
} from '@/services/cardanoTraceRegistry';
import { cardanoPlannerClient } from '@/services/cardanoPlanner';

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

export type { CardanoAssetDenomTrace } from '@/types/cardanoTrace';

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

export interface TransferPlanResponse {
  foundRoute: boolean;
  mode: 'same-chain' | 'native-forward' | 'unwind' | 'unwind-then-forward' | null;
  chains: string[];
  routes: string[];
  tokenTrace: {
    kind: 'native' | 'ibc_voucher';
    path: string;
    baseDenom: string;
    fullDenom: string;
  } | null;
  failureCode?:
    | 'invalid-request'
    | 'missing-unwind-hop'
    | 'ambiguous-unwind-hop'
    | 'no-forward-route'
    | 'ambiguous-forward-route'
    | 'ambiguous-forward-hop'
    | 'channels-not-loaded'
    | 'source-chain-unavailable'
    | 'destination-chain-unavailable'
    | 'no-outbound-channels'
    | 'no-route-found';
  failureMessage?: string;
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
    const response = await axios({
      method: 'POST',
      url: '/api/cardano/transfer',
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
    return await lookupCardanoAssetDenomTraceFromRegistry(assetId);
  } catch (error) {
    const errorMessage = getGatewayErrorMessage(error);
    toast.error(errorMessage, { theme: 'colored' });
    return null;
  }
}

export async function listCardanoIbcAssets(): Promise<CardanoAssetDenomTrace[]> {
  try {
    return await listCardanoIbcAssetsFromRegistry();
  } catch (error) {
    const errorMessage = getGatewayErrorMessage(error);
    toast.error(errorMessage, { theme: 'colored' });
    return [];
  }
}

export async function getLocalOsmosisSwapOptions(): Promise<SwapOptions | null> {
  try {
    const response = await cardanoPlannerClient.getLocalOsmosisSwapOptions();
    return {
      fromChainId: response.from_chain_id,
      fromChainName: response.from_chain_name,
      toChainId: response.to_chain_id,
      toChainName: response.to_chain_name,
      toTokens: response.to_tokens.map((token) => ({
        tokenId: token.token_id,
        tokenName: token.token_name,
        tokenLogo: token.token_logo,
      })),
    };
  } catch (error) {
    const errorMessage = getGatewayErrorMessage(error);
    toast.error(errorMessage, { theme: 'colored' });
    return null;
  }
}

export async function estimateLocalOsmosisSwap(params: {
  fromChainId: string;
  tokenInDenom: string;
  tokenInAmount: string;
  toChainId: string;
  tokenOutDenom: string;
}): Promise<SwapEstimateResponse | null> {
  try {
    return await cardanoPlannerClient.estimateLocalOsmosisSwap({
      fromChainId: params.fromChainId,
      tokenInDenom: params.tokenInDenom,
      tokenInAmount: params.tokenInAmount,
      toChainId: params.toChainId,
      tokenOutDenom: params.tokenOutDenom,
    });
  } catch (error) {
    const errorMessage = getGatewayErrorMessage(error);
    toast.error(errorMessage, { theme: 'colored' });
    return null;
  }
}

export async function planTransferRoute(params: {
  fromChainId: string;
  toChainId: string;
  tokenDenom: string;
}): Promise<TransferPlanResponse | null> {
  try {
    return await cardanoPlannerClient.planTransferRoute({
      fromChainId: params.fromChainId,
      toChainId: params.toChainId,
      tokenDenom: params.tokenDenom,
    });
  } catch (error) {
    const errorMessage = getGatewayErrorMessage(error);
    toast.error(errorMessage, { theme: 'colored' });
    return null;
  }
}
