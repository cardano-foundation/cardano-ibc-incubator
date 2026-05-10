import crypto from 'crypto';
import type { LucidEvolution, Network, TxBuilder, UTxO } from '@lucid-evolution/lucid';
import { buildUnsignedSendPacketTx, type SendPacketOperator } from '@cardano-ibc/tx-builder';
import { createTraceRegistryClient } from '@cardano-ibc/trace-registry';
import WebSocket from 'ws';
import { alignTreeWithChain, computeRootWithHandlePacketUpdate, initTreeServices, isTreeAligned, rebuildTreeFromChain } from './ibcStateRoot';
import { LucidIbcAdapter } from './lucidIbcAdapter';

const LOOKUP_RETRY_OPTIONS = {
  maxAttempts: 6,
  retryDelayMs: 1000,
} as const;
const TRANSACTION_TIME_TO_LIVE = 10 * 60 * 1000;
// Browser wallets should not need the gateway relayer's conservative 20 ADA floor.
// Lucid still raises this when protocol collateral requirements exceed the floor.
const TRANSACTION_SET_COLLATERAL = BigInt(5_000_000);
const MAX_SAFE_COST_MODEL_VALUE = Number.MAX_SAFE_INTEGER;
const PROTOCOL_PARAMETERS_MAX_ATTEMPTS = 5;
const PROTOCOL_PARAMETERS_BASE_DELAY_MS = 1000;
const TRANSIENT_STARTUP_ERROR_MARKERS = [
  'timeoutexception',
  'timeout',
  'timed out',
  'etimedout',
  'econnreset',
  'econnrefused',
  'requesterror',
  'request error',
  'transport error',
  'kupmioserror',
  'socket hang up',
  'network error',
  'fetch failed',
];

type RefUtxo = {
  txHash: string;
  outputIndex: number;
};

type AuthToken = {
  policyId: string;
  name: string;
};

type DeploymentRefValidator = {
  scriptHash: string;
  refUtxo: RefUtxo;
};

type DeploymentValidator = {
  scriptHash: string;
  address?: string;
  refUtxo: RefUtxo;
};

type DeploymentSpendChannelValidator = DeploymentValidator & {
  refValidator: {
    acknowledge_packet: DeploymentRefValidator;
    chan_close_confirm: DeploymentRefValidator;
    chan_close_init: DeploymentRefValidator;
    chan_open_ack: DeploymentRefValidator;
    chan_open_confirm: DeploymentRefValidator;
    recv_packet: DeploymentRefValidator;
    send_packet: DeploymentRefValidator;
    timeout_packet: DeploymentRefValidator;
  };
};

type DeploymentModule = {
  identifier: string;
  address: string;
};

type DeploymentTraceRegistry = {
  address: string;
  shardPolicyId: string;
  directory: {
    policyId: string;
    name: string;
  };
};

type DeploymentConfig = {
  deployedAt: string;
  hostStateNFT: AuthToken;
  handlerAuthToken: AuthToken;
  validators: {
    hostStateStt: DeploymentValidator;
    spendHandler: DeploymentValidator;
    spendClient: DeploymentValidator;
    spendConnection: DeploymentValidator;
    spendChannel: DeploymentSpendChannelValidator;
    spendTraceRegistry?: DeploymentValidator;
    spendTransferModule: DeploymentValidator;
    mintIdentifier: DeploymentValidator;
    verifyProof: DeploymentValidator;
    mintClientStt: DeploymentValidator;
    mintConnectionStt: DeploymentValidator;
    mintChannelStt: DeploymentValidator;
    mintVoucher: DeploymentValidator;
  };
  modules: {
    handler: DeploymentModule;
    transfer: DeploymentModule;
    mock?: DeploymentModule;
  };
  traceRegistry?: DeploymentTraceRegistry;
};

type BridgeManifest = {
  deployed_at: string;
  cardano: {
    network: string;
  };
  host_state_nft: {
    policy_id: string;
    token_name: string;
  };
  handler_auth_token: {
    policy_id: string;
    token_name: string;
  };
  validators: {
    host_state_stt: {
      script_hash: string;
      address: string;
      ref_utxo: { tx_hash: string; output_index: number };
    };
    spend_handler: {
      script_hash: string;
      address: string;
      ref_utxo: { tx_hash: string; output_index: number };
    };
    spend_client: {
      script_hash: string;
      address: string;
      ref_utxo: { tx_hash: string; output_index: number };
    };
    spend_connection: {
      script_hash: string;
      address: string;
      ref_utxo: { tx_hash: string; output_index: number };
    };
    spend_channel: {
      script_hash: string;
      address: string;
      ref_utxo: { tx_hash: string; output_index: number };
      ref_validator: {
        acknowledge_packet: {
          script_hash: string;
          ref_utxo: { tx_hash: string; output_index: number };
        };
        chan_close_confirm: {
          script_hash: string;
          ref_utxo: { tx_hash: string; output_index: number };
        };
        chan_close_init: {
          script_hash: string;
          ref_utxo: { tx_hash: string; output_index: number };
        };
        chan_open_ack: {
          script_hash: string;
          ref_utxo: { tx_hash: string; output_index: number };
        };
        chan_open_confirm: {
          script_hash: string;
          ref_utxo: { tx_hash: string; output_index: number };
        };
        recv_packet: {
          script_hash: string;
          ref_utxo: { tx_hash: string; output_index: number };
        };
        send_packet: {
          script_hash: string;
          ref_utxo: { tx_hash: string; output_index: number };
        };
        timeout_packet: {
          script_hash: string;
          ref_utxo: { tx_hash: string; output_index: number };
        };
      };
    };
    spend_trace_registry?: {
      script_hash: string;
      address: string;
      ref_utxo: { tx_hash: string; output_index: number };
    };
    spend_transfer_module: {
      script_hash: string;
      address: string;
      ref_utxo: { tx_hash: string; output_index: number };
    };
    mint_identifier: {
      script_hash: string;
      address: string;
      ref_utxo: { tx_hash: string; output_index: number };
    };
    verify_proof: {
      script_hash: string;
      address: string;
      ref_utxo: { tx_hash: string; output_index: number };
    };
    mint_client_stt: {
      script_hash: string;
      address: string;
      ref_utxo: { tx_hash: string; output_index: number };
    };
    mint_connection_stt: {
      script_hash: string;
      address: string;
      ref_utxo: { tx_hash: string; output_index: number };
    };
    mint_channel_stt: {
      script_hash: string;
      address: string;
      ref_utxo: { tx_hash: string; output_index: number };
    };
    mint_voucher: {
      script_hash: string;
      address: string;
      ref_utxo: { tx_hash: string; output_index: number };
    };
  };
  modules: {
    handler: { identifier: string; address: string };
    transfer: { identifier: string; address: string };
    mock?: { identifier: string; address: string };
  };
  trace_registry?: {
    address: string;
    shard_policy_id: string;
    directory: {
      policy_id: string;
      token_name: string;
    };
  };
};

type TransferApiRequestBody = {
  source_port?: string;
  source_channel?: string;
  token?: {
    denom?: string;
    amount?: string;
  };
  sender?: string;
  receiver?: string;
  timeout_height?: {
    revision_number?: string;
    revision_height?: string;
  };
  timeout_timestamp?: string;
  memo?: string;
  signer?: string;
  wallet_utxos?: WalletUtxoInput[];
};

type WalletUtxoInput = {
  txHash?: string;
  outputIndex?: number;
  address?: string;
  assets?: Record<string, string | number | bigint>;
  datumHash?: string | null;
  datum?: string | null;
  scriptRef?: unknown;
};

type LocalUnsignedTransferResponse = {
  result: number;
  unsignedTx: {
    type_url: string;
    unsignedTxCborHex: string;
  };
  feeLovelace: string;
};

type SubmitSignedTransactionApiRequestBody = {
  signed_tx_cbor?: unknown;
  description?: unknown;
};

type LocalSubmitSignedTransactionResponse = {
  txHash: string;
};

type RuntimeLogger = {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type KupmiosAuthHeaders = {
  kupoHeader?: Record<string, string>;
  ogmiosHeader?: Record<string, string>;
};

type BuilderRuntimeConfig = {
  bridgeManifestUrl: string;
  kupmiosUrl: string;
  kupmiosHeaders?: KupmiosAuthHeaders;
  fetchImpl?: typeof fetch;
  logger?: RuntimeLogger;
};

type BuilderContext = {
  deployment: DeploymentConfig;
  lucidService: LucidIbcAdapter;
  logger: RuntimeLogger;
  cardanoNetwork: Network;
  ogmiosEndpoint: string;
  kupmiosHeaders?: KupmiosAuthHeaders;
  traceRegistryClient: ReturnType<typeof createTraceRegistryClient>;
};

type OgmiosPoint = { slot: number; id: string };
type SlotConfig = { zeroTime: number; zeroSlot: number; slotLength: number };
type LucidModule = typeof import('@lucid-evolution/lucid');
const LUCID_NETWORKS = ['Mainnet', 'Preprod', 'Preview', 'Custom'] as const;

type KupoLikeService = {
  queryAllClientUtxos(): Promise<UTxO[]>;
  queryAllConnectionUtxos(): Promise<UTxO[]>;
  queryAllChannelUtxos(): Promise<UTxO[]>;
};

function defaultLogger(scope: string): RuntimeLogger {
  return {
    log: (...args: unknown[]) => console.log(`[${scope}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${scope}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${scope}]`, ...args),
  };
}

function startTimer(): bigint {
  return process.hrtime.bigint();
}

function elapsedMs(start: bigint): string {
  const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
  return `${Math.round(elapsed)}ms`;
}

function normalizeCardanoNetwork(network: string): Network {
  const normalized = network.trim().toLowerCase();
  switch (normalized) {
    case 'mainnet':
      return 'Mainnet';
    case 'preprod':
      return 'Preprod';
    case 'preview':
      return 'Preview';
    case 'custom':
    case 'devnet':
    case 'cardano-devnet':
      return 'Custom';
    default:
      throw new Error(
        `Unsupported Cardano network "${network}" in bridge manifest. Expected one of ${LUCID_NETWORKS.join(', ')}.`,
      );
  }
}

async function timed<T>(logger: RuntimeLogger, scope: string, label: string, operation: () => Promise<T>): Promise<T> {
  const startedAt = startTimer();
  try {
    const result = await operation();
    logger.log(`${scope} ${label} completed in ${elapsedMs(startedAt)}`);
    return result;
  } catch (error) {
    logger.error(`${scope} ${label} failed in ${elapsedMs(startedAt)}`, error);
    throw error;
  }
}

function describeFetchFailure(error: unknown): string {
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  const causeRecord = typeof cause === 'object' && cause !== null ? (cause as Record<string, unknown>) : undefined;
  const code = typeof causeRecord?.code === 'string' ? causeRecord.code : undefined;
  const address = typeof causeRecord?.address === 'string' ? causeRecord.address : undefined;
  const port = typeof causeRecord?.port === 'string' || typeof causeRecord?.port === 'number' ? String(causeRecord.port) : undefined;
  const causeMessage = cause instanceof Error ? cause.message : undefined;

  if (code && address && port) {
    return `${code} while connecting to ${address}:${port}`;
  }

  if (code) {
    return causeMessage ? `${code}: ${causeMessage}` : code;
  }

  if (causeMessage) {
    return causeMessage;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return String(error);
}

function mapRefUtxo(refUtxo: { tx_hash: string; output_index: number }): RefUtxo {
  return {
    txHash: refUtxo.tx_hash,
    outputIndex: refUtxo.output_index,
  };
}

function mapValidator(validator: { script_hash: string; address: string; ref_utxo: { tx_hash: string; output_index: number } }): DeploymentValidator {
  return {
    scriptHash: validator.script_hash,
    address: validator.address,
    refUtxo: mapRefUtxo(validator.ref_utxo),
  };
}

function normalizeBridgeManifest(manifest: BridgeManifest): {
  deployment: DeploymentConfig;
  bridgeManifest: BridgeManifest;
} {
  return {
    bridgeManifest: manifest,
    deployment: {
      deployedAt: manifest.deployed_at,
      hostStateNFT: {
        policyId: manifest.host_state_nft.policy_id,
        name: manifest.host_state_nft.token_name,
      },
      handlerAuthToken: {
        policyId: manifest.handler_auth_token.policy_id,
        name: manifest.handler_auth_token.token_name,
      },
      validators: {
        hostStateStt: mapValidator(manifest.validators.host_state_stt),
        spendHandler: mapValidator(manifest.validators.spend_handler),
        spendClient: mapValidator(manifest.validators.spend_client),
        spendConnection: mapValidator(manifest.validators.spend_connection),
        spendChannel: {
          ...mapValidator(manifest.validators.spend_channel),
          refValidator: {
            acknowledge_packet: {
              scriptHash: manifest.validators.spend_channel.ref_validator.acknowledge_packet.script_hash,
              refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.acknowledge_packet.ref_utxo),
            },
            chan_close_confirm: {
              scriptHash: manifest.validators.spend_channel.ref_validator.chan_close_confirm.script_hash,
              refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.chan_close_confirm.ref_utxo),
            },
            chan_close_init: {
              scriptHash: manifest.validators.spend_channel.ref_validator.chan_close_init.script_hash,
              refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.chan_close_init.ref_utxo),
            },
            chan_open_ack: {
              scriptHash: manifest.validators.spend_channel.ref_validator.chan_open_ack.script_hash,
              refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.chan_open_ack.ref_utxo),
            },
            chan_open_confirm: {
              scriptHash: manifest.validators.spend_channel.ref_validator.chan_open_confirm.script_hash,
              refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.chan_open_confirm.ref_utxo),
            },
            recv_packet: {
              scriptHash: manifest.validators.spend_channel.ref_validator.recv_packet.script_hash,
              refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.recv_packet.ref_utxo),
            },
            send_packet: {
              scriptHash: manifest.validators.spend_channel.ref_validator.send_packet.script_hash,
              refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.send_packet.ref_utxo),
            },
            timeout_packet: {
              scriptHash: manifest.validators.spend_channel.ref_validator.timeout_packet.script_hash,
              refUtxo: mapRefUtxo(manifest.validators.spend_channel.ref_validator.timeout_packet.ref_utxo),
            },
          },
        },
        ...(manifest.validators.spend_trace_registry
          ? {
              spendTraceRegistry: mapValidator(manifest.validators.spend_trace_registry),
            }
          : {}),
        spendTransferModule: mapValidator(manifest.validators.spend_transfer_module),
        mintIdentifier: mapValidator(manifest.validators.mint_identifier),
        verifyProof: mapValidator(manifest.validators.verify_proof),
        mintClientStt: mapValidator(manifest.validators.mint_client_stt),
        mintConnectionStt: mapValidator(manifest.validators.mint_connection_stt),
        mintChannelStt: mapValidator(manifest.validators.mint_channel_stt),
        mintVoucher: mapValidator(manifest.validators.mint_voucher),
      },
      modules: {
        handler: manifest.modules.handler,
        transfer: manifest.modules.transfer,
        ...(manifest.modules.mock ? { mock: manifest.modules.mock } : {}),
      },
      ...(manifest.trace_registry
        ? {
            traceRegistry: {
              address: manifest.trace_registry.address,
              shardPolicyId: manifest.trace_registry.shard_policy_id,
              directory: {
                policyId: manifest.trace_registry.directory.policy_id,
                name: manifest.trace_registry.directory.token_name,
              },
            },
          }
        : {}),
    },
  };
}

function splitKupmiosUrl(kupmiosUrl: string): {
  kupoEndpoint: string;
  ogmiosEndpoint: string;
} {
  const [kupoEndpoint, ogmiosEndpoint] = kupmiosUrl.split(',').map((value) => value.trim());
  if (!kupoEndpoint || !ogmiosEndpoint) {
    throw new Error('kupmiosUrl must be "<kupoEndpoint>,<ogmiosEndpoint>"');
  }
  return { kupoEndpoint, ogmiosEndpoint };
}

function isDemeterHost(hostname: string): boolean {
  return hostname.endsWith('.dmtr.host') || hostname.endsWith('.demeter.run');
}

function normalizeDemeterOgmiosEndpoint(
  ogmiosEndpoint: string,
  headers?: KupmiosAuthHeaders,
): { ogmiosEndpoint: string; headers?: KupmiosAuthHeaders } {
  const apiKey = headers?.ogmiosHeader?.['dmtr-api-key']?.trim();
  if (!apiKey) {
    return { ogmiosEndpoint, headers };
  }

  try {
    const parsed = new URL(ogmiosEndpoint);
    if (!isDemeterHost(parsed.hostname)) {
      return { ogmiosEndpoint, headers };
    }
    if (!parsed.host.startsWith(`${apiKey}.`)) {
      parsed.host = `${apiKey}.${parsed.host}`;
    }
    const nextHeaders: KupmiosAuthHeaders = { ...headers };
    // Demeter Ogmios uses host-based auth for HTTP JSON-RPC; the same key as a
    // header can leave POST requests waiting until the provider timeout.
    delete nextHeaders.ogmiosHeader;
    return {
      ogmiosEndpoint: parsed.toString().replace(/\/$/, ''),
      headers:
        nextHeaders.kupoHeader || nextHeaders.ogmiosHeader
          ? nextHeaders
          : undefined,
    };
  } catch {
    return { ogmiosEndpoint, headers };
  }
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid argument: "${fieldName}" is required`);
  }
  return value.trim();
}

function parseBigIntValue(value: unknown, fieldName: string): bigint {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error(`Invalid argument: "${fieldName}" must be a bigint-compatible value`);
  }

  try {
    return BigInt(value);
  } catch {
    throw new Error(`Invalid argument: "${fieldName}" must be a bigint-compatible value`);
  }
}

function parseSendPacketOperator(body: TransferApiRequestBody): SendPacketOperator {
  const sourcePort = parseRequiredString(body.source_port, 'source_port');
  const sourceChannel = parseRequiredString(body.source_channel, 'source_channel');
  if (!sourceChannel.startsWith('channel-')) {
    throw new Error('Invalid argument: "source_channel" must start with "channel-"');
  }

  return {
    sourcePort,
    sourceChannel,
    token: {
      denom: parseRequiredString(body.token?.denom, 'token.denom'),
      amount: parseBigIntValue(body.token?.amount, 'token.amount'),
    },
    sender: parseRequiredString(body.sender, 'sender'),
    receiver: parseRequiredString(body.receiver, 'receiver'),
    signer: parseRequiredString(body.signer, 'signer'),
    timeoutHeight: {
      revisionNumber: parseBigIntValue(body.timeout_height?.revision_number ?? '0', 'timeout_height.revision_number'),
      revisionHeight: parseBigIntValue(body.timeout_height?.revision_height ?? '0', 'timeout_height.revision_height'),
    },
    timeoutTimestamp: parseBigIntValue(body.timeout_timestamp ?? '0', 'timeout_timestamp'),
    memo: body.memo ?? '',
  };
}

function parseOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`Invalid argument: "${fieldName}" must be a string`);
  }
  return value;
}

function parseWalletUtxoAssets(value: unknown, fieldName: string): Record<string, bigint> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid argument: "${fieldName}" must be an asset map`);
  }

  const assets: Record<string, bigint> = {};
  for (const [unit, quantity] of Object.entries(value as Record<string, unknown>)) {
    assets[unit] = parseBigIntValue(quantity, `${fieldName}.${unit}`);
  }
  return assets;
}

function parseWalletUtxos(value: unknown): UTxO[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('Invalid argument: "wallet_utxos" must be an array');
  }

  return value.map((utxo, index) => {
    if (typeof utxo !== 'object' || utxo === null || Array.isArray(utxo)) {
      throw new Error(`Invalid argument: "wallet_utxos[${index}]" must be an object`);
    }
    const item = utxo as WalletUtxoInput;
    const txHash = parseRequiredString(item.txHash, `wallet_utxos[${index}].txHash`);
    const outputIndex = Number(item.outputIndex);
    if (!Number.isInteger(outputIndex) || outputIndex < 0) {
      throw new Error(`Invalid argument: "wallet_utxos[${index}].outputIndex" must be a non-negative integer`);
    }

    return {
      txHash,
      outputIndex,
      address: parseRequiredString(item.address, `wallet_utxos[${index}].address`),
      assets: parseWalletUtxoAssets(item.assets, `wallet_utxos[${index}].assets`),
      datumHash: parseOptionalString(item.datumHash, `wallet_utxos[${index}].datumHash`),
      datum: parseOptionalString(item.datum, `wallet_utxos[${index}].datum`),
    };
  });
}

function convertHex2String(value: string): string {
  if (!value) {
    return '';
  }
  return Buffer.from(value, 'hex').toString();
}

function parseConnectionSequence(connectionId: string): bigint {
  const match = /^connection-(\d+)$/.exec(connectionId);
  if (!match) {
    throw new Error(`Invalid connection id: ${connectionId}`);
  }
  return BigInt(match[1]);
}

function parseClientSequence(clientId: string): bigint {
  const match = /^07-tendermint-(\d+)$/.exec(clientId);
  if (!match) {
    throw new Error(`Invalid client id: ${clientId}`);
  }
  return BigInt(match[1]);
}

function commitPacket(packet: { timeout_height: { revisionNumber: bigint; revisionHeight: bigint }; timeout_timestamp: bigint; data: string }): string {
  let buffer = uint64ToBigEndian(packet.timeout_timestamp);
  buffer = appendBuffer(buffer, uint64ToBigEndian(packet.timeout_height.revisionNumber));
  buffer = appendBuffer(buffer, uint64ToBigEndian(packet.timeout_height.revisionHeight));

  const dataHash = crypto.createHash('sha256').update(Buffer.from(packet.data, 'hex')).digest('hex');
  return crypto
    .createHash('sha256')
    .update(Buffer.from(`${Buffer.from(buffer).toString('hex')}${dataHash}`, 'hex'))
    .digest('hex');
}

function uint64ToBigEndian(value: bigint): Uint8Array {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, value);
  return new Uint8Array(buffer);
}

function appendBuffer(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left, 0);
  result.set(right, left.length);
  return result;
}

function ogmiosRequest<T>(
  ogmiosUrl: string,
  methodName: string,
  args: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  return new Promise(async (resolve, reject) => {
    const client = new WebSocket(ogmiosUrl, headers ? { headers } : undefined);

    const cleanup = () => {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close();
      }
    };

    client.once('open', () => {
      client.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method: methodName,
          params: args,
        }),
      );
    });

    client.once('message', (rawMessage: WebSocket.RawData) => {
      try {
        const payload = JSON.parse(rawMessage.toString());
        if (payload?.error) {
          reject(new Error(payload.error.message ?? JSON.stringify(payload.error)));
          return;
        }
        resolve(payload.result as T);
      } catch (error) {
        reject(error);
      } finally {
        cleanup();
      }
    });

    client.once('error', (error: Error) => {
      cleanup();
      reject(error);
    });
  });
}

async function querySystemStart(ogmiosUrl: string, headers?: Record<string, string>): Promise<number> {
  const systemStart = await ogmiosRequest<string>(ogmiosUrl, 'queryNetwork/startTime', {}, headers);
  return Date.parse(systemStart);
}

async function queryNetworkTipPoint(ogmiosUrl: string, headers?: Record<string, string>): Promise<OgmiosPoint | 'origin'> {
  const result = await ogmiosRequest<OgmiosPoint | 'origin'>(ogmiosUrl, 'queryNetwork/tip', {}, headers);
  if (result === 'origin') {
    return 'origin';
  }

  if (typeof result?.slot !== 'number' || typeof result?.id !== 'string') {
    throw new Error('Ogmios queryNetwork/tip returned an invalid point');
  }

  return {
    slot: result.slot,
    id: result.id,
  };
}

async function submitSignedTxCbor(
  ogmiosUrl: string,
  signedTxCbor: string,
  headers: Record<string, string> | undefined,
  fetchImpl: typeof fetch,
): Promise<string> {
  const response = await fetchImpl(ogmiosUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(headers ?? {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'submitTransaction',
      params: {
        transaction: { cbor: signedTxCbor },
      },
      id: null,
    }),
  });

  const responseText = await response.text();
  let payload: any;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      `Ogmios submitTransaction failed (${response.status} ${response.statusText}): ${responseText.slice(0, 1000)}`,
    );
  }

  if (payload?.error) {
    throw new Error(
      `Ogmios submitTransaction rejected: ${payload.error.message ?? JSON.stringify(payload.error)}`,
    );
  }

  const txHash = payload?.result?.transaction?.id;
  if (typeof txHash !== 'string' || txHash.trim().length === 0) {
    throw new Error(
      `Ogmios submitTransaction returned an invalid response: ${responseText.slice(0, 1000)}`,
    );
  }

  return txHash;
}

function toSafeCostModelInteger(value: unknown): number {
  let parsedValue: number;

  if (typeof value === 'number') {
    parsedValue = value;
  } else if (typeof value === 'bigint') {
    parsedValue = Number(value);
  } else if (typeof value === 'string') {
    parsedValue = Number(value);
  } else {
    throw new Error(`Unsupported cost model value type: ${typeof value}`);
  }

  if (!Number.isFinite(parsedValue)) {
    throw new Error(`Invalid non-finite cost model value: ${String(value)}`);
  }

  if (!Number.isInteger(parsedValue)) {
    parsedValue = Math.trunc(parsedValue);
  }

  if (!Number.isSafeInteger(parsedValue)) {
    return parsedValue > 0 ? MAX_SAFE_COST_MODEL_VALUE : -MAX_SAFE_COST_MODEL_VALUE;
  }

  return parsedValue;
}

function sanitizeProtocolParameters(protocolParameters: any): any {
  if (!protocolParameters?.costModels) {
    return protocolParameters;
  }

  const sanitizedCostModels: Record<string, Record<string, number>> = {};
  for (const [version, model] of Object.entries(protocolParameters.costModels as Record<string, Record<string, unknown>>)) {
    const sanitizedModel: Record<string, number> = {};
    for (const [index, value] of Object.entries(model ?? {})) {
      sanitizedModel[index] = toSafeCostModelInteger(value);
    }
    sanitizedCostModels[version] = sanitizedModel;
  }

  return {
    ...protocolParameters,
    costModels: sanitizedCostModels,
  };
}

function collectErrorSignals(error: unknown): string[] {
  const signals: string[] = [];
  const visited = new Set<unknown>();

  const pushSignal = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }
    const normalized = value.trim();
    if (normalized.length > 0) {
      signals.push(normalized);
    }
  };

  const visit = (value: unknown, depth: number) => {
    if (value == null || depth > 3 || visited.has(value)) {
      return;
    }
    visited.add(value);

    if (typeof value === 'string') {
      pushSignal(value);
      return;
    }

    if (value instanceof Error) {
      pushSignal(value.name);
      pushSignal(value.message);
      if (typeof value.stack === 'string') {
        pushSignal(value.stack.split('\n')[0]?.trim());
      }
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      pushSignal(record.message);
      pushSignal(record.name);
      pushSignal(record.code);
      pushSignal(record.reason);
      pushSignal(record.details);
      pushSignal(record.type);
      pushSignal(record.statusText);

      visit(record.cause, depth + 1);
      visit(record.error, depth + 1);
      visit(record.originalError, depth + 1);
    }
  };

  visit(error, 0);
  return signals;
}

function isTransientStartupError(error: unknown): boolean {
  const normalizedSignals = collectErrorSignals(error).map((signal) => signal.toLowerCase());
  return normalizedSignals.some((signal) => TRANSIENT_STARTUP_ERROR_MARKERS.some((marker) => signal.includes(marker)));
}

function computeJitteredBackoffDelayMs(failedAttempt: number): number {
  const backoffDelay = PROTOCOL_PARAMETERS_BASE_DELAY_MS * 2 ** Math.max(0, failedAttempt - 1);
  const jitterMultiplier = 0.8 + Math.random() * 0.4;
  return Math.round(backoffDelay * jitterMultiplier);
}

async function retryWithBackoff<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= PROTOCOL_PARAMETERS_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientStartupError(error) || attempt >= PROTOCOL_PARAMETERS_MAX_ATTEMPTS) {
        throw error;
      }
      const retryDelayMs = computeJitteredBackoffDelayMs(attempt);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error('Kupmios protocol parameters fetch failed');
}

async function createLucidRuntime(
  kupoEndpoint: string,
  ogmiosEndpoint: string,
  cardanoNetwork: Network,
  logger: RuntimeLogger,
  headers?: KupmiosAuthHeaders,
): Promise<{ lucidImporter: LucidModule; lucid: LucidEvolution }> {
  const Lucid = await timed(logger, '[context]', 'import lucid', () => eval(`import('@lucid-evolution/lucid')`) as Promise<LucidModule>);
  const provider = new Lucid.Kupmios(kupoEndpoint, ogmiosEndpoint, headers);
  const protocolParameters = sanitizeProtocolParameters(await timed(logger, '[context]', 'fetch protocol parameters', () => retryWithBackoff(() => provider.getProtocolParameters())));
  const lucid = await timed(logger, '[context]', 'create lucid runtime', () =>
    Lucid.Lucid(provider, cardanoNetwork, {
      presetProtocolParameters: protocolParameters,
    } as any),
  );

  const chainZeroTime = await timed(logger, '[context]', 'query system start', () =>
    querySystemStart(ogmiosEndpoint, headers?.ogmiosHeader),
  );
  const slotConfig = Lucid.SLOT_CONFIG_NETWORK?.[cardanoNetwork] as SlotConfig | undefined;
  if (!slotConfig) {
    throw new Error(`Lucid does not expose a slot configuration for Cardano network ${cardanoNetwork}`);
  }
  slotConfig.zeroTime = chainZeroTime;
  slotConfig.slotLength = 1000;

  return {
    lucidImporter: Lucid,
    lucid,
  };
}

class RuntimeKupoService implements KupoLikeService {
  private readonly clientTokenPrefix: string;
  private readonly connectionTokenPrefix: string;
  private readonly channelTokenPrefix: string;
  private readonly clientAddress: string;
  private readonly connectionAddress: string;
  private readonly channelAddress: string;

  constructor(private readonly lucidService: LucidIbcAdapter, deployment: DeploymentConfig) {
    this.clientTokenPrefix = deployment.validators.mintClientStt.scriptHash;
    this.connectionTokenPrefix = deployment.validators.mintConnectionStt.scriptHash;
    this.channelTokenPrefix = deployment.validators.mintChannelStt.scriptHash;
    this.clientAddress = deployment.validators.spendClient.address ?? '';
    this.connectionAddress = deployment.validators.spendConnection.address ?? '';
    this.channelAddress = deployment.validators.spendChannel.address ?? '';
  }

  private getMatchingAssetNames(utxo: UTxO, policyId: string): string[] {
    return Object.keys(utxo.assets)
      .filter((assetId) => assetId !== 'lovelace')
      .filter((assetId) => assetId.startsWith(policyId))
      .map((assetId) => assetId.slice(policyId.length));
  }

  private async queryUtxosAtAddressByPolicy(address: string, policyId: string): Promise<UTxO[]> {
    try {
      const utxos = await this.lucidService.findUtxoAt(address);
      return utxos.filter((utxo) => this.getMatchingAssetNames(utxo, policyId).length > 0);
    } catch {
      return [];
    }
  }

  async queryAllClientUtxos(): Promise<UTxO[]> {
    return this.queryUtxosAtAddressByPolicy(this.clientAddress, this.clientTokenPrefix);
  }

  async queryAllConnectionUtxos(): Promise<UTxO[]> {
    return this.queryUtxosAtAddressByPolicy(this.connectionAddress, this.connectionTokenPrefix);
  }

  async queryAllChannelUtxos(): Promise<UTxO[]> {
    return this.queryUtxosAtAddressByPolicy(this.channelAddress, this.channelTokenPrefix);
  }
}

function dedupeUtxos(utxos: UTxO[]): UTxO[] {
  const seen = new Map<string, UTxO>();
  const orderedKeys: string[] = [];

  for (const utxo of utxos) {
    const key = utxoRef(utxo);
    if (!seen.has(key)) {
      orderedKeys.push(key);
    }
    seen.set(key, utxo);
  }

  return orderedKeys.map((key) => seen.get(key)).filter(Boolean) as UTxO[];
}

function utxoRef(utxo: Pick<UTxO, 'txHash' | 'outputIndex'>): string {
  return `${utxo.txHash}#${utxo.outputIndex}`;
}

function escrowShardHasOnlyDenom(utxo: UTxO, denomToken: string): boolean {
  return Object.keys(utxo.assets ?? {}).every((unit) => unit === 'lovelace' || unit === denomToken);
}

async function ensureTreeAlignedForRoot(context: BuilderContext, onChainRoot: string): Promise<void> {
  if (!isTreeAligned(onChainRoot)) {
    context.logger.warn(`IBC tree root mismatch for local tx builder runtime, aligning to ${onChainRoot.slice(0, 16)}...`);
    await alignTreeWithChain();
  }
}

async function buildHostStateUpdateForHandlePacket(context: BuilderContext, inputChannelDatum: any, outputChannelDatum: any, channelIdForRoot: string) {
  const hostStateUtxo = await context.lucidService.findUtxoAtHostStateNFT();
  if (!hostStateUtxo.datum) {
    throw new Error('HostState UTXO has no datum');
  }

  const hostStateDatum = await context.lucidService.decodeDatum<any>(hostStateUtxo.datum, 'host_state');

  await ensureTreeAlignedForRoot(context, hostStateDatum.state.ibc_state_root);

  const portId = convertHex2String(inputChannelDatum.port);
  const {
    newRoot,
    channelSiblings,
    nextSequenceSendSiblings,
    nextSequenceRecvSiblings,
    nextSequenceAckSiblings,
    packetCommitmentSiblings,
    packetReceiptSiblings,
    packetAcknowledgementSiblings,
    commit,
  } = await computeRootWithHandlePacketUpdate(hostStateDatum.state.ibc_state_root, portId, channelIdForRoot, inputChannelDatum, outputChannelDatum, context.lucidService.LucidImporter);

  const updatedHostStateDatum = {
    ...hostStateDatum,
    state: {
      ...hostStateDatum.state,
      version: hostStateDatum.state.version + 1n,
      ibc_state_root: newRoot,
      last_update_time: BigInt(Date.now()),
    },
  };

  const hostStateRedeemer = {
    HandlePacket: {
      channel_siblings: channelSiblings,
      next_sequence_send_siblings: nextSequenceSendSiblings,
      next_sequence_recv_siblings: nextSequenceRecvSiblings,
      next_sequence_ack_siblings: nextSequenceAckSiblings,
      packet_commitment_siblings: packetCommitmentSiblings,
      packet_receipt_siblings: packetReceiptSiblings,
      packet_acknowledgement_siblings: packetAcknowledgementSiblings,
    },
  };

  return {
    hostStateUtxo,
    encodedHostStateRedeemer: await context.lucidService.encode(hostStateRedeemer, 'host_state_redeemer'),
    encodedUpdatedHostStateDatum: await context.lucidService.encode(updatedHostStateDatum, 'host_state'),
    newRoot,
    commit,
  };
}

async function computeTxValidityWindow(context: BuilderContext) {
  const tip = await queryNetworkTipPoint(context.ogmiosEndpoint, context.kupmiosHeaders?.ogmiosHeader);
  const currentSlot = tip === 'origin' ? 0 : tip.slot;
  const ttlSlots = Math.max(1, Math.ceil(TRANSACTION_TIME_TO_LIVE / 1000));
  const validToSlot = currentSlot + ttlSlots;
  const slotConfig = context.lucidService.LucidImporter.SLOT_CONFIG_NETWORK?.[context.cardanoNetwork] as SlotConfig | undefined;
  if (!slotConfig || slotConfig.slotLength <= 0) {
    throw new Error(`Invalid Cardano slot configuration for network ${context.cardanoNetwork}`);
  }

  const validToTime = slotConfig.zeroTime + (validToSlot + 1 - slotConfig.zeroSlot) * slotConfig.slotLength - 1;

  return {
    currentSlot,
    validToSlot,
    validToTime,
  };
}

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export function createTxBuilderRuntime(config: BuilderRuntimeConfig) {
  const logger = config.logger ?? defaultLogger('txBuilderRuntime');
  let cachedContextPromise: Promise<BuilderContext> | null = null;
  const transferBuildQueue = new AsyncMutex();
  let transferBuildCounter = 0;

  const traceRegistryClient = createTraceRegistryClient({
    bridgeManifestUrl: config.bridgeManifestUrl,
    kupmiosUrl: config.kupmiosUrl,
    kupmiosHeaders: config.kupmiosHeaders,
    fetchImpl: config.fetchImpl,
  });

  async function getBridgeManifest(): Promise<BridgeManifest> {
    const fetchImpl = config.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(config.bridgeManifestUrl, {
        cache: 'no-store',
      });
    } catch (error) {
      throw new Error(`Failed to load bridge manifest from ${config.bridgeManifestUrl}: ${describeFetchFailure(error)}`, { cause: error });
    }

    if (!response.ok) {
      throw new Error(`Failed to load bridge manifest from ${config.bridgeManifestUrl}: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<BridgeManifest>;
  }

  async function createContext(): Promise<BuilderContext> {
    const contextStartedAt = startTimer();
    logger.log('[context] initializing shared Cardano tx-builder runtime context');

    const manifest = await timed(logger, '[context]', 'load bridge manifest', getBridgeManifest);
    const { deployment, bridgeManifest } = normalizeBridgeManifest(manifest);
    const { kupoEndpoint, ogmiosEndpoint: rawOgmiosEndpoint } = splitKupmiosUrl(config.kupmiosUrl);
    const { ogmiosEndpoint, headers: kupmiosHeaders } =
      normalizeDemeterOgmiosEndpoint(rawOgmiosEndpoint, config.kupmiosHeaders);
    const cardanoNetwork = normalizeCardanoNetwork(bridgeManifest.cardano.network);

    const { lucidImporter, lucid } = await createLucidRuntime(
      kupoEndpoint,
      ogmiosEndpoint,
      cardanoNetwork,
      logger,
      kupmiosHeaders,
    );
    const lucidService = new LucidIbcAdapter(lucidImporter, lucid, deployment);
    await timed(logger, '[context]', 'initialize lucid adapter', () => lucidService.onModuleInit());

    const kupoService = new RuntimeKupoService(lucidService, deployment);
    initTreeServices(kupoService, lucidService);
    await timed(logger, '[context]', 'rebuild IBC state tree', () => rebuildTreeFromChain(kupoService, lucidService));

    logger.log(`[context] initialized shared Cardano tx-builder runtime context in ${elapsedMs(contextStartedAt)}`);

    return {
      deployment,
      lucidService,
      logger,
      cardanoNetwork,
      ogmiosEndpoint,
      kupmiosHeaders,
      traceRegistryClient,
    };
  }

  async function getContext(): Promise<BuilderContext> {
    if (!cachedContextPromise) {
      cachedContextPromise = createContext().catch((error) => {
        cachedContextPromise = null;
        throw error;
      });
    }

    return cachedContextPromise;
  }

  async function buildUnsignedTransfer(
    body: TransferApiRequestBody,
  ): Promise<LocalUnsignedTransferResponse> {
    // Lucid wallet selection and IBC tree state are shared by the runtime context.
    const buildId = ++transferBuildCounter;
    const scope = `[transfer:${buildId}]`;
    return transferBuildQueue.runExclusive(() => buildUnsignedTransferUnsafe(body, scope));
  }

  async function buildUnsignedTransferUnsafe(
    body: TransferApiRequestBody,
    scope: string,
  ): Promise<LocalUnsignedTransferResponse> {
    const buildStartedAt = startTimer();
    logger.log(`${scope} preparing unsigned Cardano transfer`);

    const context = await timed(logger, scope, 'get runtime context', getContext);
    const sendPacketOperator = parseSendPacketOperator(body);
    const providedWalletUtxos = parseWalletUtxos(body.wallet_utxos);
    logger.log(`${scope} parsed request for ${sendPacketOperator.signer}; provided wallet UTxOs=${providedWalletUtxos.length}`);
    const getWalletUtxos = async (address: string, options: { maxAttempts: number; retryDelayMs: number }) => {
      const providedWalletUtxosForAddress = dedupeUtxos(providedWalletUtxos.filter((utxo) => utxo.address === address));
      const providerWalletUtxos = await timed(logger, scope, `provider wallet UTxO lookup for ${address}`, () => context.lucidService.tryFindUtxosAt(address, options));

      if (providedWalletUtxosForAddress.length > 0) {
        const providerRefs = new Set(providerWalletUtxos.map(utxoRef));
        // Browser wallet UTxOs are hints; keep only refs still live according to the node.
        const liveProvidedWalletUtxos = providedWalletUtxosForAddress.filter((utxo) => providerRefs.has(utxoRef(utxo)));
        const staleProvidedCount = providedWalletUtxosForAddress.length - liveProvidedWalletUtxos.length;
        const mergedWalletUtxos = dedupeUtxos([...liveProvidedWalletUtxos, ...providerWalletUtxos]);
        logger.log(`${scope} wallet UTxO live validation for ${address}: provided=${providedWalletUtxosForAddress.length}, stale_provided=${staleProvidedCount}, provider=${providerWalletUtxos.length}, merged=${mergedWalletUtxos.length}`);
        return mergedWalletUtxos;
      }

      logger.log(`${scope} wallet UTxO lookup for ${address}: provider=${providerWalletUtxos.length}`);
      return providerWalletUtxos;
    };
    const findWalletUtxoAtWithUnit = async (address: string, unit: string) => {
      const liveWalletUtxos = await getWalletUtxos(address, LOOKUP_RETRY_OPTIONS);
      const liveMatch = liveWalletUtxos.find((utxo) => Object.prototype.hasOwnProperty.call(utxo.assets, unit));
      if (liveMatch) {
        return liveMatch;
      }
      return context.lucidService.findUtxoAtWithUnit(address, unit);
    };
    const findTransferEscrowShard = async (
      channelId: string,
      packetDenom: string,
      denomToken: string,
      requiredAmount?: bigint,
    ) => {
      const encodedDatum = await context.lucidService.encode({ channel_id: channelId, denom: packetDenom }, 'transferEscrow');
      let utxos: UTxO[] = [];
      try {
        utxos = await context.lucidService.findUtxoAt(context.deployment.modules.transfer.address);
      } catch {
        utxos = [];
      }

      const candidates = utxos
        .filter((utxo) => utxo.datum === encodedDatum)
        .filter((utxo) => escrowShardHasOnlyDenom(utxo, denomToken))
        .filter((utxo) => requiredAmount === undefined || (utxo.assets[denomToken] ?? 0n) >= requiredAmount)
        .sort((a, b) => {
          const aAmount = a.assets[denomToken] ?? 0n;
          const bAmount = b.assets[denomToken] ?? 0n;
          if (aAmount === bAmount) {
            const txHashCompare = a.txHash.localeCompare(b.txHash);
            return txHashCompare !== 0 ? txHashCompare : a.outputIndex - b.outputIndex;
          }
          return aAmount > bAmount ? -1 : 1;
        });

      return {
        utxo: candidates[0],
        encodedDatum,
      };
    };

    const initialWalletUtxos = await timed(logger, scope, 'load initial wallet UTxOs', () => getWalletUtxos(sendPacketOperator.signer, LOOKUP_RETRY_OPTIONS));
    if (initialWalletUtxos.length === 0) {
      throw new Error(`sendPacketBuilder failed: no spendable UTxOs found for ${sendPacketOperator.signer}`);
    }
    logger.log(`${scope} initial wallet UTxOs selected=${initialWalletUtxos.length}`);
    context.lucidService.selectWalletFromAddress(sendPacketOperator.signer, initialWalletUtxos);

    const { unsignedTx, walletOverride } = await timed(logger, scope, 'build send_packet tx skeleton', () =>
      buildUnsignedSendPacketTx(sendPacketOperator, {
        loadContext: async (operator) => {
          const loadContextStartedAt = startTimer();
          try {
            const channelSequence = operator.sourceChannel.replace('channel-', '');
            const [mintChannelPolicyId, channelTokenName] = context.lucidService.getChannelTokenUnit(BigInt(channelSequence));
            const channelTokenUnit = mintChannelPolicyId + channelTokenName;
            const channelUtxo = await timed(logger, scope, 'load channel UTxO', () => context.lucidService.findUtxoByUnit(channelTokenUnit));
            const channelDatum = await timed(logger, scope, 'decode channel datum', () => context.lucidService.decodeDatum<any>(channelUtxo.datum!, 'channel'));

            const [mintConnectionPolicyId, connectionTokenName] = context.lucidService.getConnectionTokenUnit(
              parseConnectionSequence(convertHex2String(channelDatum.state.channel.connection_hops[0])),
            );
            const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
            const connectionUtxo = await timed(logger, scope, 'load connection UTxO', () => context.lucidService.findUtxoByUnit(connectionTokenUnit));
            const connectionDatum = await timed(logger, scope, 'decode connection datum', () => context.lucidService.decodeDatum<any>(connectionUtxo.datum!, 'connection'));

            const clientTokenUnit = context.lucidService.getClientTokenUnit(parseClientSequence(convertHex2String(connectionDatum.state.client_id)).toString());
            const clientUtxo = await timed(logger, scope, 'load client UTxO', () => context.lucidService.findUtxoByUnit(clientTokenUnit));
            const transferModuleIdentifier = context.deployment.modules.transfer.identifier;
            const transferModuleUtxo = await timed(logger, scope, 'load transfer module UTxO', () => context.lucidService.findUtxoByUnit(transferModuleIdentifier));
            const deployment = context.deployment;
            const spendChannelAddress = deployment.validators.spendChannel.address;
            if (!spendChannelAddress) {
              throw new Error('Spend channel script address is missing from deployment config');
            }

            return {
              channelUtxo,
              channelDatum,
              connectionUtxo,
              connectionDatum,
              clientUtxo,
              transferModuleUtxo,
              channelTokenUnit,
              channelToken: {
                policyId: mintChannelPolicyId,
                name: channelTokenName,
              },
              deployment: {
                sendPacketPolicyId: deployment.validators.spendChannel.refValidator.send_packet.scriptHash,
                mintVoucherScriptHash: deployment.validators.mintVoucher.scriptHash,
                spendChannelAddress,
                transferModuleAddress: deployment.modules.transfer.address,
              },
            };
          } finally {
            logger.log(`${scope} load builder context completed in ${elapsedMs(loadContextStartedAt)}`);
          }
        },
        buildHostStateUpdate: (inputChannelDatum, outputChannelDatum, channelIdForRoot) =>
          timed(logger, scope, 'build host-state update', () => buildHostStateUpdateForHandlePacket(context, inputChannelDatum, outputChannelDatum, channelIdForRoot)),
        resolveIbcDenomHash: async (denomHash) => {
          const match = await timed(logger, scope, `resolve denom hash ${denomHash}`, () => context.traceRegistryClient.lookupIbcDenomTrace(denomHash));
          if (!match) {
            return null;
          }

          return {
            path: match.path,
            baseDenom: match.baseDenom,
          };
        },
        commitPacket: (packet) => commitPacket(packet as any),
        encode: (value, kind) => context.lucidService.encode(value, kind as never),
        findUtxoAtWithUnit: findWalletUtxoAtWithUnit,
        tryFindUtxosAt: getWalletUtxos,
        findTransferEscrowShard,
        createUnsignedSendPacketBurnTx: (dto) => context.lucidService.createUnsignedSendPacketBurnTx(dto as never),
        createUnsignedSendPacketEscrowTx: (dto) => context.lucidService.createUnsignedSendPacketEscrowTx(dto as never),
        invalidArgument: (message) => new Error(message),
        internalError: (message) => new Error(message),
      }),
    );

    if (!walletOverride) {
      throw new Error('sendPacket failed: wallet override context was not produced');
    }

    const { currentSlot, validToSlot, validToTime } = await timed(logger, scope, 'compute validity window', () => computeTxValidityWindow(context));
    if (currentSlot > validToSlot) {
      throw new Error('sendPacket failed: tx time invalid');
    }

    const walletScopeId = context.lucidService.beginWalletSelectionScope();
    try {
      const refreshedUtxos = await timed(logger, scope, 'refresh wallet UTxOs before completion', () => getWalletUtxos(walletOverride.address, LOOKUP_RETRY_OPTIONS));
      const overrideUtxos = walletOverride.utxos ?? [];
      const mergedUtxos = dedupeUtxos([...overrideUtxos, ...refreshedUtxos]);
      const utxosToUse = mergedUtxos.length > 0 ? mergedUtxos : overrideUtxos;
      logger.log(`${scope} completion wallet UTxOs: override=${overrideUtxos.length}, refreshed=${refreshedUtxos.length}, using=${utxosToUse.length}`);

      context.lucidService.selectWalletFromAddress(walletOverride.address, utxosToUse);
      context.lucidService.assertWalletSelectionScopeSatisfied(walletScopeId, 'sendPacket');

      const completedUnsignedTx = await timed(logger, scope, 'complete unsigned tx', () =>
        (unsignedTx as TxBuilder).validTo(validToTime).complete({
          localUPLCEval: true,
          setCollateral: TRANSACTION_SET_COLLATERAL,
        }),
      );

      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const feeLovelace = completedUnsignedTx.toTransaction().body().fee().toString();
      logger.log(`${scope} prepared unsigned Cardano transfer in ${elapsedMs(buildStartedAt)}`);

      return {
        result: 0,
        unsignedTx: {
          type_url: '',
          unsignedTxCborHex: unsignedTxCbor,
        },
        feeLovelace,
      };
    } finally {
      context.lucidService.endWalletSelectionScope(walletScopeId);
    }
  }

  async function submitSignedTransaction(body: SubmitSignedTransactionApiRequestBody): Promise<LocalSubmitSignedTransactionResponse> {
    const submitId = ++transferBuildCounter;
    const scope = `[submit:${submitId}]`;
    const submitStartedAt = startTimer();
    const signedTxCbor = parseRequiredString(body.signed_tx_cbor, 'signed_tx_cbor');
    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : 'Cardano signed transaction';

    if (!/^[0-9a-f]+$/i.test(signedTxCbor) || signedTxCbor.length % 2 !== 0) {
      throw new Error('Invalid argument: "signed_tx_cbor" must be even-length hex CBOR');
    }

    logger.log(`${scope} submitting ${description}; signedTxLength=${signedTxCbor.length}`);
    const context = await timed(logger, scope, 'get runtime context', getContext);
    const txHash = await timed(logger, scope, 'submit signed transaction via Ogmios', () =>
      submitSignedTxCbor(
        context.ogmiosEndpoint,
        signedTxCbor,
        context.kupmiosHeaders?.ogmiosHeader,
        config.fetchImpl ?? fetch,
      ),
    );
    logger.log(`${scope} submitted signed Cardano transaction ${txHash} in ${elapsedMs(submitStartedAt)}`);
    return { txHash };
  }

  return {
    buildUnsignedTransfer,
    submitSignedTransaction,
  };
}

export type {
  BuilderRuntimeConfig,
  LocalSubmitSignedTransactionResponse,
  LocalUnsignedTransferResponse,
  SubmitSignedTransactionApiRequestBody,
  TransferApiRequestBody,
};
