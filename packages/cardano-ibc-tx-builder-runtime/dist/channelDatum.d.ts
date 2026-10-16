type LucidModule = typeof import('@lucid-evolution/lucid');
export type HeightValue = {
    revisionNumber: bigint;
    revisionHeight: bigint;
};
export type UpgradeFieldsValue = {
    ordering: string;
    connection_hops: string[];
    version: string;
};
export type UpgradeValue = {
    fields: UpgradeFieldsValue;
    timeout: {
        height: HeightValue;
        timestamp: bigint;
    };
    next_sequence_send: bigint;
};
export type ErrorReceiptValue = {
    sequence: bigint;
    message: string;
};
export type PendingUpgradeValue = {
    upgrade: UpgradeValue;
    timeout_period: bigint;
    counterparty_upgrade: UpgradeValue | null;
    flushed_lanes: bigint;
};
export type ChannelUpgradeStateValue = {
    pending: PendingUpgradeValue | null;
    error_receipt: ErrorReceiptValue | null;
    recv_start_sequence: bigint;
};
/** Constructor order of the Aiken `ChannelState`. */
export declare const CHANNEL_STATES: readonly ["Uninitialized", "Init", "TryOpen", "Open", "Close", "Flushing", "FlushComplete"];
/** Constructor order of the Aiken `Order`. */
export declare const CHANNEL_ORDERS: readonly ["None", "Unordered", "Ordered"];
/** A channel starts without an upgrade. */
export declare function initialChannelUpgradeState(): ChannelUpgradeStateValue;
export declare function channelSchemas(Lucid: LucidModule): {
    Channel: import("@lucid-evolution/lucid").TObject<{
        state: import("@lucid-evolution/lucid").TUnion<import("@lucid-evolution/lucid").TSchema[]>;
        ordering: import("@lucid-evolution/lucid").TUnion<import("@lucid-evolution/lucid").TSchema[]>;
        counterparty: import("@lucid-evolution/lucid").TObject<{
            port_id: import("@lucid-evolution/lucid").TUnsafe<string>;
            channel_id: import("@lucid-evolution/lucid").TUnsafe<string>;
        }>;
        connection_hops: import("@lucid-evolution/lucid").TArray<import("@lucid-evolution/lucid").TUnsafe<string>>;
        version: import("@lucid-evolution/lucid").TUnsafe<string>;
        upgrade_sequence: import("@lucid-evolution/lucid").TUnsafe<bigint>;
    }>;
    Upgrade: import("@lucid-evolution/lucid").TObject<{
        fields: import("@lucid-evolution/lucid").TObject<{
            ordering: import("@lucid-evolution/lucid").TUnion<import("@lucid-evolution/lucid").TSchema[]>;
            connection_hops: import("@lucid-evolution/lucid").TArray<import("@lucid-evolution/lucid").TUnsafe<string>>;
            version: import("@lucid-evolution/lucid").TUnsafe<string>;
        }>;
        timeout: import("@lucid-evolution/lucid").TObject<{
            height: import("@lucid-evolution/lucid").TObject<{
                revisionNumber: import("@lucid-evolution/lucid").TUnsafe<bigint>;
                revisionHeight: import("@lucid-evolution/lucid").TUnsafe<bigint>;
            }>;
            timestamp: import("@lucid-evolution/lucid").TUnsafe<bigint>;
        }>;
        next_sequence_send: import("@lucid-evolution/lucid").TUnsafe<bigint>;
    }>;
    ErrorReceipt: import("@lucid-evolution/lucid").TObject<{
        sequence: import("@lucid-evolution/lucid").TUnsafe<bigint>;
        message: import("@lucid-evolution/lucid").TUnsafe<string>;
    }>;
    UpgradeState: import("@lucid-evolution/lucid").TObject<{
        pending: import("@lucid-evolution/lucid").TUnsafe<{
            upgrade: {
                fields: {
                    ordering: unknown;
                    connection_hops: string[];
                    version: string;
                };
                timeout: {
                    height: {
                        revisionNumber: bigint;
                        revisionHeight: bigint;
                    };
                    timestamp: bigint;
                };
                next_sequence_send: bigint;
            };
            timeout_period: bigint;
            counterparty_upgrade: {
                fields: {
                    ordering: unknown;
                    connection_hops: string[];
                    version: string;
                };
                timeout: {
                    height: {
                        revisionNumber: bigint;
                        revisionHeight: bigint;
                    };
                    timestamp: bigint;
                };
                next_sequence_send: bigint;
            } | null;
            flushed_lanes: bigint;
        } | null>;
        error_receipt: import("@lucid-evolution/lucid").TUnsafe<{
            sequence: bigint;
            message: string;
        } | null>;
        recv_start_sequence: import("@lucid-evolution/lucid").TUnsafe<bigint>;
    }>;
    Datum: import("@lucid-evolution/lucid").TObject<{
        state: import("@lucid-evolution/lucid").TObject<{
            channel: import("@lucid-evolution/lucid").TObject<{
                state: import("@lucid-evolution/lucid").TUnion<import("@lucid-evolution/lucid").TSchema[]>;
                ordering: import("@lucid-evolution/lucid").TUnion<import("@lucid-evolution/lucid").TSchema[]>;
                counterparty: import("@lucid-evolution/lucid").TObject<{
                    port_id: import("@lucid-evolution/lucid").TUnsafe<string>;
                    channel_id: import("@lucid-evolution/lucid").TUnsafe<string>;
                }>;
                connection_hops: import("@lucid-evolution/lucid").TArray<import("@lucid-evolution/lucid").TUnsafe<string>>;
                version: import("@lucid-evolution/lucid").TUnsafe<string>;
                upgrade_sequence: import("@lucid-evolution/lucid").TUnsafe<bigint>;
            }>;
            next_sequence_send: import("@lucid-evolution/lucid").TUnsafe<bigint>;
            next_sequence_recv: import("@lucid-evolution/lucid").TUnsafe<bigint>;
            next_sequence_ack: import("@lucid-evolution/lucid").TUnsafe<bigint>;
            packet_commitment: import("@lucid-evolution/lucid").TUnsafe<Map<bigint, string>>;
            packet_receipt: import("@lucid-evolution/lucid").TUnsafe<Map<bigint, string>>;
            packet_acknowledgement: import("@lucid-evolution/lucid").TUnsafe<Map<bigint, string>>;
            minimum_receive_proof_height: import("@lucid-evolution/lucid").TObject<{
                revisionNumber: import("@lucid-evolution/lucid").TUnsafe<bigint>;
                revisionHeight: import("@lucid-evolution/lucid").TUnsafe<bigint>;
            }>;
            maximum_receive_proof_height: import("@lucid-evolution/lucid").TObject<{
                revisionNumber: import("@lucid-evolution/lucid").TUnsafe<bigint>;
                revisionHeight: import("@lucid-evolution/lucid").TUnsafe<bigint>;
            }>;
            upgrade: import("@lucid-evolution/lucid").TObject<{
                pending: import("@lucid-evolution/lucid").TUnsafe<{
                    upgrade: {
                        fields: {
                            ordering: unknown;
                            connection_hops: string[];
                            version: string;
                        };
                        timeout: {
                            height: {
                                revisionNumber: bigint;
                                revisionHeight: bigint;
                            };
                            timestamp: bigint;
                        };
                        next_sequence_send: bigint;
                    };
                    timeout_period: bigint;
                    counterparty_upgrade: {
                        fields: {
                            ordering: unknown;
                            connection_hops: string[];
                            version: string;
                        };
                        timeout: {
                            height: {
                                revisionNumber: bigint;
                                revisionHeight: bigint;
                            };
                            timestamp: bigint;
                        };
                        next_sequence_send: bigint;
                    } | null;
                    flushed_lanes: bigint;
                } | null>;
                error_receipt: import("@lucid-evolution/lucid").TUnsafe<{
                    sequence: bigint;
                    message: string;
                } | null>;
                recv_start_sequence: import("@lucid-evolution/lucid").TUnsafe<bigint>;
            }>;
        }>;
        port: import("@lucid-evolution/lucid").TUnsafe<string>;
        token: import("@lucid-evolution/lucid").TObject<{
            policyId: import("@lucid-evolution/lucid").TUnsafe<string>;
            name: import("@lucid-evolution/lucid").TUnsafe<string>;
        }>;
    }>;
};
export declare function decodeChannelDatum<T = any>(encoded: string, Lucid: LucidModule): Promise<T>;
export declare function encodeChannelDatum(channelDatum: any, Lucid: LucidModule): Promise<string>;
export {};
