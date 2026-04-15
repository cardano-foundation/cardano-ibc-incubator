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
  mode:
    | 'same-chain'
    | 'native-forward'
    | 'unwind'
    | 'unwind-then-forward'
    | null;
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

export type CheqdIcqQueryKind =
  | 'didDoc'
  | 'didDocVersion'
  | 'didDocVersionsMetadata'
  | 'resource'
  | 'resourceMetadata'
  | 'latestResourceVersion'
  | 'latestResourceVersionMetadata';

type CheqdIcqBaseBuildParams = {
  sourceChannel: string;
  signer: string;
  timeoutHeight?: {
    revisionNumber?: string;
    revisionHeight?: string;
  };
  timeoutTimestamp?: string;
};

export type CheqdIcqBuildParams =
  | (CheqdIcqBaseBuildParams & {
      kind: 'didDoc' | 'didDocVersionsMetadata';
      id: string;
    })
  | (CheqdIcqBaseBuildParams & {
      kind: 'didDocVersion';
      id: string;
      version: string;
    })
  | (CheqdIcqBaseBuildParams & {
      kind: 'resource' | 'resourceMetadata';
      collectionId: string;
      id: string;
    })
  | (CheqdIcqBaseBuildParams & {
      kind: 'latestResourceVersion' | 'latestResourceVersionMetadata';
      collectionId: string;
      name: string;
      resourceType: string;
    });

export interface CheqdIcqBuildResponse {
  queryPath: string;
  sourcePort: string;
  sourceChannel: string;
  packetDataHex: string;
  result: unknown;
  unsignedTx: UnsignedTx;
}

export interface DecodedCheqdIcqAcknowledgement {
  status: 'success' | 'error' | 'query_error';
  queryPath: string;
  sourcePort: string;
  error?: string;
  response?: Record<string, unknown>;
  responseQuery?: {
    code: number;
    log: string;
    info: string;
    index: string;
    height: string;
    codespace: string;
    rawValueBase64: string;
  };
}

export type CheqdIcqResultResponse =
  | {
      status: 'pending';
      reason: 'source_tx_not_indexed' | 'pending_acknowledgement';
      txHash?: string;
      queryPath: string;
      packetDataHex: string;
      currentHeight: string;
      nextSearchFromHeight: string;
    }
  | {
      status: 'completed';
      txHash?: string;
      queryPath: string;
      packetDataHex: string;
      currentHeight: string;
      nextSearchFromHeight: string;
      completedHeight: string;
      packetSequence: string | null;
      acknowledgementHex: string;
      acknowledgement: DecodedCheqdIcqAcknowledgement;
    };

export interface CheqdIcqResultParams {
  txHash?: string;
  sinceHeight?: string;
  queryPath: string;
  packetDataHex: string;
  sourceChannel?: string;
}

const CHEQD_ICQ_ENDPOINTS: Record<CheqdIcqQueryKind, string> = {
  didDoc: '/api/icq/cheqd/did-doc',
  didDocVersion: '/api/icq/cheqd/did-doc-version',
  didDocVersionsMetadata: '/api/icq/cheqd/did-doc-versions-metadata',
  resource: '/api/icq/cheqd/resource',
  resourceMetadata: '/api/icq/cheqd/resource-metadata',
  latestResourceVersion: '/api/icq/cheqd/latest-resource-version',
  latestResourceVersionMetadata:
    '/api/icq/cheqd/latest-resource-version-metadata',
};

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

    if (
      typeof responseData?.message === 'string' &&
      responseData.message.trim()
    ) {
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

export async function listCardanoIbcAssets(): Promise<
  CardanoAssetDenomTrace[]
> {
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

export async function buildCheqdIcqTx(
  params: CheqdIcqBuildParams,
): Promise<CheqdIcqBuildResponse | null> {
  try {
    let data: Record<string, unknown>;
    switch (params.kind) {
      case 'didDoc':
      case 'didDocVersionsMetadata':
        data = {
          source_channel: params.sourceChannel,
          signer: params.signer,
          timeout_height: params.timeoutHeight,
          timeout_timestamp: params.timeoutTimestamp,
          id: params.id,
        };
        break;
      case 'didDocVersion':
        data = {
          source_channel: params.sourceChannel,
          signer: params.signer,
          timeout_height: params.timeoutHeight,
          timeout_timestamp: params.timeoutTimestamp,
          id: params.id,
          version: params.version,
        };
        break;
      case 'resource':
      case 'resourceMetadata':
        data = {
          source_channel: params.sourceChannel,
          signer: params.signer,
          timeout_height: params.timeoutHeight,
          timeout_timestamp: params.timeoutTimestamp,
          collection_id: params.collectionId,
          id: params.id,
        };
        break;
      case 'latestResourceVersion':
      case 'latestResourceVersionMetadata':
        data = {
          source_channel: params.sourceChannel,
          signer: params.signer,
          timeout_height: params.timeoutHeight,
          timeout_timestamp: params.timeoutTimestamp,
          collection_id: params.collectionId,
          name: params.name,
          resource_type: params.resourceType,
        };
        break;
      default:
        throw new Error(
          `Unsupported cheqd ICQ kind: ${(params as CheqdIcqBuildParams).kind}`,
        );
    }

    const response = await API({
      method: 'POST',
      url: CHEQD_ICQ_ENDPOINTS[params.kind],
      data,
    });
    return response.data as CheqdIcqBuildResponse;
  } catch (error) {
    const errorMessage = getGatewayErrorMessage(error);
    toast.error(errorMessage, { theme: 'colored' });
    return null;
  }
}

export async function pollCheqdIcqResult(
  params: CheqdIcqResultParams,
): Promise<CheqdIcqResultResponse | null> {
  try {
    const response = await API({
      method: 'POST',
      url: '/api/icq/cheqd/result',
      data: {
        tx_hash: params.txHash,
        since_height: params.sinceHeight,
        query_path: params.queryPath,
        packet_data_hex: params.packetDataHex,
        source_channel: params.sourceChannel,
      },
    });
    return response.data as CheqdIcqResultResponse;
  } catch (error) {
    const errorMessage = getGatewayErrorMessage(error);
    toast.error(errorMessage, { theme: 'colored' });
    return null;
  }
}
