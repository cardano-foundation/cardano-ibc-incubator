import { TxBuilder, UTxO } from '@lucid-evolution/lucid';
export * from './ics20-json-codec';
export declare const MAX_PACKET_ENTRIES_PER_CHANNEL = 64;
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
        packet_receipt: Map<bigint, string>;
        packet_acknowledgement: Map<bigint, string>;
        minimum_receive_proof_height: Height;
        maximum_receive_proof_height: Height;
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
    encodedUpdatedTransferModuleDatum?: string;
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
export type TransferEscrowShardLookup = {
    kind: 'existing';
    transferModuleUtxo: UTxO;
    utxo: UTxO;
    encodedDatum: string;
    shardTokenUnit: string;
} | {
    kind: 'missing';
    transferModuleUtxo: UTxO;
    encodedDatum: string;
    shardTokenUnit: string;
    registrySiblings: string[];
    encodedUpdatedTransferModuleDatum: string;
};
export type SendPacketBuildDependencies = {
    loadContext: (sendPacketOperator: SendPacketOperator) => Promise<LoadedSendPacketContext>;
    buildHostStateUpdate: (inputChannelDatum: ChannelDatumLike, outputChannelDatum: ChannelDatumLike, channelIdForRoot: string) => Promise<HostStateUpdate>;
    resolveIbcDenomHash: (denomHash: string) => Promise<VoucherDenomTrace | null>;
    commitPacket: (packet: Packet) => string;
    encode: (value: unknown, kind: string) => Promise<string>;
    findUtxoAtWithUnit: (address: string, unit: string) => Promise<UTxO>;
    tryFindUtxosAt: (address: string, options: {
        maxAttempts: number;
        retryDelayMs: number;
    }) => Promise<UTxO[]>;
    findTransferEscrowShard: (channelId: string, packetDenom: string, denomToken: string, requiredAmount?: bigint) => Promise<TransferEscrowShardLookup>;
    createUnsignedSendPacketBurnTx: (dto: UnsignedSendPacketBurnTxInput) => TxBuilder;
    createUnsignedSendPacketEscrowTx: (dto: UnsignedSendPacketEscrowTxInput) => TxBuilder;
    invalidArgument: (message: string) => Error;
    failedPrecondition?: (message: string) => Error;
    internalError: (message: string) => Error;
};
export declare function buildUnsignedSendPacketTx(sendPacketOperator: SendPacketOperator, deps: SendPacketBuildDependencies): Promise<SendPacketBuildResult>;
