import type { Network, UTxO } from '@lucid-evolution/lucid';
import { buildUnsignedSendPacketTx, type SendPacketOperator as SharedSendPacketOperator } from '@cardano-ibc/tx-builder';
import { CARDANO_BRIDGE_MANIFEST_URL, KUPMIOS_URL } from '@/configs/runtime';
import { normalizeBridgeManifestConfig } from '../../../../cardano/gateway/dist/config/bridge-manifest';
import { convertHex2String } from '../../../../cardano/gateway/dist/shared/helpers/hex';
import {
  alignTreeWithChain,
  computeRootWithHandlePacketUpdate,
  initTreeServices,
  isTreeAligned,
  rebuildTreeFromChain,
} from '../../../../cardano/gateway/dist/shared/helpers/ibc-state-root';
import { queryNetworkTipPoint } from '../../../../cardano/gateway/dist/shared/helpers/time';
import { commitPacket } from '../../../../cardano/gateway/dist/shared/helpers/commitment';
import { parseClientSequence, parseConnectionSequence } from '../../../../cardano/gateway/dist/shared/helpers/sequence';
import { ChannelDatum } from '../../../../cardano/gateway/dist/shared/types/channel/channel-datum';
import { ConnectionDatum } from '../../../../cardano/gateway/dist/shared/types/connection/connection-datum';
import { HostStateDatum } from '../../../../cardano/gateway/dist/shared/types/host-state-datum';
import { LucidImporter, LucidClient } from '../../../../cardano/gateway/dist/shared/modules/lucid/lucid.provider';
import { LucidService } from '../../../../cardano/gateway/dist/shared/modules/lucid/lucid.service';
import { KupoService } from '../../../../cardano/gateway/dist/shared/modules/kupo/kupo.service';
import { DenomTraceService } from '../../../../cardano/gateway/dist/query/services/denom-trace.service';

const LOOKUP_RETRY_OPTIONS = {
  maxAttempts: 6,
  retryDelayMs: 1000,
} as const;
const TRANSACTION_TIME_TO_LIVE = 120_000;
const TRANSACTION_SET_COLLATERAL = BigInt(20_000_000);

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
};

type BuilderContext = {
  configService: {
    get<T = unknown>(key: string): T;
  };
  lucidService: LucidService;
  denomTraceService: DenomTraceService;
  kupoService: KupoService;
  logger: {
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  cardanoNetwork: Network;
  ogmiosEndpoint: string;
};

export type LocalUnsignedTransferResponse = {
  result: number;
  unsignedTx: {
    type_url: string;
    value: string;
  };
};

let cachedContextPromise: Promise<BuilderContext> | null = null;

function createLogger(scope: string) {
  return {
    log: (...args: unknown[]) => console.log(`[${scope}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${scope}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${scope}]`, ...args),
  };
}

function splitKupmiosUrl(kupmiosUrl: string): { kupoEndpoint: string; ogmiosEndpoint: string } {
  const [kupoEndpoint, ogmiosEndpoint] = kupmiosUrl.split(',').map((value) => value.trim());
  if (!kupoEndpoint || !ogmiosEndpoint) {
    throw new Error(
      'NEXT_PUBLIC_KUPMIOS_URL must be "<kupoEndpoint>,<ogmiosEndpoint>" to build Cardano unsigned transactions locally.',
    );
  }
  return { kupoEndpoint, ogmiosEndpoint };
}

function createConfigService(values: Record<string, unknown>) {
  return {
    get<T = unknown>(key: string): T {
      return values[key] as T;
    },
  };
}

async function fetchLoadedBridgeConfig() {
  const response = await fetch(CARDANO_BRIDGE_MANIFEST_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load bridge manifest from ${CARDANO_BRIDGE_MANIFEST_URL}: ${response.status} ${response.statusText}`);
  }

  const manifest = await response.json();
  return normalizeBridgeManifestConfig(manifest);
}

async function createBuilderContext(): Promise<BuilderContext> {
  const logger = createLogger('cardanoTransferBuilder');
  const { deployment, bridgeManifest } = await fetchLoadedBridgeConfig();
  const { kupoEndpoint, ogmiosEndpoint } = splitKupmiosUrl(KUPMIOS_URL);

  const configService = createConfigService({
    deployment,
    bridgeManifest,
    kupoEndpoint,
    ogmiosEndpoint,
    cardanoNetwork: bridgeManifest.cardano.network as Network,
  });

  const lucidImporter = await LucidImporter.useFactory();
  const lucid = await LucidClient.useFactory(configService as never);
  const lucidService = new LucidService(
    lucidImporter as never,
    lucid as never,
    configService as never,
  );
  await lucidService.onModuleInit();

  const kupoService = new KupoService(lucidService, configService as never);
  initTreeServices(kupoService, lucidService);
  await rebuildTreeFromChain(kupoService, lucidService);

  const denomTraceService = new DenomTraceService(
    logger as never,
    configService as never,
    lucidService,
  );

  logger.log('Initialized local Cardano tx-builder context from manifest');

  return {
    configService,
    lucidService,
    denomTraceService,
    kupoService,
    logger,
    cardanoNetwork: bridgeManifest.cardano.network as Network,
    ogmiosEndpoint,
  };
}

async function getBuilderContext(): Promise<BuilderContext> {
  if (!cachedContextPromise) {
    cachedContextPromise = createBuilderContext().catch((error) => {
      cachedContextPromise = null;
      throw error;
    });
  }

  return cachedContextPromise;
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

function parseSendPacketOperator(body: TransferApiRequestBody): SharedSendPacketOperator {
  const sourcePort = parseRequiredString(body.source_port, 'source_port');
  const sourceChannel = parseRequiredString(body.source_channel, 'source_channel');
  if (!sourceChannel.startsWith('channel-')) {
    throw new Error('Invalid argument: "source_channel" must start with "channel-"');
  }

  const denom = parseRequiredString(body.token?.denom, 'token.denom');
  const amount = parseBigIntValue(body.token?.amount, 'token.amount');

  return {
    sourcePort,
    sourceChannel,
    token: {
      denom,
      amount,
    },
    sender: parseRequiredString(body.sender, 'sender'),
    receiver: parseRequiredString(body.receiver, 'receiver'),
    signer: parseRequiredString(body.signer, 'signer'),
    timeoutHeight: {
      revisionNumber: parseBigIntValue(
        body.timeout_height?.revision_number ?? '0',
        'timeout_height.revision_number',
      ),
      revisionHeight: parseBigIntValue(
        body.timeout_height?.revision_height ?? '0',
        'timeout_height.revision_height',
      ),
    },
    timeoutTimestamp: parseBigIntValue(
      body.timeout_timestamp ?? '0',
      'timeout_timestamp',
    ),
    memo: body.memo ?? '',
  };
}

async function ensureTreeAlignedForRoot(
  context: BuilderContext,
  onChainRoot: string,
): Promise<void> {
  if (!isTreeAligned(onChainRoot)) {
    context.logger.warn(
      `IBC tree root mismatch for local tx builder, aligning to ${onChainRoot.slice(0, 16)}...`,
    );
    await alignTreeWithChain();
  }
}

async function buildHostStateUpdateForHandlePacket(
  context: BuilderContext,
  inputChannelDatum: ChannelDatum,
  outputChannelDatum: ChannelDatum,
  channelIdForRoot: string,
) {
  const hostStateUtxo = await context.lucidService.findUtxoAtHostStateNFT();
  if (!hostStateUtxo.datum) {
    throw new Error('HostState UTXO has no datum');
  }

  const hostStateDatum = await context.lucidService.decodeDatum<HostStateDatum>(
    hostStateUtxo.datum,
    'host_state',
  );

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
  } = await computeRootWithHandlePacketUpdate(
    hostStateDatum.state.ibc_state_root,
    portId,
    channelIdForRoot,
    inputChannelDatum,
    outputChannelDatum,
    context.lucidService.LucidImporter,
  );

  const updatedHostStateDatum: HostStateDatum = {
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
    encodedHostStateRedeemer: await context.lucidService.encode(
      hostStateRedeemer,
      'host_state_redeemer',
    ),
    encodedUpdatedHostStateDatum: await context.lucidService.encode(
      updatedHostStateDatum,
      'host_state',
    ),
    newRoot,
    commit,
  };
}

async function refreshWalletContext(
  context: BuilderContext,
  addressOrCredential: string,
  errorContext: string,
): Promise<UTxO[]> {
  const walletUtxos = await context.lucidService.tryFindUtxosAt(addressOrCredential, LOOKUP_RETRY_OPTIONS);
  if (walletUtxos.length === 0) {
    throw new Error(`${errorContext} failed: no spendable UTxOs found for ${addressOrCredential}`);
  }

  context.lucidService.selectWalletFromAddress(addressOrCredential, walletUtxos);
  return walletUtxos;
}

function dedupeUtxos(utxos: UTxO[]): UTxO[] {
  const seen = new Map<string, UTxO>();
  const orderedKeys: string[] = [];

  for (const utxo of utxos) {
    const key = `${utxo.txHash}#${utxo.outputIndex}`;
    if (!seen.has(key)) {
      orderedKeys.push(key);
    }
    seen.set(key, utxo);
  }

  return orderedKeys.map((key) => seen.get(key)).filter(Boolean) as UTxO[];
}

async function computeTxValidityWindow(context: BuilderContext) {
  const tip = await queryNetworkTipPoint(context.ogmiosEndpoint);
  const currentSlot = tip === 'origin' ? 0 : tip.slot;
  const ttlSlots = Math.max(1, Math.ceil(TRANSACTION_TIME_TO_LIVE / 1000));
  const validToSlot = currentSlot + ttlSlots;
  const slotConfig = context.lucidService.LucidImporter.SLOT_CONFIG_NETWORK?.[context.cardanoNetwork];
  if (!slotConfig || slotConfig.slotLength <= 0) {
    throw new Error(`Invalid Cardano slot configuration for network ${context.cardanoNetwork}`);
  }

  const validToTime =
    slotConfig.zeroTime + (validToSlot + 1 - slotConfig.zeroSlot) * slotConfig.slotLength - 1;

  return {
    currentSlot,
    validToSlot,
    validToTime,
  };
}

export async function buildLocalUnsignedTransfer(
  body: TransferApiRequestBody,
): Promise<LocalUnsignedTransferResponse> {
  const context = await getBuilderContext();
  const sendPacketOperator = parseSendPacketOperator(body);

  await refreshWalletContext(context, sendPacketOperator.sender, 'sendPacketBuilder');

  const { unsignedTx, walletOverride } = await buildUnsignedSendPacketTx(
    sendPacketOperator,
    {
      loadContext: async (operator) => {
        const channelSequence = operator.sourceChannel.replace('channel-', '');
        const [mintChannelPolicyId, channelTokenName] =
          context.lucidService.getChannelTokenUnit(BigInt(channelSequence));
        const channelTokenUnit = mintChannelPolicyId + channelTokenName;
        const channelUtxo = await context.lucidService.findUtxoByUnit(channelTokenUnit);
        const channelDatum = await context.lucidService.decodeDatum<ChannelDatum>(
          channelUtxo.datum!,
          'channel',
        );

        const [mintConnectionPolicyId, connectionTokenName] =
          context.lucidService.getConnectionTokenUnit(
            parseConnectionSequence(
              convertHex2String(channelDatum.state.channel.connection_hops[0]),
            ),
          );
        const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
        const connectionUtxo = await context.lucidService.findUtxoByUnit(connectionTokenUnit);
        const connectionDatum = await context.lucidService.decodeDatum<ConnectionDatum>(
          connectionUtxo.datum!,
          'connection',
        );

        const clientTokenUnit = context.lucidService.getClientTokenUnit(
          parseClientSequence(convertHex2String(connectionDatum.state.client_id)),
        );
        const clientUtxo = await context.lucidService.findUtxoByUnit(clientTokenUnit);
        const transferModuleIdentifier = context.configService.get<any>('deployment').modules.transfer.identifier;
        const transferModuleUtxo = await context.lucidService.findUtxoByUnit(
          transferModuleIdentifier,
        );
        const deployment = context.configService.get<any>('deployment');

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
            sendPacketPolicyId:
              deployment.validators.spendChannel.refValidator.send_packet.scriptHash,
            mintVoucherScriptHash: deployment.validators.mintVoucher.scriptHash,
            spendChannelAddress: deployment.validators.spendChannel.address,
            transferModuleAddress: deployment.modules.transfer.address,
          },
        };
      },
      buildHostStateUpdate: (inputChannelDatum, outputChannelDatum, channelIdForRoot) =>
        buildHostStateUpdateForHandlePacket(
          context,
          inputChannelDatum as ChannelDatum,
          outputChannelDatum as ChannelDatum,
          channelIdForRoot,
        ),
      resolveIbcDenomHash: async (denomHash) => {
        const match = await context.denomTraceService.findByIbcDenomHash(denomHash);
        if (!match) {
          return null;
        }

        return {
          path: match.path,
          baseDenom: match.base_denom,
        };
      },
      commitPacket,
      encode: (value, kind) => context.lucidService.encode(value, kind as never),
      findUtxoAtWithUnit: (address, unit) => context.lucidService.findUtxoAtWithUnit(address, unit),
      tryFindUtxosAt: (address, options) => context.lucidService.tryFindUtxosAt(address, options),
      createUnsignedSendPacketBurnTx: (dto) => context.lucidService.createUnsignedSendPacketBurnTx(dto as never),
      createUnsignedSendPacketEscrowTx: (dto) => context.lucidService.createUnsignedSendPacketEscrowTx(dto as never),
      invalidArgument: (message) => new Error(message),
      internalError: (message) => new Error(message),
    },
  );

  if (!walletOverride) {
    throw new Error('sendPacket failed: wallet override context was not produced');
  }

  const { currentSlot, validToSlot, validToTime } = await computeTxValidityWindow(context);
  if (currentSlot > validToSlot) {
    throw new Error('sendPacket failed: tx time invalid');
  }

  const walletScopeId = context.lucidService.beginWalletSelectionScope();
  try {
    const refreshedUtxos = await context.lucidService.tryFindUtxosAt(
      walletOverride.address,
      LOOKUP_RETRY_OPTIONS,
    );
    const mergedUtxos = dedupeUtxos([...(walletOverride.utxos ?? []), ...refreshedUtxos]);
    const utxosToUse = mergedUtxos.length > 0 ? mergedUtxos : walletOverride.utxos;

    context.lucidService.selectWalletFromAddress(walletOverride.address, utxosToUse);
    context.lucidService.assertWalletSelectionScopeSatisfied(walletScopeId, 'sendPacket');

    const completedUnsignedTx = await unsignedTx.validTo(validToTime).complete({
      localUPLCEval: false,
      setCollateral: TRANSACTION_SET_COLLATERAL,
    });

    const unsignedTxCbor = completedUnsignedTx.toCBOR();
    const unsignedTxBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));

    return {
      result: 0,
      unsignedTx: {
        type_url: '',
        value: Buffer.from(unsignedTxBytes).toString('base64'),
      },
    };
  } finally {
    context.lucidService.endWalletSelectionScope(walletScopeId);
  }
}
