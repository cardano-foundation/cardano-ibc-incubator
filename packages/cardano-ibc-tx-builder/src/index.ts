import { TxBuilder, UTxO } from '@lucid-evolution/lucid';
import { blake2b } from '@noble/hashes/blake2b';

const LOVELACE = 'lovelace';
const CIP67_FT_LABEL_HEX = '0014df10';
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
  transferModuleUtxo: UTxO;
  channelTokenUnit: string;
  channelToken: AuthToken;
  deployment: {
    sendPacketPolicyId: string;
    mintVoucherScriptHash: string;
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
  transferModuleUTxO: UTxO;
  encodedSpendChannelRedeemer: string;
  encodedUpdatedChannelDatum: string;
  channelTokenUnit: string;
  encodedSpendTransferModuleRedeemer: string;
  encodedMintVoucherRedeemer: string;
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
  transferModuleUTxO: UTxO;
  encodedSpendChannelRedeemer: string;
  encodedUpdatedChannelDatum: string;
  channelTokenUnit: string;
  encodedSpendTransferModuleRedeemer: string;
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
  createUnsignedSendPacketBurnTx: (
    dto: UnsignedSendPacketBurnTxInput,
  ) => TxBuilder;
  createUnsignedSendPacketEscrowTx: (
    dto: UnsignedSendPacketEscrowTxInput,
  ) => TxBuilder;
  invalidArgument: (message: string) => Error;
  internalError: (message: string) => Error;
};

export async function buildUnsignedSendPacketTx(
  sendPacketOperator: SendPacketOperator,
  deps: SendPacketBuildDependencies,
): Promise<SendPacketBuildResult> {
  const context = await deps.loadContext(sendPacketOperator);

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
      Operator: [
        {
          TransferModuleOperator: [
            {
              Transfer: {
                channel_id: convertStringToHex(sendPacketOperator.sourceChannel),
                data: {
                  denom: convertStringToHex(packetDenom),
                  amount: convertStringToHex(
                    sendPacketOperator.token.amount.toString(),
                  ),
                  sender: convertStringToHex(sendPacketOperator.sender),
                  receiver: convertStringToHex(sendPacketOperator.receiver),
                  memo: convertStringToHex(sendPacketOperator.memo),
                },
              },
            },
          ],
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
        deps.commitPacket(packet),
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
        },
      },
      'mintVoucherRedeemer',
    );

    const voucherTokenUnit =
      context.deployment.mintVoucherScriptHash +
      buildVoucherTokenName(resolvedDenom, deps);
    const senderAddress = sendPacketOperator.sender;
    const senderVoucherTokenUtxo = await deps.findUtxoAtWithUnit(
      senderAddress,
      voucherTokenUnit,
    );
    const senderWalletUtxos = await deps.tryFindUtxosAt(
      senderAddress,
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
      transferModuleUTxO: context.transferModuleUtxo,
      senderVoucherTokenUtxo,
      walletUtxos,
      encodedHostStateRedeemer,
      encodedUpdatedHostStateDatum,
      encodedMintVoucherRedeemer,
      encodedSpendChannelRedeemer,
      encodedSpendTransferModuleRedeemer,
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
        address: senderAddress,
        utxos: walletUtxos,
      },
    };
  }

  const senderAddress = sendPacketOperator.sender;
  const senderWalletUtxos = await deps.tryFindUtxosAt(
    senderAddress,
    LOOKUP_RETRY_OPTIONS,
  );
  if (senderWalletUtxos.length === 0) {
    throw deps.internalError(
      `No spendable UTxOs found for sender ${senderAddress}`,
    );
  }

  const walletUtxos = dedupeUtxos(senderWalletUtxos);
  const denomToken = resolveEscrowDenomToken(
    inputDenom,
    resolvedDenom,
    walletUtxos,
    deps,
  );

  const unsignedTx = deps.createUnsignedSendPacketEscrowTx({
    hostStateUtxo,
    channelUTxO: context.channelUtxo,
    connectionUTxO: context.connectionUtxo,
    clientUTxO: context.clientUtxo,
    transferModuleUTxO: context.transferModuleUtxo,
    encodedHostStateRedeemer,
    encodedUpdatedHostStateDatum,
    encodedSpendChannelRedeemer,
    encodedSpendTransferModuleRedeemer,
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
      address: senderAddress,
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

  if (packet.denom) ordered.denom = packet.denom;
  if (packet.amount) ordered.amount = packet.amount;
  if (packet.sender) ordered.sender = packet.sender;
  if (packet.receiver) ordered.receiver = packet.receiver;
  if (packet.memo) ordered.memo = packet.memo;

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
