import { TxBuilder, UTxO } from '@lucid-evolution/lucid';
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
    createUnsignedSendPacketBurnTx: (dto: UnsignedSendPacketBurnTxInput) => TxBuilder;
    createUnsignedSendPacketEscrowTx: (dto: UnsignedSendPacketEscrowTxInput) => TxBuilder;
    invalidArgument: (message: string) => Error;
    internalError: (message: string) => Error;
};
export declare function buildUnsignedSendPacketTx(sendPacketOperator: SendPacketOperator, deps: SendPacketBuildDependencies): Promise<SendPacketBuildResult>;
