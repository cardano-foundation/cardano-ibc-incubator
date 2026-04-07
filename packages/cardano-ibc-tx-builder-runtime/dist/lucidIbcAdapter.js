"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LucidIbcAdapter = void 0;
const lucid_1 = require("@lucid-evolution/lucid");
const js_sha3_1 = require("js-sha3");
const CHANNEL_TOKEN_PREFIX = 'channel';
const CLIENT_PREFIX = 'client';
const CONNECTION_TOKEN_PREFIX = 'connection';
function updateTransferModuleAssets(assets, transferAmount, denom) {
    const updatedAssets = {
        ...assets,
        [denom]: (assets[denom] ?? 0n) + transferAmount,
    };
    for (const [assetUnit, amount] of Object.entries(updatedAssets)) {
        if (amount === 0n) {
            delete updatedAssets[assetUnit];
        }
    }
    return updatedAssets;
}
function encodeAuthToken(token, Lucid) {
    const { Data } = Lucid;
    const AuthTokenSchema = Data.Object({
        policyId: Data.Bytes(),
        name: Data.Bytes(),
    });
    return Data.to(token, AuthTokenSchema, { canonical: true });
}
async function encodeHostStateDatum(hostStateDatum, Lucid) {
    const { Data } = Lucid;
    const HostStateStateSchema = Data.Object({
        version: Data.Integer(),
        ibc_state_root: Data.Bytes(),
        next_client_sequence: Data.Integer(),
        next_connection_sequence: Data.Integer(),
        next_channel_sequence: Data.Integer(),
        bound_port: Data.Array(Data.Integer()),
        last_update_time: Data.Integer(),
    });
    const HostStateDatumSchema = Data.Object({
        state: HostStateStateSchema,
        nft_policy: Data.Bytes(),
    });
    return Data.to(hostStateDatum, HostStateDatumSchema, { canonical: true });
}
async function decodeHostStateDatum(encoded, Lucid) {
    const { Data } = Lucid;
    const HostStateStateSchema = Data.Object({
        version: Data.Integer(),
        ibc_state_root: Data.Bytes(),
        next_client_sequence: Data.Integer(),
        next_connection_sequence: Data.Integer(),
        next_channel_sequence: Data.Integer(),
        bound_port: Data.Array(Data.Integer()),
        last_update_time: Data.Integer(),
    });
    const HostStateDatumSchema = Data.Object({
        state: HostStateStateSchema,
        nft_policy: Data.Bytes(),
    });
    return Data.from(encoded, HostStateDatumSchema);
}
async function decodeClientDatum(encoded, Lucid) {
    const { Data } = Lucid;
    const RationalSchema = Data.Object({
        numerator: Data.Integer(),
        denominator: Data.Integer(),
    });
    const HeightSchema = Data.Object({
        revisionNumber: Data.Integer(),
        revisionHeight: Data.Integer(),
    });
    const LeafOpSchema = Data.Object({
        hash: Data.Integer(),
        prehash_key: Data.Integer(),
        prehash_value: Data.Integer(),
        length: Data.Integer(),
        prefix: Data.Bytes(),
    });
    const InnerSpecSchema = Data.Object({
        child_order: Data.Array(Data.Integer()),
        child_size: Data.Integer(),
        min_prefix_length: Data.Integer(),
        max_prefix_length: Data.Integer(),
        empty_child: Data.Bytes(),
        hash: Data.Integer(),
    });
    const ProofSpecSchema = Data.Object({
        leaf_spec: LeafOpSchema,
        inner_spec: InnerSpecSchema,
        max_depth: Data.Integer(),
        min_depth: Data.Integer(),
        prehash_key_before_comparison: Data.Boolean(),
    });
    const ClientStateSchema = Data.Object({
        chainId: Data.Bytes(),
        trustLevel: RationalSchema,
        trustingPeriod: Data.Integer(),
        unbondingPeriod: Data.Integer(),
        maxClockDrift: Data.Integer(),
        frozenHeight: HeightSchema,
        latestHeight: HeightSchema,
        proofSpecs: Data.Array(ProofSpecSchema),
    });
    const MerkleRootSchema = Data.Object({
        hash: Data.Bytes(),
    });
    const ConsensusStateSchema = Data.Object({
        timestamp: Data.Integer(),
        next_validators_hash: Data.Bytes(),
        root: MerkleRootSchema,
    });
    const AuthTokenSchema = Data.Object({
        policyId: Data.Bytes(),
        name: Data.Bytes(),
    });
    const ClientDatumStateSchema = Data.Object({
        clientState: ClientStateSchema,
        consensusStates: Data.Map(HeightSchema, ConsensusStateSchema),
    });
    const ClientDatumSchema = Data.Object({
        state: ClientDatumStateSchema,
        token: AuthTokenSchema,
    });
    return Data.from(encoded, ClientDatumSchema);
}
async function decodeConnectionDatum(encoded, Lucid) {
    const { Data } = Lucid;
    const VersionSchema = Data.Object({
        identifier: Data.Bytes(),
        features: Data.Array(Data.Bytes()),
    });
    const StateSchema = Data.Enum([
        Data.Literal('Uninitialized'),
        Data.Literal('Init'),
        Data.Literal('TryOpen'),
        Data.Literal('Open'),
    ]);
    const MerklePrefixSchema = Data.Object({
        key_prefix: Data.Bytes(),
    });
    const CounterpartySchema = Data.Object({
        client_id: Data.Bytes(),
        connection_id: Data.Bytes(),
        prefix: MerklePrefixSchema,
    });
    const ConnectionEndSchema = Data.Object({
        client_id: Data.Bytes(),
        versions: Data.Array(VersionSchema),
        state: StateSchema,
        counterparty: CounterpartySchema,
        delay_period: Data.Integer(),
    });
    const AuthTokenSchema = Data.Object({
        policyId: Data.Bytes(),
        name: Data.Bytes(),
    });
    const ConnectionDatumSchema = Data.Object({
        state: ConnectionEndSchema,
        token: AuthTokenSchema,
    });
    return Data.from(encoded, ConnectionDatumSchema);
}
async function decodeChannelDatum(encoded, Lucid) {
    const { Data } = Lucid;
    const StateSchema = Data.Enum([
        Data.Literal('Uninitialized'),
        Data.Literal('Init'),
        Data.Literal('TryOpen'),
        Data.Literal('Open'),
        Data.Literal('Close'),
    ]);
    const OrderSchema = Data.Enum([
        Data.Literal('None'),
        Data.Literal('Unordered'),
        Data.Literal('Ordered'),
    ]);
    const ChannelCounterpartySchema = Data.Object({
        port_id: Data.Bytes(),
        channel_id: Data.Bytes(),
    });
    const ChannelSchema = Data.Object({
        state: StateSchema,
        ordering: OrderSchema,
        counterparty: ChannelCounterpartySchema,
        connection_hops: Data.Array(Data.Bytes()),
        version: Data.Bytes(),
    });
    const ChannelDatumStateSchema = Data.Object({
        channel: ChannelSchema,
        next_sequence_send: Data.Integer(),
        next_sequence_recv: Data.Integer(),
        next_sequence_ack: Data.Integer(),
        packet_commitment: Data.Map(Data.Integer(), Data.Bytes()),
        packet_receipt: Data.Map(Data.Integer(), Data.Bytes()),
        packet_acknowledgement: Data.Map(Data.Integer(), Data.Bytes()),
    });
    const AuthTokenSchema = Data.Object({
        policyId: Data.Bytes(),
        name: Data.Bytes(),
    });
    const ChannelDatumSchema = Data.Object({
        state: ChannelDatumStateSchema,
        port: Data.Bytes(),
        token: AuthTokenSchema,
    });
    return Data.from(encoded, ChannelDatumSchema);
}
async function encodeHostStateRedeemer(data, Lucid) {
    const { Data } = Lucid;
    const SiblingHashesSchema = Data.Array(Data.Bytes());
    const SiblingHashesListSchema = Data.Array(SiblingHashesSchema);
    const CreateClientSchema = Data.Object({
        client_state_siblings: SiblingHashesSchema,
        consensus_state_siblings: SiblingHashesSchema,
    });
    const CreateConnectionSchema = Data.Object({
        connection_siblings: SiblingHashesSchema,
    });
    const CreateChannelSchema = Data.Object({
        channel_siblings: SiblingHashesSchema,
        next_sequence_send_siblings: SiblingHashesSchema,
        next_sequence_recv_siblings: SiblingHashesSchema,
        next_sequence_ack_siblings: SiblingHashesSchema,
    });
    const UpdateChannelSchema = Data.Object({
        channel_siblings: SiblingHashesSchema,
    });
    const UpdateClientSchema = Data.Object({
        client_state_siblings: SiblingHashesSchema,
        consensus_state_siblings: SiblingHashesSchema,
        removed_consensus_state_siblings: SiblingHashesListSchema,
    });
    const HandlePacketSchema = Data.Object({
        channel_siblings: SiblingHashesSchema,
        next_sequence_send_siblings: SiblingHashesSchema,
        next_sequence_recv_siblings: SiblingHashesSchema,
        next_sequence_ack_siblings: SiblingHashesSchema,
        packet_commitment_siblings: SiblingHashesSchema,
        packet_receipt_siblings: SiblingHashesSchema,
        packet_acknowledgement_siblings: SiblingHashesSchema,
    });
    const HostStateRedeemerSchema = Data.Enum([
        Data.Object({ CreateClient: CreateClientSchema }),
        Data.Object({ CreateConnection: CreateConnectionSchema }),
        Data.Object({ CreateChannel: CreateChannelSchema }),
        Data.Object({
            BindPort: Data.Object({
                port: Data.Integer(),
                port_siblings: SiblingHashesSchema,
            }),
        }),
        Data.Object({ UpdateClient: UpdateClientSchema }),
        Data.Object({ UpdateConnection: CreateConnectionSchema }),
        Data.Object({ UpdateChannel: UpdateChannelSchema }),
        Data.Object({ HandlePacket: HandlePacketSchema }),
    ]);
    return Data.to(data, HostStateRedeemerSchema, { canonical: true });
}
async function encodeSpendChannelRedeemer(data, Lucid) {
    const { Data } = Lucid;
    const HeightSchema = Data.Object({
        revisionNumber: Data.Integer(),
        revisionHeight: Data.Integer(),
    });
    const ProofSchema = Data.Object({
        proofs: Data.Array(Data.Object({
            proof: Data.Enum([
                Data.Object({
                    CommitmentProofExist: Data.Object({
                        exists: Data.Object({
                            key: Data.Bytes(),
                            value: Data.Bytes(),
                            leaf: Data.Object({
                                hash: Data.Integer(),
                                prehash_key: Data.Integer(),
                                prehash_value: Data.Integer(),
                                length: Data.Integer(),
                                prefix: Data.Bytes(),
                            }),
                            path: Data.Array(Data.Object({
                                hash: Data.Integer(),
                                prefix: Data.Bytes(),
                                suffix: Data.Bytes(),
                            })),
                        }),
                    }),
                }),
                Data.Object({
                    CommitmentProofNonExist: Data.Object({
                        non_exist: Data.Object({
                            key: Data.Bytes(),
                            left: Data.Nullable(Data.Object({
                                key: Data.Bytes(),
                                value: Data.Bytes(),
                                leaf: Data.Object({
                                    hash: Data.Integer(),
                                    prehash_key: Data.Integer(),
                                    prehash_value: Data.Integer(),
                                    length: Data.Integer(),
                                    prefix: Data.Bytes(),
                                }),
                                path: Data.Array(Data.Object({
                                    hash: Data.Integer(),
                                    prefix: Data.Bytes(),
                                    suffix: Data.Bytes(),
                                })),
                            })),
                            right: Data.Nullable(Data.Object({
                                key: Data.Bytes(),
                                value: Data.Bytes(),
                                leaf: Data.Object({
                                    hash: Data.Integer(),
                                    prehash_key: Data.Integer(),
                                    prehash_value: Data.Integer(),
                                    length: Data.Integer(),
                                    prefix: Data.Bytes(),
                                }),
                                path: Data.Array(Data.Object({
                                    hash: Data.Integer(),
                                    prefix: Data.Bytes(),
                                    suffix: Data.Bytes(),
                                })),
                            })),
                        }),
                    }),
                }),
            ]),
        })),
    });
    const PacketSchema = Data.Object({
        sequence: Data.Integer(),
        source_port: Data.Bytes(),
        source_channel: Data.Bytes(),
        destination_port: Data.Bytes(),
        destination_channel: Data.Bytes(),
        data: Data.Bytes(),
        timeout_height: HeightSchema,
        timeout_timestamp: Data.Integer(),
    });
    const SpendChannelRedeemerSchema = Data.Enum([
        Data.Object({
            ChanOpenAck: Data.Object({
                counterparty_version: Data.Bytes(),
                proof_try: ProofSchema,
                proof_height: HeightSchema,
            }),
        }),
        Data.Object({
            ChanOpenConfirm: Data.Object({
                proof_ack: ProofSchema,
                proof_height: HeightSchema,
            }),
        }),
        Data.Object({
            RecvPacket: Data.Object({
                packet: PacketSchema,
                proof_commitment: ProofSchema,
                proof_height: HeightSchema,
            }),
        }),
        Data.Object({
            TimeoutPacket: Data.Object({
                packet: PacketSchema,
                proof_unreceived: ProofSchema,
                proof_height: HeightSchema,
                next_sequence_recv: Data.Integer(),
            }),
        }),
        Data.Object({
            AcknowledgePacket: Data.Object({
                packet: PacketSchema,
                acknowledgement: Data.Bytes(),
                proof_acked: ProofSchema,
                proof_height: HeightSchema,
            }),
        }),
        Data.Object({
            SendPacket: Data.Object({
                packet: PacketSchema,
            }),
        }),
        Data.Literal('ChanCloseInit'),
        Data.Object({
            ChanCloseConfirm: Data.Object({
                proof_init: ProofSchema,
                proof_height: HeightSchema,
            }),
        }),
        Data.Literal('RefreshUtxo'),
    ]);
    return Data.to(data, SpendChannelRedeemerSchema, { canonical: true });
}
async function encodeIbcModuleRedeemer(data, Lucid) {
    const { Data } = Lucid;
    const FungibleTokenPacketDatumSchema = Data.Object({
        denom: Data.Bytes(),
        amount: Data.Bytes(),
        sender: Data.Bytes(),
        receiver: Data.Bytes(),
        memo: Data.Bytes(),
    });
    const AcknowledgementResponseSchema = Data.Enum([
        Data.Object({
            AcknowledgementResult: Data.Object({
                result: Data.Bytes(),
            }),
        }),
        Data.Object({
            AcknowledgementError: Data.Object({
                err: Data.Bytes(),
            }),
        }),
    ]);
    const AcknowledgementSchema = Data.Object({
        response: AcknowledgementResponseSchema,
    });
    const IBCModulePacketData = Data.Enum([
        Data.Object({
            TransferModuleData: Data.Tuple([FungibleTokenPacketDatumSchema]),
        }),
        Data.Literal('OtherModuleData'),
    ]);
    const IBCModuleCallbackSchema = Data.Enum([
        Data.Object({ OnChanOpenInit: Data.Object({ channel_id: Data.Bytes() }) }),
        Data.Object({ OnChanOpenTry: Data.Object({ channel_id: Data.Bytes() }) }),
        Data.Object({ OnChanOpenAck: Data.Object({ channel_id: Data.Bytes() }) }),
        Data.Object({ OnChanOpenConfirm: Data.Object({ channel_id: Data.Bytes() }) }),
        Data.Object({ OnChanCloseInit: Data.Object({ channel_id: Data.Bytes() }) }),
        Data.Object({ OnChanCloseConfirm: Data.Object({ channel_id: Data.Bytes() }) }),
        Data.Object({
            OnRecvPacket: Data.Object({
                channel_id: Data.Bytes(),
                acknowledgement: AcknowledgementSchema,
                data: IBCModulePacketData,
            }),
        }),
        Data.Object({
            OnTimeoutPacket: Data.Object({
                channel_id: Data.Bytes(),
                data: IBCModulePacketData,
            }),
        }),
        Data.Object({
            OnAcknowledgementPacket: Data.Object({
                channel_id: Data.Bytes(),
                acknowledgement: AcknowledgementSchema,
                data: IBCModulePacketData,
            }),
        }),
    ]);
    const TransferModuleRedeemerSchema = Data.Enum([
        Data.Object({
            Transfer: Data.Object({
                channel_id: Data.Bytes(),
                data: FungibleTokenPacketDatumSchema,
            }),
        }),
        Data.Literal('OtherTransferOp'),
    ]);
    const IBCModuleOperatorSchema = Data.Enum([
        Data.Object({
            TransferModuleOperator: Data.Tuple([TransferModuleRedeemerSchema]),
        }),
        Data.Literal('OtherModuleOperator'),
    ]);
    const IBCModuleRedeemerSchema = Data.Enum([
        Data.Object({
            Callback: Data.Tuple([IBCModuleCallbackSchema]),
        }),
        Data.Object({
            Operator: Data.Tuple([IBCModuleOperatorSchema]),
        }),
    ]);
    return Data.to(data, IBCModuleRedeemerSchema, { canonical: true });
}
function encodeMintVoucherRedeemer(data, Lucid) {
    const { Data } = Lucid;
    const MintVoucherRedeemerSchema = Data.Enum([
        Data.Object({
            MintVoucher: Data.Object({
                packet_source_port: Data.Bytes(),
                packet_source_channel: Data.Bytes(),
                packet_dest_port: Data.Bytes(),
                packet_dest_channel: Data.Bytes(),
            }),
        }),
        Data.Object({
            BurnVoucher: Data.Object({
                packet_source_port: Data.Bytes(),
                packet_source_channel: Data.Bytes(),
            }),
        }),
        Data.Object({
            RefundVoucher: Data.Object({
                packet_source_port: Data.Bytes(),
                packet_source_channel: Data.Bytes(),
            }),
        }),
    ]);
    return Data.to(data, MintVoucherRedeemerSchema, { canonical: true });
}
class LucidIbcAdapter {
    lucid;
    deployment;
    LucidImporter;
    referenceScripts;
    walletSelectionScopeCounter = 0;
    activeWalletSelectionScopeId = null;
    explicitWalletSelectionForScopeId = null;
    explicitWalletSelectionAddress = null;
    constructor(LucidImporter, lucid, deployment) {
        this.lucid = lucid;
        this.deployment = deployment;
        this.LucidImporter = LucidImporter;
    }
    async onModuleInit() {
        this.referenceScripts = await this.loadReferenceScripts();
    }
    async loadReferenceScripts() {
        const outRefs = {
            spendChannel: this.deployment.validators.spendChannel.refUtxo,
            spendTransferModule: this.deployment.validators.spendTransferModule.refUtxo,
            sendPacket: this.deployment.validators.spendChannel.refValidator.send_packet.refUtxo,
            hostStateStt: this.deployment.validators.hostStateStt.refUtxo,
            mintVoucher: this.deployment.validators.mintVoucher.refUtxo,
        };
        const entries = await Promise.all(Object.entries(outRefs).map(async ([label, outRef]) => {
            const utxo = await this.resolveReferenceScriptUtxo(label, outRef);
            return [label, utxo];
        }));
        return Object.fromEntries(entries);
    }
    async resolveReferenceScriptUtxo(label, outRef) {
        for (let attempt = 1; attempt <= 30; attempt += 1) {
            const utxos = await this.lucid.utxosByOutRef([outRef]);
            const utxo = utxos.find((candidate) => candidate.txHash === outRef.txHash &&
                candidate.outputIndex === outRef.outputIndex);
            if (utxo?.address) {
                return utxo;
            }
            if (attempt < 30) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
        throw new Error(`Unable to resolve reference script UTxO "${String(label)}" at ${outRef.txHash}#${outRef.outputIndex}`);
    }
    normalizeAddressOrCredential(addressOrCredential) {
        const normalized = addressOrCredential?.trim();
        if (!normalized) {
            return normalized;
        }
        const lowered = normalized.toLowerCase();
        if (lowered.startsWith('addr') || lowered.startsWith('stake')) {
            return normalized;
        }
        const isHex = /^[0-9a-f]+$/.test(lowered);
        if (!isHex) {
            return normalized;
        }
        if (lowered.length === 58) {
            const paymentHash = lowered.slice(2);
            if (/^[0-9a-f]{56}$/.test(paymentHash)) {
                return this.credentialToAddress(paymentHash);
            }
        }
        if (lowered.length === 56) {
            return this.credentialToAddress(lowered);
        }
        return normalized;
    }
    selectWalletFromAddress(addressOrCredential, utxos) {
        const normalizedAddress = this.normalizeAddressOrCredential(addressOrCredential);
        this.lucid.selectWallet.fromAddress(normalizedAddress, utxos);
        if (this.activeWalletSelectionScopeId !== null) {
            this.explicitWalletSelectionForScopeId = this.activeWalletSelectionScopeId;
            this.explicitWalletSelectionAddress = normalizedAddress;
        }
    }
    beginWalletSelectionScope() {
        const scopeId = ++this.walletSelectionScopeCounter;
        this.activeWalletSelectionScopeId = scopeId;
        this.explicitWalletSelectionForScopeId = null;
        this.explicitWalletSelectionAddress = null;
        return scopeId;
    }
    assertWalletSelectionScopeSatisfied(scopeId, operationName) {
        if (this.activeWalletSelectionScopeId !== scopeId ||
            this.explicitWalletSelectionForScopeId !== scopeId ||
            !this.explicitWalletSelectionAddress) {
            throw new Error(`${operationName} failed: no explicit address-backed wallet context was selected before complete()`);
        }
    }
    endWalletSelectionScope(scopeId) {
        if (this.activeWalletSelectionScopeId !== scopeId) {
            return;
        }
        this.activeWalletSelectionScopeId = null;
        this.explicitWalletSelectionForScopeId = null;
        this.explicitWalletSelectionAddress = null;
    }
    async findUtxoAt(addressOrCredential) {
        const normalizedAddress = this.normalizeAddressOrCredential(addressOrCredential);
        const utxos = await this.lucid.utxosAt(normalizedAddress);
        if (utxos.length === 0) {
            throw new Error(`Unable to find UTxO at ${addressOrCredential}`);
        }
        return utxos;
    }
    async findUtxoAtWithUnit(addressOrCredential, unit) {
        const normalizedAddress = this.normalizeAddressOrCredential(addressOrCredential);
        const utxos = await this.lucid.utxosAtWithUnit(normalizedAddress, unit);
        if (utxos.length === 0) {
            throw new Error(`Unable to find UTxO with unit ${unit}`);
        }
        return utxos[utxos.length - 1];
    }
    async findUtxoByUnit(unit) {
        for (let attempt = 1; attempt <= 10; attempt += 1) {
            const utxo = await this.lucid.utxoByUnit(unit);
            if (utxo) {
                try {
                    const liveUtxos = await this.lucid.utxosByOutRef([
                        { txHash: utxo.txHash, outputIndex: utxo.outputIndex },
                    ]);
                    if (liveUtxos.length > 0) {
                        return liveUtxos[0];
                    }
                }
                catch {
                    // keep retrying
                }
            }
            if (attempt < 10) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
        throw new Error(`Unable to find UTxO with unit ${unit}`);
    }
    async filterLiveUtxos(utxos) {
        if (utxos.length === 0) {
            return [];
        }
        const outRefs = utxos.map((utxo) => ({
            txHash: utxo.txHash,
            outputIndex: utxo.outputIndex,
        }));
        const liveUtxos = await this.lucid.utxosByOutRef(outRefs);
        if (liveUtxos.length === 0) {
            return [];
        }
        const liveRefs = new Set(liveUtxos.map((utxo) => `${utxo.txHash}#${utxo.outputIndex}`));
        return utxos.filter((utxo) => liveRefs.has(`${utxo.txHash}#${utxo.outputIndex}`));
    }
    async tryFindUtxosAt(addressOrCredential, opts) {
        const normalizedAddress = this.normalizeAddressOrCredential(addressOrCredential);
        const maxAttempts = Math.max(1, opts?.maxAttempts ?? 5);
        const retryDelayMs = Math.max(0, opts?.retryDelayMs ?? 750);
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                const utxos = await this.lucid.utxosAt(normalizedAddress);
                if (utxos.length > 0) {
                    const liveUtxos = await this.filterLiveUtxos(utxos);
                    if (liveUtxos.length > 0) {
                        return liveUtxos;
                    }
                }
            }
            catch {
                // swallow transient errors for best-effort wallet lookup
            }
            if (attempt < maxAttempts && retryDelayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            }
        }
        return [];
    }
    async findUtxoAtHostStateNFT() {
        const address = this.deployment.validators.hostStateStt.address ?? '';
        const hostStateNFT = this.deployment.hostStateNFT.policyId + this.deployment.hostStateNFT.name;
        const utxos = await this.lucid.utxosAt(address);
        const hostStateUtxo = utxos.find((utxo) => Object.prototype.hasOwnProperty.call(utxo.assets, hostStateNFT));
        if (!hostStateUtxo) {
            throw new Error(`Unable to find HostState UTXO with NFT ${hostStateNFT}`);
        }
        return hostStateUtxo;
    }
    credentialToAddress(address) {
        const normalized = address?.trim();
        if (!normalized) {
            return normalized;
        }
        const network = this.lucid.config().network;
        if (!network) {
            throw new Error('Lucid network is not configured');
        }
        const lowered = normalized.toLowerCase();
        if (lowered.startsWith('addr') || lowered.startsWith('stake')) {
            return normalized;
        }
        if (/^[0-9a-f]+$/.test(lowered) && lowered.length === 58) {
            const paymentHash = lowered.slice(2);
            if (/^[0-9a-f]{56}$/.test(paymentHash)) {
                return (0, lucid_1.credentialToAddress)(network, {
                    hash: paymentHash,
                    type: 'Key',
                });
            }
        }
        return (0, lucid_1.credentialToAddress)(network, {
            hash: lowered,
            type: 'Key',
        });
    }
    async decodeDatum(encodedDatum, type) {
        switch (type) {
            case 'client':
                return (await decodeClientDatum(encodedDatum, this.LucidImporter));
            case 'connection':
                return (await decodeConnectionDatum(encodedDatum, this.LucidImporter));
            case 'channel':
                return (await decodeChannelDatum(encodedDatum, this.LucidImporter));
            case 'host_state':
                return (await decodeHostStateDatum(encodedDatum, this.LucidImporter));
            default:
                throw new Error(`Unknown datum type: ${type}`);
        }
    }
    async encode(data, type) {
        switch (type) {
            case 'host_state':
                return encodeHostStateDatum(data, this.LucidImporter);
            case 'host_state_redeemer':
                return encodeHostStateRedeemer(data, this.LucidImporter);
            case 'spendChannelRedeemer':
                return encodeSpendChannelRedeemer(data, this.LucidImporter);
            case 'iBCModuleRedeemer':
                return encodeIbcModuleRedeemer(data, this.LucidImporter);
            case 'mintVoucherRedeemer':
                return encodeMintVoucherRedeemer(data, this.LucidImporter);
            default:
                throw new Error(`Unknown datum type: ${type}`);
        }
    }
    getClientTokenUnit(clientId) {
        const mintClientPolicyId = this.deployment.validators.mintClientStt.scriptHash;
        const clientTokenName = this.generateTokenName(this.deployment.hostStateNFT, CLIENT_PREFIX, BigInt(clientId));
        return mintClientPolicyId + clientTokenName;
    }
    getConnectionTokenUnit(connectionId) {
        const mintConnectionPolicyId = this.deployment.validators.mintConnectionStt.scriptHash;
        const connectionTokenName = this.generateTokenName(this.deployment.hostStateNFT, CONNECTION_TOKEN_PREFIX, connectionId);
        return [mintConnectionPolicyId, connectionTokenName];
    }
    getChannelTokenUnit(channelId) {
        const mintChannelPolicyId = this.deployment.validators.mintChannelStt.scriptHash;
        const channelTokenName = this.generateTokenName(this.deployment.hostStateNFT, CHANNEL_TOKEN_PREFIX, channelId);
        return [mintChannelPolicyId, channelTokenName];
    }
    createUnsignedSendPacketEscrowTx(dto) {
        const hostStateAddress = this.deployment.validators.hostStateStt.address;
        if (!hostStateAddress) {
            throw new Error('Host state script address is missing from deployment config');
        }
        const hostStateNFT = this.deployment.hostStateNFT.policyId + this.deployment.hostStateNFT.name;
        const hostStateUtxoWithRawDatum = {
            ...dto.hostStateUtxo,
            datum: dto.hostStateUtxo.datum,
            datumHash: undefined,
        };
        if (!dto.walletUtxos || dto.walletUtxos.length === 0) {
            throw new Error('Sender wallet UTxOs are required for escrow send packet');
        }
        const tx = this.lucid.newTx();
        tx.readFrom([
            this.referenceScripts.spendChannel,
            this.referenceScripts.spendTransferModule,
            this.referenceScripts.sendPacket,
            this.referenceScripts.hostStateStt,
        ])
            .collectFrom([hostStateUtxoWithRawDatum], dto.encodedHostStateRedeemer)
            .collectFrom([dto.channelUTxO], dto.encodedSpendChannelRedeemer)
            .collectFrom([dto.transferModuleUTxO], dto.encodedSpendTransferModuleRedeemer)
            .readFrom([dto.connectionUTxO, dto.clientUTxO])
            .pay.ToContract(hostStateAddress, { kind: 'inline', value: dto.encodedUpdatedHostStateDatum }, { [hostStateNFT]: 1n })
            .pay.ToContract(dto.spendChannelAddress, { kind: 'inline', value: dto.encodedUpdatedChannelDatum }, { [dto.channelTokenUnit]: 1n })
            .pay.ToContract(dto.transferModuleAddress, undefined, updateTransferModuleAssets(dto.transferModuleUTxO.assets, dto.transferAmount, dto.denomToken))
            .mintAssets({ [dto.sendPacketPolicyId]: 1n }, encodeAuthToken(dto.channelToken, this.LucidImporter));
        return tx;
    }
    createUnsignedSendPacketBurnTx(dto) {
        const hostStateAddress = this.deployment.validators.hostStateStt.address;
        const spendChannelAddress = this.deployment.validators.spendChannel.address;
        const transferModuleAddress = this.deployment.modules.transfer.address;
        if (!hostStateAddress) {
            throw new Error('Host state script address is missing from deployment config');
        }
        if (!spendChannelAddress) {
            throw new Error('Spend channel script address is missing from deployment config');
        }
        if (!transferModuleAddress) {
            throw new Error('Transfer module address is missing from deployment config');
        }
        const hostStateNFT = this.deployment.hostStateNFT.policyId + this.deployment.hostStateNFT.name;
        const hostStateUtxoWithRawDatum = {
            ...dto.hostStateUtxo,
            datum: dto.hostStateUtxo.datum,
            datumHash: undefined,
        };
        const tx = this.lucid.newTx();
        tx.readFrom([
            this.referenceScripts.spendChannel,
            this.referenceScripts.spendTransferModule,
            this.referenceScripts.mintVoucher,
            this.referenceScripts.sendPacket,
            this.referenceScripts.hostStateStt,
        ])
            .collectFrom([hostStateUtxoWithRawDatum], dto.encodedHostStateRedeemer)
            .collectFrom([dto.channelUTxO], dto.encodedSpendChannelRedeemer)
            .collectFrom([dto.transferModuleUTxO], dto.encodedSpendTransferModuleRedeemer)
            .collectFrom([dto.senderVoucherTokenUtxo])
            .readFrom([dto.connectionUTxO, dto.clientUTxO])
            .mintAssets({ [dto.voucherTokenUnit]: -BigInt(dto.transferAmount) }, dto.encodedMintVoucherRedeemer)
            .pay.ToContract(hostStateAddress, { kind: 'inline', value: dto.encodedUpdatedHostStateDatum }, { [hostStateNFT]: 1n })
            .pay.ToContract(spendChannelAddress, { kind: 'inline', value: dto.encodedUpdatedChannelDatum }, { [dto.channelTokenUnit]: 1n })
            .pay.ToContract(transferModuleAddress, undefined, { ...dto.transferModuleUTxO.assets })
            .mintAssets({ [dto.sendPacketPolicyId]: 1n }, encodeAuthToken(dto.channelToken, this.LucidImporter));
        return tx;
    }
    generateTokenName(baseToken, prefix, postfix) {
        if (postfix < 0) {
            throw new Error('sequence must be unsigned integer');
        }
        const postfixHex = Buffer.from(postfix.toString()).toString('hex');
        if (postfixHex.length > 16) {
            throw new Error('postfix size > 8 bytes');
        }
        const baseTokenPart = (0, js_sha3_1.sha3_256)(baseToken.policyId + baseToken.name).slice(0, 40);
        const prefixPart = (0, js_sha3_1.sha3_256)(prefix).slice(0, 8);
        return `${baseTokenPart}${prefixPart}${postfixHex}`;
    }
}
exports.LucidIbcAdapter = LucidIbcAdapter;
