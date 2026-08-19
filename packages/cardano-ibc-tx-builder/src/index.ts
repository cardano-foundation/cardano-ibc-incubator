import type { TxBuilder, UTxO } from '@lucid-evolution/lucid';
import { blake2b } from '@noble/hashes/blake2b';

const LOVELACE = 'lovelace';
const CIP67_FT_LABEL_HEX = '0014df10';
const TRANSFER_ESCROW_SHARD_DOMAIN = Buffer.from('transfer-escrow-v2').toString(
  'hex',
);
export const MAX_PACKET_ENTRIES_PER_CHANNEL = 64;
const LOOKUP_RETRY_OPTIONS = {
  maxAttempts: 6,
  retryDelayMs: 1000,
} as const;

export type Height = {
  revisionNumber: bigint;
  revisionHeight: bigint;
};

export type AuthToken = {
  policyId: string;
  name: string;
};

export type TransferEscrowShardLookup = {
  utxo?: UTxO;
  encodedDatum: string;
  shardTokenUnit: string;
};

function encodeCborHeader(majorType: number, value: bigint): Buffer {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error(`Escrow shard identity integer is outside uint64: ${value}`);
  }
  if (value < 24n) {
    return Buffer.from([(majorType << 5) | Number(value)]);
  }
  if (value <= 0xffn) {
    return Buffer.from([(majorType << 5) | 24, Number(value)]);
  }
  if (value <= 0xffffn) {
    const encoded = Buffer.alloc(3);
    encoded[0] = (majorType << 5) | 25;
    encoded.writeUInt16BE(Number(value), 1);
    return encoded;
  }
  if (value <= 0xffff_ffffn) {
    const encoded = Buffer.alloc(5);
    encoded[0] = (majorType << 5) | 26;
    encoded.writeUInt32BE(Number(value), 1);
    return encoded;
  }
  const encoded = Buffer.alloc(9);
  encoded[0] = (majorType << 5) | 27;
  encoded.writeBigUInt64BE(value, 1);
  return encoded;
}

function encodeCborBytes(hex: string, field: string): Buffer {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new Error(`Escrow shard ${field} must be even-length hexadecimal`);
  }
  const bytes = Buffer.from(hex, 'hex');
  return Buffer.concat([encodeCborHeader(2, BigInt(bytes.length)), bytes]);
}

/**
 * Derive the one-shot escrow shard NFT name used by the Aiken minting policy.
 * Channel and denom are already hex-encoded Plutus byte arrays.
 */
export function deriveTransferEscrowShardTokenName(
  channelId: string,
  packetDenom: string,
  creationInput: Pick<UTxO, 'txHash' | 'outputIndex'>,
): string {
  // Aiken encodes tuples as indefinite Plutus lists and OutputReference as
  // constructor 0. Use the same length-delimited CBOR fields without pulling
  // the Lucid runtime into this otherwise dependency-light package.
  const preimage = Buffer.concat([
    Buffer.from([0x9f]),
    encodeCborBytes(TRANSFER_ESCROW_SHARD_DOMAIN, 'domain'),
    encodeCborBytes(channelId, 'channel ID'),
    encodeCborBytes(packetDenom, 'denomination'),
    Buffer.from([0xd8, 0x79, 0x9f]),
    encodeCborBytes(creationInput.txHash, 'creation transaction ID'),
    encodeCborHeader(0, BigInt(creationInput.outputIndex)),
    Buffer.from([0xff, 0xff]),
  ]);

  return Buffer.from(blake2b(preimage, { dkLen: 28 })).toString('hex');
}

/**
 * Select the only canonical shard matching an inline datum. Enumerating by
 * address avoids trusting provider APIs that return an arbitrary UTxO when a
 * duplicated asset unit exists, and also supports one-shot (non-deterministic)
 * NFT names and legacy shards during migration.
 */
export function resolveTransferEscrowShard(
  utxos: UTxO[],
  policyId: string,
  encodedDatum: string,
  channelId: string,
  packetDenom: string,
  denomToken: string,
  creationInput: Pick<UTxO, 'txHash' | 'outputIndex'>,
  requiredAmount?: bigint,
): TransferEscrowShardLookup {
  const candidates = utxos.filter((utxo) => {
    if (utxo.datum !== encodedDatum) {
      return false;
    }
    return Object.keys(utxo.assets ?? {}).some((unit) =>
      unit.startsWith(policyId)
    );
  });

  if (candidates.length > 1) {
    throw new Error(
      `Multiple transfer escrow shards match channel ${channelId} and denom ${packetDenom}`,
    );
  }

  if (candidates.length === 1) {
    const utxo = candidates[0];
    const assets = utxo.assets ?? {};
    const shardTokenUnits = Object.keys(assets).filter((unit) =>
      unit.startsWith(policyId)
    );
    if (shardTokenUnits.length !== 1) {
      throw new Error(
        `Transfer escrow shard ${utxo.txHash}#${utxo.outputIndex} must carry exactly one shard-policy asset`,
      );
    }

    const shardTokenUnit = shardTokenUnits[0];
    const canonical =
      shardTokenUnit.length === policyId.length + 56 &&
      (assets[shardTokenUnit] ?? 0n) === 1n &&
      Object.keys(assets).every(
        (unit) =>
          unit === LOVELACE ||
          unit === denomToken ||
          unit === shardTokenUnit,
      );
    if (!canonical) {
      throw new Error(
        `Transfer escrow shard ${utxo.txHash}#${utxo.outputIndex} has a non-canonical NFT or asset set`,
      );
    }

    if (
      requiredAmount === undefined ||
      (assets[denomToken] ?? 0n) >= requiredAmount
    ) {
      return { utxo, encodedDatum, shardTokenUnit };
    }

    throw new Error(
      `Transfer escrow shard ${utxo.txHash}#${utxo.outputIndex} does not contain the required ${requiredAmount} units of ${denomToken}`,
    );
  }

  const shardTokenName = deriveTransferEscrowShardTokenName(
    channelId,
    packetDenom,
    creationInput,
  );
  return {
    encodedDatum,
    shardTokenUnit: policyId + shardTokenName,
  };
}

export type SendPacketOperator = {
  sourcePort: string;
  sourceChannel: string;
  token: {
    denom: string;
    amount: bigint;
  };
  sender: string;
  receiver: string;
  signer: string;
  timeoutHeight: Height;
  timeoutTimestamp: bigint;
  memo: string;
};

export type Packet = {
  sequence: bigint;
  source_port: string;
  source_channel: string;
  destination_port: string;
  destination_channel: string;
  data: string;
  timeout_height: Height;
  timeout_timestamp: bigint;
};

export type ChannelDatumLike = {
  port: string;
  state: {
    next_sequence_send: bigint;
    packet_commitment: Map<bigint, string>;
    packet_receipt: Map<bigint, string>;
    packet_acknowledgement: Map<bigint, string>;
    channel: {
      connection_hops: string[];
      counterparty: {
        port_id: string;
        channel_id: string;
      };
    };
  };
};

export type ConnectionDatumLike = {
  state: {
    client_id: string;
  };
};

export type LoadedSendPacketContext = {
  channelUtxo: UTxO;
  channelDatum: ChannelDatumLike;
  connectionUtxo: UTxO;
  connectionDatum: ConnectionDatumLike;
  clientUtxo: UTxO;
  transferModuleReferenceUtxo: UTxO;
  channelTokenUnit: string;
  channelToken: AuthToken;
  deployment: {
    sendPacketPolicyId: string;
    mintVoucherScriptHash: string;
    transferEscrowShardPolicyId: string;
    spendChannelAddress: string;
    transferModuleAddress: string;
  };
};

export type HostStateUpdate = {
  hostStateUtxo: UTxO;
  encodedHostStateRedeemer: string;
  encodedUpdatedHostStateDatum: string;
  newRoot: string;
  commit: () => void;
};

export type PendingTreeUpdate = {
  expectedNewRoot: string;
  commit: () => void;
};

export type VoucherDenomTrace = {
  path: string;
  baseDenom: string;
};

export type SendPacketBuildResult = {
  unsignedTx: TxBuilder;
  pendingTreeUpdate: PendingTreeUpdate;
  walletOverride?: {
    address: string;
    utxos: UTxO[];
  };
};

export type UnsignedSendPacketBurnTxInput = {
  hostStateUtxo: UTxO;
  encodedHostStateRedeemer: string;
  encodedUpdatedHostStateDatum: string;
  channelUTxO: UTxO;
  connectionUTxO: UTxO;
  clientUTxO: UTxO;
  encodedSpendChannelRedeemer: string;
  encodedUpdatedChannelDatum: string;
  channelTokenUnit: string;
  encodedMintVoucherRedeemer: string;
  encodedSpendTransferModuleRedeemer: string;
  transferModuleReferenceUtxo: UTxO;
  transferAmount: bigint;
  constructedAddress: string;
  sendPacketPolicyId: string;
  channelToken: AuthToken;
  senderVoucherTokenUtxo: UTxO;
  walletUtxos?: UTxO[];
  voucherTokenUnit: string;
  senderAddress: string;
  receiverAddress: string;
  denomToken: string;
};

export type UnsignedSendPacketEscrowTxInput = {
  hostStateUtxo: UTxO;
  encodedHostStateRedeemer: string;
  encodedUpdatedHostStateDatum: string;
  channelUTxO: UTxO;
  connectionUTxO: UTxO;
  clientUTxO: UTxO;
  transferModuleReferenceUtxo: UTxO;
  encodedSpendChannelRedeemer: string;
  encodedUpdatedChannelDatum: string;
  channelTokenUnit: string;
  encodedSpendTransferModuleRedeemer: string;
  encodedMintTransferEscrowShardRedeemer?: string;
  transferAmount: bigint;
  constructedAddress: string;
  sendPacketPolicyId: string;
  channelToken: AuthToken;
  senderAddress: string;
  receiverAddress: string;
  walletUtxos: UTxO[];
  spendChannelAddress: string;
  transferModuleAddress: string;
  denomToken: string;
  transferEscrowUtxo?: UTxO;
  encodedTransferEscrowDatum?: string;
  transferEscrowShardTokenUnit?: string;
};

export type SendPacketBuildDependencies = {
  loadContext: (
    sendPacketOperator: SendPacketOperator,
  ) => Promise<LoadedSendPacketContext>;
  buildHostStateUpdate: (
    inputChannelDatum: ChannelDatumLike,
    outputChannelDatum: ChannelDatumLike,
    channelIdForRoot: string,
  ) => Promise<HostStateUpdate>;
  resolveIbcDenomHash: (
    denomHash: string,
  ) => Promise<VoucherDenomTrace | null>;
  commitPacket: (packet: Packet) => string;
  encode: (value: unknown, kind: string) => Promise<string>;
  findUtxoAtWithUnit: (address: string, unit: string) => Promise<UTxO>;
  tryFindUtxosAt: (
    address: string,
    options: {
      maxAttempts: number;
      retryDelayMs: number;
    },
  ) => Promise<UTxO[]>;
  findTransferEscrowShard: (
    channelId: string,
    packetDenom: string,
    denomToken: string,
    creationInput: UTxO,
    requiredAmount?: bigint,
  ) => Promise<TransferEscrowShardLookup>;
  createUnsignedSendPacketBurnTx: (
    dto: UnsignedSendPacketBurnTxInput,
  ) => TxBuilder;
  createUnsignedSendPacketEscrowTx: (
    dto: UnsignedSendPacketEscrowTxInput,
  ) => TxBuilder;
  invalidArgument: (message: string) => Error;
  failedPrecondition?: (message: string) => Error;
  internalError: (message: string) => Error;
};

export async function buildUnsignedSendPacketTx(
  sendPacketOperator: SendPacketOperator,
  deps: SendPacketBuildDependencies,
): Promise<SendPacketBuildResult> {
  const context = await deps.loadContext(sendPacketOperator);

  const retainedPacketEntryCount =
    context.channelDatum.state.packet_commitment.size +
    context.channelDatum.state.packet_receipt.size +
    context.channelDatum.state.packet_acknowledgement.size;
  if (
    retainedPacketEntryCount >= MAX_PACKET_ENTRIES_PER_CHANNEL
  ) {
    const packetCapacityError =
      deps.failedPrecondition ?? deps.invalidArgument;
    throw packetCapacityError(
      `Channel ${sendPacketOperator.sourceChannel} retained packet state capacity ` +
        `of ${MAX_PACKET_ENTRIES_PER_CHANNEL} is exhausted`,
    );
  }

  const inputDenom = normalizeDenomTokenTransfer(
    sendPacketOperator.token.denom,
    deps,
  );
  const resolvedDenom = await resolvePacketDenomForSend(inputDenom, deps);
  const packetDenom = normalizePacketDenom(
    resolvedDenom,
    sendPacketOperator.sourcePort,
    sendPacketOperator.sourceChannel,
    deps,
  );
  const isVoucher = hasVoucherPrefix(
    resolvedDenom,
    sendPacketOperator.sourcePort,
    sendPacketOperator.sourceChannel,
  );

  const packet: Packet = {
    sequence: context.channelDatum.state.next_sequence_send,
    source_port: convertStringToHex(sendPacketOperator.sourcePort),
    source_channel: convertStringToHex(sendPacketOperator.sourceChannel),
    destination_port: context.channelDatum.state.channel.counterparty.port_id,
    destination_channel:
      context.channelDatum.state.channel.counterparty.channel_id,
    data: convertStringToHex(
      stringifyIcs20PacketData({
        denom: packetDenom,
        amount: sendPacketOperator.token.amount.toString(),
        sender: sendPacketOperator.sender,
        receiver: sendPacketOperator.receiver,
        memo: sendPacketOperator.memo,
      }),
    ),
    timeout_height: sendPacketOperator.timeoutHeight,
    timeout_timestamp: sendPacketOperator.timeoutTimestamp,
  };
  const fungibleTokenPacketData = {
    denom: convertStringToHex(packetDenom),
    amount: convertStringToHex(sendPacketOperator.token.amount.toString()),
    sender: convertStringToHex(sendPacketOperator.sender),
    receiver: convertStringToHex(sendPacketOperator.receiver),
    memo: convertStringToHex(sendPacketOperator.memo),
  };
  const packetCommitment = deps.commitPacket(packet);

  const encodedSpendChannelRedeemer = await deps.encode(
    {
      SendPacket: {
        packet,
      },
    },
    'spendChannelRedeemer',
  );

  const encodedSpendTransferModuleRedeemer = await deps.encode(
    {
      Callback: [
        {
          OnSendPacket: {
            channel_id: convertStringToHex(sendPacketOperator.sourceChannel),
            packet_data: packet.data,
            packet_commitment: packetCommitment,
            data: {
              TransferModuleData: [fungibleTokenPacketData],
            },
          },
        },
      ],
    },
    'iBCModuleRedeemer',
  );

  const updatedChannelDatum: ChannelDatumLike = {
    ...context.channelDatum,
    state: {
      ...context.channelDatum.state,
      next_sequence_send: context.channelDatum.state.next_sequence_send + 1n,
      packet_commitment: insertSortMapWithNumberKey(
        context.channelDatum.state.packet_commitment,
        packet.sequence,
        packetCommitment,
      ),
    },
  };

  const {
    hostStateUtxo,
    encodedHostStateRedeemer,
    encodedUpdatedHostStateDatum,
    newRoot,
    commit,
  } = await deps.buildHostStateUpdate(
    context.channelDatum,
    updatedChannelDatum,
    sendPacketOperator.sourceChannel,
  );

  if (isVoucher) {
    const encodedMintVoucherRedeemer = await deps.encode(
      {
        BurnVoucher: {
          packet_source_port: packet.source_port,
          packet_source_channel: packet.source_channel,
          data: fungibleTokenPacketData,
        },
      },
      'mintVoucherRedeemer',
    );

    const voucherTokenUnit =
      context.deployment.mintVoucherScriptHash +
      buildVoucherTokenName(resolvedDenom, deps);
    const senderAddress = sendPacketOperator.sender;
    const signerWalletAddress = sendPacketOperator.signer;
    const senderVoucherTokenUtxo = await deps.findUtxoAtWithUnit(
      signerWalletAddress,
      voucherTokenUnit,
    );
    const senderWalletUtxos = await deps.tryFindUtxosAt(
      signerWalletAddress,
      LOOKUP_RETRY_OPTIONS,
    );
    const walletUtxos = dedupeUtxos([
      ...senderWalletUtxos,
      senderVoucherTokenUtxo,
    ]);

    const unsignedTx = deps.createUnsignedSendPacketBurnTx({
      hostStateUtxo,
      channelUTxO: context.channelUtxo,
      connectionUTxO: context.connectionUtxo,
      clientUTxO: context.clientUtxo,
      senderVoucherTokenUtxo,
      walletUtxos,
      encodedHostStateRedeemer,
      encodedUpdatedHostStateDatum,
      encodedMintVoucherRedeemer,
      encodedSpendTransferModuleRedeemer,
      transferModuleReferenceUtxo: context.transferModuleReferenceUtxo,
      encodedSpendChannelRedeemer,
      encodedUpdatedChannelDatum: await deps.encode(updatedChannelDatum, 'channel'),
      transferAmount: sendPacketOperator.token.amount,
      senderAddress,
      receiverAddress: sendPacketOperator.receiver,
      constructedAddress: sendPacketOperator.signer,
      channelTokenUnit: context.channelTokenUnit,
      voucherTokenUnit,
      denomToken: inputDenom,
      sendPacketPolicyId: context.deployment.sendPacketPolicyId,
      channelToken: context.channelToken,
    });

    return {
      unsignedTx,
      pendingTreeUpdate: {
        expectedNewRoot: newRoot,
        commit,
      },
      walletOverride: {
        address: signerWalletAddress,
        utxos: walletUtxos,
      },
    };
  }

  const senderAddress = sendPacketOperator.sender;
  const signerWalletAddress = sendPacketOperator.signer;
  const senderWalletUtxos = await deps.tryFindUtxosAt(
    signerWalletAddress,
    LOOKUP_RETRY_OPTIONS,
  );
  if (senderWalletUtxos.length === 0) {
    throw deps.internalError(
      `No spendable UTxOs found for signer ${signerWalletAddress}`,
    );
  }

  const walletUtxos = dedupeUtxos(senderWalletUtxos);
  const denomToken = resolveEscrowDenomToken(
    inputDenom,
    resolvedDenom,
    walletUtxos,
    deps,
  );
  const transferEscrowShard = await deps.findTransferEscrowShard(
    convertStringToHex(sendPacketOperator.sourceChannel),
    convertStringToHex(packetDenom),
    denomToken,
    context.transferModuleReferenceUtxo,
  );

  const unsignedTx = deps.createUnsignedSendPacketEscrowTx({
    hostStateUtxo,
    channelUTxO: context.channelUtxo,
    connectionUTxO: context.connectionUtxo,
    clientUTxO: context.clientUtxo,
    transferModuleReferenceUtxo: context.transferModuleReferenceUtxo,
    encodedHostStateRedeemer,
    encodedUpdatedHostStateDatum,
    encodedSpendChannelRedeemer,
    encodedSpendTransferModuleRedeemer,
    encodedMintTransferEscrowShardRedeemer: transferEscrowShard.utxo
      ? undefined
      : await deps.encode(
          {
            CreateEscrowShard: {
              channel_id: convertStringToHex(sendPacketOperator.sourceChannel),
              denom: convertStringToHex(packetDenom),
              data: fungibleTokenPacketData,
            },
          },
          'transferEscrowShardRedeemer',
        ),
    encodedUpdatedChannelDatum: await deps.encode(updatedChannelDatum, 'channel'),
    transferAmount: sendPacketOperator.token.amount,
    senderAddress,
    receiverAddress: sendPacketOperator.receiver,
    walletUtxos,
    constructedAddress: sendPacketOperator.signer,
    spendChannelAddress: context.deployment.spendChannelAddress,
    channelTokenUnit: context.channelTokenUnit,
    transferModuleAddress: context.deployment.transferModuleAddress,
    denomToken,
    transferEscrowUtxo: transferEscrowShard.utxo,
    encodedTransferEscrowDatum: transferEscrowShard.encodedDatum,
    transferEscrowShardTokenUnit: transferEscrowShard.shardTokenUnit,
    sendPacketPolicyId: context.deployment.sendPacketPolicyId,
    channelToken: context.channelToken,
  });

  return {
    unsignedTx,
    pendingTreeUpdate: {
      expectedNewRoot: newRoot,
      commit,
    },
    walletOverride: {
      address: signerWalletAddress,
      utxos: walletUtxos,
    },
  };
}

function normalizeDenomTokenTransfer(
  denom: string,
  deps: Pick<SendPacketBuildDependencies, 'invalidArgument'>,
): string {
  const normalizedDenom = denom?.trim();
  if (!normalizedDenom) {
    throw deps.invalidArgument('Invalid argument: "token.denom" is required');
  }
  return normalizedDenom;
}

function mapLovelaceDenom(
  denom: string,
  direction: 'asset_to_packet' | 'packet_to_asset',
): string {
  const normalizedDenom = denom.trim();
  const lowerDenom = normalizedDenom.toLowerCase();
  const lovelacePacketDenom = Buffer.from(LOVELACE, 'utf8').toString('hex');

  if (direction === 'asset_to_packet') {
    return lowerDenom === LOVELACE ? lovelacePacketDenom : normalizedDenom;
  }

  return lowerDenom === lovelacePacketDenom || lowerDenom === LOVELACE
    ? LOVELACE
    : normalizedDenom;
}

function hasVoucherPrefix(
  denom: string,
  portId: string,
  channelId: string,
): boolean {
  return denom.startsWith(getDenomPrefix(portId, channelId));
}

function getDenomPrefix(portId: string, channelId: string): string {
  return `${portId}/${channelId}/`;
}

function insertSortMapWithNumberKey<K, V>(
  inputMap: Map<K, V>,
  newKey: K,
  newValue: V,
): Map<K, V> {
  const updatedMap = new Map(inputMap);
  updatedMap.set(newKey, newValue);
  return new Map(
    Array.from(updatedMap.entries()).sort(
      ([keyA], [keyB]) => Number(keyA) - Number(keyB),
    ),
  );
}

function stringifyIcs20PacketData(packet: {
  denom?: string;
  amount?: string;
  sender?: string;
  receiver?: string;
  memo?: string;
}): string {
  const ordered: Record<string, string> = {};

  if (packet.amount) ordered.amount = packet.amount;
  if (packet.denom) ordered.denom = packet.denom;
  if (packet.memo) ordered.memo = packet.memo;
  if (packet.receiver) ordered.receiver = packet.receiver;
  if (packet.sender) ordered.sender = packet.sender;

  return JSON.stringify(ordered);
}

function convertStringToHex(value: string): string {
  if (!value) {
    return '';
  }
  return Buffer.from(value).toString('hex');
}

function buildVoucherTokenName(
  denom: string,
  deps: Pick<SendPacketBuildDependencies, 'invalidArgument'>,
): string {
  if (denom.startsWith('ibc/')) {
    throw deps.invalidArgument(
      `IBC hash denom ${denom} must be reverse-resolved before voucher token-name hashing`,
    );
  }

  if (isHexDenom(denom)) {
    throw deps.invalidArgument(
      'Voucher denom appears to be already hex-encoded; refusing to hash a double-encoded denom',
    );
  }

  const voucherDenomHash = Buffer.from(
    blake2b(Buffer.from(denom, 'utf8'), { dkLen: 28 }),
  ).toString('hex');
  return `${CIP67_FT_LABEL_HEX}${voucherDenomHash}`;
}

async function resolvePacketDenomForSend(
  denom: string,
  deps: Pick<
    SendPacketBuildDependencies,
    'resolveIbcDenomHash' | 'invalidArgument'
  >,
): Promise<string> {
  if (!denom.startsWith('ibc/')) {
    return denom;
  }

  const denomHash = denom.slice(4).toLowerCase();
  const match = await deps.resolveIbcDenomHash(denomHash);
  if (!match) {
    throw deps.invalidArgument(
      `IBC denom ${denom} not found in denom traces; cannot derive voucher token name`,
    );
  }

  return match.path ? `${match.path}/${match.baseDenom}` : match.baseDenom;
}

function normalizePacketDenom(
  denom: string,
  portId: string,
  channelId: string,
  deps: Pick<SendPacketBuildDependencies, 'invalidArgument'>,
): string {
  const normalizedDenom = normalizeDenomTokenTransfer(denom, deps).trim();
  const packetMappedDenom = mapLovelaceDenom(
    normalizedDenom,
    'asset_to_packet',
  );
  if (packetMappedDenom !== normalizedDenom) {
    return packetMappedDenom;
  }

  if (hasVoucherPrefix(normalizedDenom, portId, channelId)) {
    return normalizedDenom;
  }
  if (normalizedDenom.startsWith('ibc/')) {
    throw deps.invalidArgument(
      `IBC hash denom ${normalizedDenom} must be reverse-resolved to a full denom trace before packet normalization`,
    );
  }
  if (isCardanoTokenUnitDenom(normalizedDenom)) {
    return normalizedDenom;
  }
  if (isHexDenom(normalizedDenom)) {
    throw deps.invalidArgument(
      'Denom appears to be already hex-encoded; refusing to hex-encode twice',
    );
  }

  return convertStringToHex(normalizedDenom);
}

function isCardanoTokenUnitDenom(denom: string): boolean {
  return /^[0-9a-fA-F]{56}(?:[0-9a-fA-F]{0,64})$/.test(denom);
}

function isHexDenom(denom: string): boolean {
  return denom.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(denom);
}

function sumAssetsFromUtxos(utxos: UTxO[]): Record<string, bigint> {
  const summedAssets: Record<string, bigint> = {};
  for (const utxo of utxos) {
    for (const [assetUnit, amount] of Object.entries(
      utxo.assets as Record<string, bigint>,
    )) {
      summedAssets[assetUnit] = (summedAssets[assetUnit] ?? 0n) + amount;
    }
  }
  return summedAssets;
}

function tryResolveAssetUnitFromAssets(
  assets: Record<string, bigint>,
  requestedDenomToken: string,
): string | null {
  const normalized = requestedDenomToken.trim();
  if (!normalized) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(assets, normalized)) {
    return normalized;
  }

  const normalizedLower = normalized.toLowerCase();
  const matchedUnit = Object.keys(assets).find(
    (unit) => unit.toLowerCase() === normalizedLower,
  );
  return matchedUnit ?? null;
}

function resolveEscrowDenomToken(
  inputDenom: string,
  resolvedDenom: string,
  senderWalletUtxos: UTxO[],
  deps: Pick<SendPacketBuildDependencies, 'invalidArgument'>,
): string {
  const senderAssets = sumAssetsFromUtxos(senderWalletUtxos);

  const directInputMatch = tryResolveAssetUnitFromAssets(
    senderAssets,
    inputDenom,
  );
  if (directInputMatch !== null) {
    return directInputMatch;
  }

  const directResolvedMatch = tryResolveAssetUnitFromAssets(
    senderAssets,
    resolvedDenom,
  );
  if (directResolvedMatch !== null) {
    return directResolvedMatch;
  }

  throw deps.invalidArgument(
    `Escrow asset unit not found in sender wallet UTxOs for denom ${inputDenom} (resolved as ${resolvedDenom})`,
  );
}

function dedupeUtxos(utxos: UTxO[]): UTxO[] {
  const map = new Map<string, UTxO>();
  const order: string[] = [];

  for (const utxo of utxos) {
    const key = `${utxo.txHash}#${utxo.outputIndex}`;
    if (!map.has(key)) {
      order.push(key);
    }
    map.set(key, utxo);
  }

  return order.map((key) => map.get(key)!).filter(Boolean);
}
