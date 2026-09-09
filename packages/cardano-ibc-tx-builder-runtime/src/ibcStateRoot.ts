import type { UTxO } from '@lucid-evolution/lucid';
import { sha3_256 } from 'js-sha3';
import { ICS23MerkleTree } from './ics23MerkleTree';

export type IbcTreeDeployment = Readonly<{
  network: string;
  hostStateNFT: Readonly<{ policyId: string; name: string }>;
  consensusStateHistory?: Readonly<{
    address: string;
    policyId: string;
  }>;
}>;

export type IbcTreeUtxo = Pick<UTxO, 'datum' | 'assets' | 'txHash' | 'outputIndex'> &
  Partial<Pick<UTxO, 'address'>>;

export type IbcTreeHostStateRef = Readonly<Pick<UTxO, 'txHash' | 'outputIndex'>>;

export type IbcTreeSnapshot = Readonly<{
  root: string;
  hostState: IbcTreeHostStateRef;
  tree: ICS23MerkleTree;
}>;

export type IbcTreeStateSnapshot = IbcTreeSnapshot & Readonly<{ version: number }>;

export type IbcTreeCommitResult = {
  published: boolean;
  snapshot: IbcTreeSnapshot;
};

export class StaleIbcTreeStateError extends Error {
  constructor(message = 'IBC tree state changed while the operation was in progress') {
    super(message);
    this.name = 'StaleIbcTreeStateError';
  }
}

export interface IbcTreeKupoService {
  queryAllClientUtxos(): Promise<IbcTreeUtxo[]>;
  queryAllConsensusStateUtxos?(): Promise<IbcTreeUtxo[]>;
  queryAllConnectionUtxos(): Promise<IbcTreeUtxo[]>;
  queryAllChannelUtxos(): Promise<IbcTreeUtxo[]>;
}

export interface IbcTreeLucidService {
  readonly LucidImporter: typeof import('@lucid-evolution/lucid');
  findUtxoAtHostStateNFT(): Promise<IbcTreeUtxo | undefined>;
  decodeDatum<T>(
    encodedDatum: string,
    type: 'host_state' | 'client' | 'consensus_state' | 'connection' | 'channel',
  ): Promise<T>;
}

type HostStateDatumLike = {
  state: { ibc_state_root: string };
  control: { port_registry?: Map<string, unknown> };
};

type ConsensusHeight = string | number | bigint | { revisionHeight?: bigint | number };
type ClientDatumLike = {
  state: {
    clientState: unknown;
    consensusStates?: Map<ConsensusHeight, unknown> | Record<string, unknown>;
  };
  token?: AuthTokenLike;
};

type AuthTokenLike = { policyId: string; name: string };
type HeightLike = { revisionNumber: bigint; revisionHeight: bigint };
type ConsensusStateDatumLike = {
  clientToken: AuthTokenLike;
  height: HeightLike;
  consensusState: unknown;
  processedTime: bigint;
  processedHeight: bigint;
};

type ConnectionDatumLike = { state: unknown };

type ChannelStateLike = {
  channel: any;
  next_sequence_send: bigint;
  next_sequence_recv: bigint;
  next_sequence_ack: bigint;
  packet_commitment: Map<bigint, string>;
  packet_receipt: Map<bigint, string>;
  packet_acknowledgement: Map<bigint, string>;
  minimum_receive_proof_height: {
    revisionNumber: bigint;
    revisionHeight: bigint;
  };
  maximum_receive_proof_height: {
    revisionNumber: bigint;
    revisionHeight: bigint;
  };
};

type ChannelDatumLike = {
  state: ChannelStateLike;
  port: string;
};

export function consensusStateArchiveTokenName(
  clientToken: AuthTokenLike,
  height: HeightLike,
  Lucid: typeof import('@lucid-evolution/lucid'),
): string {
  const { Data } = Lucid;
  const keySchema = Data.Object({
    clientToken: Data.Object({ policyId: Data.Bytes(), name: Data.Bytes() }),
    height: Data.Object({ revisionNumber: Data.Integer(), revisionHeight: Data.Integer() }),
  });
  const encodedKey = Data.to({ clientToken, height } as never, keySchema as never, {
    canonical: false,
  });
  return sha3_256(Buffer.from(encodedKey, 'hex'));
}

function normalizeHex(value: string): string {
  return value.toLowerCase();
}

function utxoLabel(utxo: IbcTreeUtxo): string {
  return `${utxo.txHash}#${utxo.outputIndex}`;
}

export type StateRootResult = {
  newRoot: string;
  commit: (hostState: IbcTreeHostStateRef) => Promise<IbcTreeCommitResult>;
};

export type HandlePacketStateRootResult = StateRootResult & {
  channelSiblings: string[];
  nextSequenceSendSiblings: string[];
  nextSequenceRecvSiblings: string[];
  nextSequenceAckSiblings: string[];
  packetCommitmentSiblings: string[];
  packetReceiptSiblings: string[];
  packetAcknowledgementSiblings: string[];
};

export interface CreateClientStateRootResult extends StateRootResult {
  clientStateSiblings: string[];
  consensusStateSiblings: string[];
}

export interface CreateConnectionStateRootResult extends StateRootResult {
  connectionSiblings: string[];
}

export interface CreateChannelStateRootResult extends StateRootResult {
  channelSiblings: string[];
  nextSequenceSendSiblings: string[];
  nextSequenceRecvSiblings: string[];
  nextSequenceAckSiblings: string[];
}

export interface BindPortStateRootResult extends StateRootResult {
  portSiblings: string[];
}

export interface UpdateChannelStateRootResult extends StateRootResult {
  channelSiblings: string[];
}

export interface UpdateClientStateRootResult extends StateRootResult {
  clientStateSiblings: string[];
  consensusStateSiblings: string[];
  removedConsensusStateSiblings: string[][];
}

export interface PrunePacketHistoryStateRootResult extends StateRootResult {
  packetReceiptSiblings: string[];
  packetAcknowledgementSiblings: string[];
}

export interface PruneConsensusStateRootResult extends StateRootResult {
  consensusStateSiblings: string[];
}

export async function encodeClientStateValue(
  clientState: any,
  Lucid: typeof import('@lucid-evolution/lucid'),
): Promise<string> {
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

  // Match Aiken cbor.serialise, including indefinite-length arrays.
  // Canonical CBOR would change the committed value bytes.
  return Data.to(clientState, ClientStateSchema as any);
}

export async function encodeConsensusStateValue(
  consensusState: any,
  Lucid: typeof import('@lucid-evolution/lucid'),
): Promise<string> {
  const { Data } = Lucid;
  const MerkleRootSchema = Data.Object({
    hash: Data.Bytes(),
  });
  const ConsensusStateSchema = Data.Object({
    timestamp: Data.Integer(),
    next_validators_hash: Data.Bytes(),
    root: MerkleRootSchema,
  });

  return Data.to(consensusState, ConsensusStateSchema as any);
}

export async function encodeConnectionEndValue(
  connectionEnd: any,
  Lucid: typeof import('@lucid-evolution/lucid'),
): Promise<string> {
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

  return Data.to(connectionEnd, ConnectionEndSchema as any);
}

export async function encodeChannelEndValue(
  channelEnd: any,
  Lucid: typeof import('@lucid-evolution/lucid'),
): Promise<string> {
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

  return Data.to(channelEnd, ChannelSchema as any);
}

export async function encodeModuleRegistration(
  registration: any,
  Lucid: typeof import('@lucid-evolution/lucid'),
): Promise<string> {
  const { Data } = Lucid;
  const AuthTokenSchema = Data.Object({
    policy_id: Data.Bytes(),
    name: Data.Bytes(),
  });
  const ModuleRegistrationSchema = Data.Object({
    module_script_hash: Data.Bytes(),
    port_token: AuthTokenSchema,
    module_token: AuthTokenSchema,
  });
  return Data.to(registration as never, ModuleRegistrationSchema as never);
}

/**
 * One deployment's working tree and the readers used to rebuild it.
 * Computations use clones and only replace this store's tree when committed.
 */
export class IbcTreeStateStore {
  readonly deployment: IbcTreeDeployment;
  private currentTree = new ICS23MerkleTree();
  private version = 0;
  private hostState: IbcTreeHostStateRef | null = null;

  constructor(
    deployment: IbcTreeDeployment,
    private readonly kupoService: IbcTreeKupoService,
    private readonly lucidService: IbcTreeLucidService,
  ) {
    this.deployment = Object.freeze({
      network: deployment.network,
      hostStateNFT: Object.freeze({
        policyId: deployment.hostStateNFT.policyId,
        name: deployment.hostStateNFT.name,
      }),
      ...(deployment.consensusStateHistory
        ? {
            consensusStateHistory: Object.freeze({
              address: deployment.consensusStateHistory.address,
              policyId: deployment.consensusStateHistory.policyId,
            }),
          }
        : {}),
    });
  }

  isTreeAligned(onChainRoot: string, hostState?: IbcTreeHostStateRef): boolean {
    return this.hostState !== null && this.currentTree.getRoot() === onChainRoot &&
      (hostState === undefined || this.sameHostState(this.hostState, hostState));
  }

  async alignTreeWithChain(): Promise<{ root: string }> {
    const result = await this.rebuildTreeFromChain();
    return { root: result.root };
  }

  private getClonedTreeFromRoot(rootHash: string): ICS23MerkleTree {
    const currentRoot = this.currentTree.getRoot();
    if (currentRoot === rootHash) {
      return this.currentTree.clone();
    }

    throw new StaleIbcTreeStateError(
      `Tree out of sync with on-chain state. Expected root ${rootHash.substring(0, 16)}..., but in-memory root is ${currentRoot.substring(0, 16)}...`,
    );
  }

  private sameHostState(left: IbcTreeHostStateRef, right: IbcTreeHostStateRef): boolean {
    return left.txHash === right.txHash && left.outputIndex === right.outputIndex;
  }

  private copyHostState(hostState: IbcTreeHostStateRef): IbcTreeHostStateRef {
    if (!/^[0-9a-f]{64}$/.test(hostState.txHash) ||
      !Number.isSafeInteger(hostState.outputIndex) || hostState.outputIndex < 0) {
      throw new Error('HostState reference must contain a canonical transaction hash and output index');
    }
    return Object.freeze({ txHash: hostState.txHash, outputIndex: hostState.outputIndex });
  }

  private snapshot(tree: ICS23MerkleTree, hostState: IbcTreeHostStateRef): IbcTreeSnapshot {
    return Object.freeze({ root: tree.getRoot(), hostState: this.copyHostState(hostState), tree: tree.clone() });
  }

  private async readLiveHostState(): Promise<{
    root: string;
    hostState: IbcTreeHostStateRef;
    datum: HostStateDatumLike;
  }> {
    const utxo = await this.lucidService.findUtxoAtHostStateNFT();
    if (!utxo?.datum) throw new Error('HostState UTXO has no datum');
    const hostState = this.copyHostState(utxo);
    const datum = await this.lucidService.decodeDatum<HostStateDatumLike>(utxo.datum, 'host_state');
    const root = datum.state.ibc_state_root;
    if (!/^[0-9a-f]{64}$/.test(root)) throw new Error('HostState root must be 32 lowercase hexadecimal bytes');
    return { root, hostState, datum };
  }

  private assertUnchanged(
    version: number,
    initial: { root: string; hostState: IbcTreeHostStateRef },
    live: { root: string; hostState: IbcTreeHostStateRef },
  ): void {
    if (this.version !== version || initial.root !== live.root || !this.sameHostState(initial.hostState, live.hostState)) {
      throw new StaleIbcTreeStateError();
    }
  }

  private publish(tree: ICS23MerkleTree, hostState: IbcTreeHostStateRef): void {
    this.currentTree = tree.clone();
    this.hostState = this.copyHostState(hostState);
    this.version += 1;
  }

  private preparePublication(tree: ICS23MerkleTree, version: number): StateRootResult {
    // Detach from caller-owned input buffers before returning a commit callback.
    const preparedTree = tree.clone();
    const newRoot = preparedTree.getRoot();
    return {
      newRoot,
      commit: async (hostState) => {
        const snapshot = this.snapshot(preparedTree, hostState);
        if (this.version !== version) return { published: false, snapshot };
        const live = await this.readLiveHostState();
        if (this.version !== version || live.root !== newRoot || !this.sameHostState(live.hostState, snapshot.hostState)) {
          return { published: false, snapshot };
        }
        // No await between the generation/live-state checks and publication.
        this.publish(preparedTree, snapshot.hostState);
        return { published: true, snapshot };
      },
    };
  }

  getSnapshot(): IbcTreeStateSnapshot {
    if (!this.hostState) throw new Error('IBC tree store has no bound HostState snapshot');
    return Object.freeze({ ...this.snapshot(this.currentTree, this.hostState), version: this.version });
  }

  async getAlignedSnapshot(): Promise<IbcTreeStateSnapshot> {
    const version = this.version;
    const live = await this.readLiveHostState();
    if (this.version !== version) throw new StaleIbcTreeStateError();
    if (this.isTreeAligned(live.root, live.hostState)) return this.getSnapshot();
    return this.rebuildTreeFromChain();
  }

  async restoreTreeFromCache(tree: ICS23MerkleTree): Promise<IbcTreeStateSnapshot> {
    const version = this.version;
    const candidate = tree.clone();
    const initial = await this.readLiveHostState();
    const live = await this.readLiveHostState();
    this.assertUnchanged(version, initial, live);
    if (candidate.getRoot() !== live.root) throw new Error('Cached tree root does not match the live HostState');
    this.publish(candidate, live.hostState);
    return this.getSnapshot();
  }

  computeRootWithHeartbeatUpdate(oldRoot: string): StateRootResult {
    const version = this.version;
    return this.preparePublication(this.getClonedTreeFromRoot(oldRoot), version);
  }

  async computeRootWithHandlePacketUpdate(
    oldRoot: string,
    portId: string,
    channelId: string,
    inputChannelDatum: ChannelDatumLike,
    outputChannelDatum: ChannelDatumLike,
    Lucid: typeof import('@lucid-evolution/lucid'),
  ): Promise<HandlePacketStateRootResult> {
    const version = this.version;
    const speculativeTree = this.getClonedTreeFromRoot(oldRoot);
    const { Data } = Lucid;
    const encodePacketStoreValue = (bytesHex: string): Buffer =>
      Buffer.from(Data.to(bytesHex, Data.Bytes() as any) as any, 'hex');

    const channelPath = `channelEnds/ports/${portId}/channels/${channelId}`;
    let channelSiblings: string[] = [];
    const inputChannelValue = await encodeChannelEndValue(inputChannelDatum.state.channel, Lucid);
    const outputChannelValue = await encodeChannelEndValue(outputChannelDatum.state.channel, Lucid);
    if (inputChannelValue !== outputChannelValue) {
      const newChannelValue = Buffer.from(outputChannelValue, 'hex');
      channelSiblings = speculativeTree.getSiblings(channelPath).map((h) => h.toString('hex'));
      speculativeTree.set(channelPath, newChannelValue);
    }

    const nextSequenceSendPath = `nextSequenceSend/ports/${portId}/channels/${channelId}`;
    let nextSequenceSendSiblings: string[] = [];
    if (inputChannelDatum.state.next_sequence_send !== outputChannelDatum.state.next_sequence_send) {
      const newValue = Buffer.from(
        Data.to(outputChannelDatum.state.next_sequence_send as any, Data.Integer() as any),
        'hex',
      );
      nextSequenceSendSiblings = speculativeTree.getSiblings(nextSequenceSendPath).map((h) => h.toString('hex'));
      speculativeTree.set(nextSequenceSendPath, newValue);
    }

    const nextSequenceRecvPath = `nextSequenceRecv/ports/${portId}/channels/${channelId}`;
    let nextSequenceRecvSiblings: string[] = [];
    if (inputChannelDatum.state.next_sequence_recv !== outputChannelDatum.state.next_sequence_recv) {
      const newValue = Buffer.from(
        Data.to(outputChannelDatum.state.next_sequence_recv as any, Data.Integer() as any),
        'hex',
      );
      nextSequenceRecvSiblings = speculativeTree.getSiblings(nextSequenceRecvPath).map((h) => h.toString('hex'));
      speculativeTree.set(nextSequenceRecvPath, newValue);
    }

    const nextSequenceAckPath = `nextSequenceAck/ports/${portId}/channels/${channelId}`;
    let nextSequenceAckSiblings: string[] = [];
    if (inputChannelDatum.state.next_sequence_ack !== outputChannelDatum.state.next_sequence_ack) {
      const newValue = Buffer.from(
        Data.to(outputChannelDatum.state.next_sequence_ack as any, Data.Integer() as any),
        'hex',
      );
      nextSequenceAckSiblings = speculativeTree.getSiblings(nextSequenceAckPath).map((h) => h.toString('hex'));
      speculativeTree.set(nextSequenceAckPath, newValue);
    }

    const inputCommitments = Array.from(inputChannelDatum.state.packet_commitment.entries());
    const outputCommitments = Array.from(outputChannelDatum.state.packet_commitment.entries());
    const insertedCommitments = outputCommitments.filter(([seq]) => !inputChannelDatum.state.packet_commitment.has(seq));
    const removedCommitments = inputCommitments.filter(([seq]) => !outputChannelDatum.state.packet_commitment.has(seq));

    let packetCommitmentSiblings: string[] = [];
    if (insertedCommitments.length > 0) {
      if (removedCommitments.length !== 0 || insertedCommitments.length !== 1) {
        throw new Error(
          `HandlePacket root update expects exactly one commitment insertion and no deletions; got ${insertedCommitments.length} insertions and ${removedCommitments.length} deletions`,
        );
      }
      const [sequence, commitmentBytes] = insertedCommitments[0];
      const key = `commitments/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
      packetCommitmentSiblings = speculativeTree.getSiblings(key).map((h) => h.toString('hex'));
      speculativeTree.set(key, encodePacketStoreValue(commitmentBytes));
    } else if (removedCommitments.length > 0) {
      if (removedCommitments.length !== 1) {
        throw new Error(
          `HandlePacket root update expects exactly one commitment deletion; got ${removedCommitments.length}`,
        );
      }
      const [sequence] = removedCommitments[0];
      const key = `commitments/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
      packetCommitmentSiblings = speculativeTree.getSiblings(key).map((h) => h.toString('hex'));
      speculativeTree.set(key, Buffer.alloc(0));
    }

    const inputReceipts = Array.from(inputChannelDatum.state.packet_receipt.entries());
    const outputReceipts = Array.from(outputChannelDatum.state.packet_receipt.entries());
    const insertedReceipts = outputReceipts.filter(([seq]) => !inputChannelDatum.state.packet_receipt.has(seq));
    const removedReceipts = inputReceipts.filter(([seq]) => !outputChannelDatum.state.packet_receipt.has(seq));

    let packetReceiptSiblings: string[] = [];
    if (insertedReceipts.length > 0) {
      if (removedReceipts.length !== 0 || insertedReceipts.length !== 1) {
        throw new Error(
          `HandlePacket root update expects receipts to only ever insert a single entry; got ${insertedReceipts.length} insertions and ${removedReceipts.length} deletions`,
        );
      }
      const [sequence, receiptBytes] = insertedReceipts[0];
      const key = `receipts/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
      packetReceiptSiblings = speculativeTree.getSiblings(key).map((h) => h.toString('hex'));
      speculativeTree.set(key, encodePacketStoreValue(receiptBytes));
    } else if (removedReceipts.length > 0) {
      throw new Error('HandlePacket root update does not allow receipt deletions');
    }

    const inputAcks = Array.from(inputChannelDatum.state.packet_acknowledgement.entries());
    const outputAcks = Array.from(outputChannelDatum.state.packet_acknowledgement.entries());
    const insertedAcks = outputAcks.filter(([seq]) => !inputChannelDatum.state.packet_acknowledgement.has(seq));
    const removedAcks = inputAcks.filter(([seq]) => !outputChannelDatum.state.packet_acknowledgement.has(seq));

    let packetAcknowledgementSiblings: string[] = [];
    if (insertedAcks.length > 0) {
      if (removedAcks.length !== 0 || insertedAcks.length !== 1) {
        throw new Error(
          `HandlePacket root update expects acknowledgements to only ever insert a single entry; got ${insertedAcks.length} insertions and ${removedAcks.length} deletions`,
        );
      }
      const [sequence, ackBytes] = insertedAcks[0];
      const key = `acks/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
      packetAcknowledgementSiblings = speculativeTree.getSiblings(key).map((h) => h.toString('hex'));
      speculativeTree.set(key, encodePacketStoreValue(ackBytes));
    } else if (removedAcks.length > 0) {
      throw new Error('HandlePacket root update does not allow acknowledgement deletions');
    }

    return {
      ...this.preparePublication(speculativeTree, version),
      channelSiblings,
      nextSequenceSendSiblings,
      nextSequenceRecvSiblings,
      nextSequenceAckSiblings,
      packetCommitmentSiblings,
      packetReceiptSiblings,
      packetAcknowledgementSiblings,
    };
  }

  async rebuildTreeFromChain(): Promise<IbcTreeStateSnapshot> {
    const version = this.version;
    const { kupoService, lucidService } = this;
    const initial = await this.readLiveHostState();
    const hostStateDatum = initial.datum;
    const expectedRoot = initial.root;
    const tree = new ICS23MerkleTree();

    const boundPorts = hostStateDatum.control.port_registry ?? new Map();
    if (boundPorts.size > 0) {
      for (const [portIdHex, registration] of boundPorts.entries()) {
        // Datum keys are hex-encoded UTF-8 and must be decoded before rebuilding textual paths.
        const portId = Buffer.from(portIdHex, 'hex').toString('utf8');
        const portValue = Buffer.from(
          await encodeModuleRegistration(registration, lucidService.LucidImporter),
          'hex',
        );
        tree.set(`ports/${portId}`, portValue);
      }
    }

    const clientIdsByTokenUnit = new Map<string, string>();
    const consensusPaths = new Set<string>();
    const clientUtxos = await kupoService.queryAllClientUtxos();
    for (const clientUtxo of clientUtxos) {
      if (!clientUtxo.datum) {
        continue;
      }

      const clientDatum = await lucidService.decodeDatum<ClientDatumLike>(clientUtxo.datum, 'client');
      const clientUnit = Object.keys(clientUtxo.assets || {}).find((unit) =>
        unit !== 'lovelace' &&
        (!this.deployment.consensusStateHistory ||
          normalizeHex(unit).startsWith(normalizeHex(this.deployment.consensusStateHistory.policyId))),
      );
      if (!clientUnit || clientUnit.length < 56 + 48 + 2) {
        continue;
      }

      if (this.deployment.consensusStateHistory) {
        const expectedPolicy = normalizeHex(this.deployment.consensusStateHistory.policyId);
        const clientPolicyUnits = Object.keys(clientUtxo.assets || {}).filter(
          (unit) => unit !== 'lovelace' && normalizeHex(unit).startsWith(expectedPolicy),
        );
        const datumUnit = clientDatum.token
          ? normalizeHex(clientDatum.token.policyId + clientDatum.token.name)
          : undefined;
        if (
          clientPolicyUnits.length !== 1 ||
          clientUtxo.assets[clientUnit] !== 1n ||
          !datumUnit ||
          datumUnit !== normalizeHex(clientUnit)
        ) {
          throw new Error(`Client UTxO ${utxoLabel(clientUtxo)} failed authentication during tree rebuild`);
        }
      }

      const tokenName = clientUnit.slice(56);
      const postfixHex = tokenName.slice(48);
      const clientSequenceText = Buffer.from(postfixHex, 'hex').toString('utf8');
      if (!/^\d+$/.test(clientSequenceText)) {
        if (this.deployment.consensusStateHistory) {
          throw new Error(`Client UTxO ${utxoLabel(clientUtxo)} has an invalid sequence token`);
        }
        continue;
      }
      const clientSequence = BigInt(clientSequenceText);
      const clientId = `07-tendermint-${clientSequence.toString()}`;
      const normalizedClientUnit = normalizeHex(clientUnit);
      if (clientIdsByTokenUnit.has(normalizedClientUnit)) {
        throw new Error(`Duplicate client authentication token ${clientUnit} during tree rebuild`);
      }
      clientIdsByTokenUnit.set(normalizedClientUnit, clientId);

      const clientStateValue = Buffer.from(
        await encodeClientStateValue(clientDatum.state.clientState, lucidService.LucidImporter),
        'hex',
      );
      tree.set(`clients/${clientId}/clientState`, clientStateValue);

      const consensusStates = clientDatum.state.consensusStates;
      const entries = consensusStates instanceof Map
        ? Array.from(consensusStates.entries())
        : Object.entries(consensusStates ?? {});

      for (const [heightKey, consensusState] of entries) {
        const heightStr = typeof heightKey === 'object' && heightKey !== null
          ? `${(heightKey as { revisionHeight?: bigint | number }).revisionHeight || 0}`
          : String(heightKey);
        const consensusPath = `clients/${clientId}/consensusStates/${heightStr}`;
        if (consensusPaths.has(consensusPath)) {
          throw new Error(`Duplicate consensus state path '${consensusPath}' during tree rebuild`);
        }
        const consensusValue = Buffer.from(
          await encodeConsensusStateValue(consensusState, lucidService.LucidImporter),
          'hex',
        );
        tree.set(consensusPath, consensusValue);
        consensusPaths.add(consensusPath);
      }
    }

    const consensusStateHistory = this.deployment.consensusStateHistory;
    if (consensusStateHistory) {
      if (!kupoService.queryAllConsensusStateUtxos) {
        throw new Error('Consensus-state history is configured but its chain reader is unavailable');
      }
      const archiveUtxos = await kupoService.queryAllConsensusStateUtxos();
      for (const archiveUtxo of archiveUtxos) {
        if (
          !archiveUtxo.address ||
          normalizeHex(archiveUtxo.address) !== normalizeHex(consensusStateHistory.address)
        ) {
          throw new Error(`Consensus-state archive ${utxoLabel(archiveUtxo)} is at the wrong address`);
        }
        if (!archiveUtxo.datum) {
          throw new Error(`Consensus-state archive ${utxoLabel(archiveUtxo)} is missing its inline datum`);
        }

        let archive: ConsensusStateDatumLike;
        try {
          archive = await lucidService.decodeDatum<ConsensusStateDatumLike>(
            archiveUtxo.datum,
            'consensus_state',
          );
        } catch (error) {
          throw new Error(
            `Consensus-state archive ${utxoLabel(archiveUtxo)} has an invalid datum: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        const expectedPolicy = normalizeHex(consensusStateHistory.policyId);
        const clientPolicy = normalizeHex(archive.clientToken?.policyId ?? '');
        const clientTokenUnit = normalizeHex(
          `${archive.clientToken?.policyId ?? ''}${archive.clientToken?.name ?? ''}`,
        );
        const clientId = clientIdsByTokenUnit.get(clientTokenUnit);
        if (
          clientPolicy !== expectedPolicy ||
          !clientId ||
          typeof archive.height?.revisionNumber !== 'bigint' ||
          typeof archive.height?.revisionHeight !== 'bigint' ||
          archive.height.revisionNumber < 0n ||
          archive.height.revisionHeight <= 0n ||
          typeof archive.processedTime !== 'bigint' ||
          typeof archive.processedHeight !== 'bigint' ||
          archive.processedTime < 0n ||
          archive.processedHeight < 0n
        ) {
          throw new Error(`Consensus-state archive ${utxoLabel(archiveUtxo)} failed authentication`);
        }

        const tokenName = consensusStateArchiveTokenName(
          archive.clientToken,
          archive.height,
          lucidService.LucidImporter,
        );
        const expectedUnit = expectedPolicy + normalizeHex(tokenName);
        const archivePolicyUnits = Object.keys(archiveUtxo.assets || {}).filter(
          (unit) => unit !== 'lovelace' && normalizeHex(unit).startsWith(expectedPolicy),
        );
        if (
          archivePolicyUnits.length !== 1 ||
          normalizeHex(archivePolicyUnits[0]) !== expectedUnit ||
          archiveUtxo.assets[archivePolicyUnits[0]] !== 1n
        ) {
          throw new Error(`Consensus-state archive ${utxoLabel(archiveUtxo)} has the wrong NFT`);
        }

        const consensusPath =
          `clients/${clientId}/consensusStates/${archive.height.revisionHeight.toString()}`;
        if (consensusPaths.has(consensusPath)) {
          throw new Error(`Duplicate consensus state path '${consensusPath}' during tree rebuild`);
        }
        const consensusValue = Buffer.from(
          await encodeConsensusStateValue(archive.consensusState, lucidService.LucidImporter),
          'hex',
        );
        tree.set(consensusPath, consensusValue);
        consensusPaths.add(consensusPath);
      }
    }

    const connectionUtxos = await kupoService.queryAllConnectionUtxos();
    for (const connectionUtxo of connectionUtxos) {
      if (!connectionUtxo.datum) {
        continue;
      }

      const connectionDatum = await lucidService.decodeDatum<ConnectionDatumLike>(connectionUtxo.datum, 'connection');
      const connectionUnit = Object.keys(connectionUtxo.assets || {}).find((unit) => unit !== 'lovelace');
      if (!connectionUnit || connectionUnit.length <= 56) {
        continue;
      }

      const tokenNameHex = connectionUnit.slice(56);
      if (tokenNameHex.length < 48 + 2) {
        continue;
      }

      const postfixHex = tokenNameHex.slice(48);
      const connectionSequenceStr = Buffer.from(postfixHex, 'hex').toString('utf8');
      if (!/^\d+$/.test(connectionSequenceStr)) {
        continue;
      }

      const connectionId = `connection-${connectionSequenceStr}`;
      const connectionValue = Buffer.from(
        await encodeConnectionEndValue(connectionDatum.state, lucidService.LucidImporter),
        'hex',
      );
      tree.set(`connections/${connectionId}`, connectionValue);
    }

    const channelUtxos = await kupoService.queryAllChannelUtxos();
    for (const channelUtxo of channelUtxos) {
      if (!channelUtxo.datum) {
        continue;
      }

      const channelDatum = await lucidService.decodeDatum<ChannelDatumLike>(channelUtxo.datum, 'channel');
      const channelUnit = Object.keys(channelUtxo.assets || {}).find((unit) => unit !== 'lovelace');
      if (!channelUnit || channelUnit.length <= 56) {
        continue;
      }

      const tokenNameHex = channelUnit.slice(56);
      if (tokenNameHex.length < 48 + 2) {
        continue;
      }

      const postfixHex = tokenNameHex.slice(48);
      const channelSequenceStr = Buffer.from(postfixHex, 'hex').toString('utf8');
      if (!/^\d+$/.test(channelSequenceStr)) {
        continue;
      }

      const channelId = `channel-${channelSequenceStr}`;
      const portHex = channelDatum.port;
      const portId = portHex ? Buffer.from(portHex, 'hex').toString('utf8') : 'transfer';
      const channelValue = Buffer.from(
        await encodeChannelEndValue(channelDatum.state.channel, lucidService.LucidImporter),
        'hex',
      );
      tree.set(`channelEnds/ports/${portId}/channels/${channelId}`, channelValue);

      const { Data } = lucidService.LucidImporter;
      tree.set(
        `nextSequenceSend/ports/${portId}/channels/${channelId}`,
        Buffer.from(Data.to(channelDatum.state.next_sequence_send as any, Data.Integer() as any), 'hex'),
      );
      tree.set(
        `nextSequenceRecv/ports/${portId}/channels/${channelId}`,
        Buffer.from(Data.to(channelDatum.state.next_sequence_recv as any, Data.Integer() as any), 'hex'),
      );
      tree.set(
        `nextSequenceAck/ports/${portId}/channels/${channelId}`,
        Buffer.from(Data.to(channelDatum.state.next_sequence_ack as any, Data.Integer() as any), 'hex'),
      );

      const bytesSchema = Data.Bytes() as any;
      for (const [sequence, bytesHex] of channelDatum.state.packet_commitment.entries()) {
        tree.set(
          `commitments/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`,
          Buffer.from(Data.to(bytesHex, bytesSchema) as any, 'hex'),
        );
      }
      for (const [sequence, bytesHex] of channelDatum.state.packet_receipt.entries()) {
        tree.set(
          `receipts/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`,
          Buffer.from(Data.to(bytesHex, bytesSchema) as any, 'hex'),
        );
      }
      for (const [sequence, bytesHex] of channelDatum.state.packet_acknowledgement.entries()) {
        tree.set(
          `acks/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`,
          Buffer.from(Data.to(bytesHex, bytesSchema) as any, 'hex'),
        );
      }
    }

    const computedRoot = tree.getRoot();
    const live = await this.readLiveHostState();
    this.assertUnchanged(version, initial, live);
    if (computedRoot !== expectedRoot) {
      throw new Error(
        `Tree rebuild failed: expected ${expectedRoot} but computed ${computedRoot}`,
      );
    }

    this.publish(tree, live.hostState);
    return this.getSnapshot();
  }

  computeRootWithCreateClientUpdate(
    oldRoot: string,
    clientId: string,
    clientStateValue: Buffer,
    consensusStateValue: Buffer,
    consensusHeight: string | number | bigint,
  ): CreateClientStateRootResult {
    const version = this.version;
    const speculativeTree = this.getClonedTreeFromRoot(oldRoot);

    const clientPath = `clients/${clientId}/clientState`;
    const clientStateSiblings = speculativeTree.getSiblings(clientPath).map((h) => h.toString('hex'));
    speculativeTree.set(clientPath, clientStateValue);

    const heightStr = String(consensusHeight);
    const consensusPath = `clients/${clientId}/consensusStates/${heightStr}`;
    const consensusStateSiblings = speculativeTree
      .getSiblings(consensusPath)
      .map((h) => h.toString('hex'));
    speculativeTree.set(consensusPath, consensusStateValue);

    return {
      ...this.preparePublication(speculativeTree, version),
      clientStateSiblings,
      consensusStateSiblings,
    };
  }

  computeRootWithUpdateClientUpdate(
    oldRoot: string,
    clientId: string,
    newClientStateValue: Buffer,
    removedConsensusHeights: Array<string | number | bigint>,
    addedConsensusState:
      | {
          height: string | number | bigint;
          value: Buffer;
        }
      | undefined,
  ): UpdateClientStateRootResult {
    if (removedConsensusHeights.length !== 0) {
      throw new Error('UpdateClient preserves consensus history; use explicit PruneConsensusState');
    }
    const version = this.version;
    const speculativeTree = this.getClonedTreeFromRoot(oldRoot);

    // 1) Client state update.
    const clientPath = `clients/${clientId}/clientState`;
    if (!speculativeTree.get(clientPath)) {
      throw new Error(
        `UpdateClient root update expects existing clientState at '${clientPath}', but it was not found in the tree`,
      );
    }
    const clientStateSiblings = speculativeTree.getSiblings(clientPath).map((h) => h.toString('hex'));
    speculativeTree.set(clientPath, newClientStateValue);

    // Archiving a tip changes its UTxO location, not its commitment leaf.
    const removedConsensusStateSiblings: string[][] = [];

    // 3) Optional consensus state insertion (exactly one for normal UpdateClient, none for misbehaviour).
    let consensusStateSiblings: string[] = [];
    if (addedConsensusState) {
      const heightStr = String(addedConsensusState.height);
      const consensusPath = `clients/${clientId}/consensusStates/${heightStr}`;

      // For an insertion, the old value must be absent at this point in the update sequence.
      if (speculativeTree.get(consensusPath)) {
        throw new Error(
          `UpdateClient root update expects no consensusState at '${consensusPath}' before insertion, but one already exists`,
        );
      }

      consensusStateSiblings = speculativeTree.getSiblings(consensusPath).map((h) => h.toString('hex'));
      speculativeTree.set(consensusPath, addedConsensusState.value);
    }

    return {
      ...this.preparePublication(speculativeTree, version),
      clientStateSiblings,
      consensusStateSiblings,
      removedConsensusStateSiblings,
    };
  }

  computeRootWithCreateConnectionUpdate(
    oldRoot: string,
    connectionId: string,
    connectionValue: Buffer,
  ): CreateConnectionStateRootResult {
    const version = this.version;
    const speculativeTree = this.getClonedTreeFromRoot(oldRoot);

    const path = `connections/${connectionId}`;
    const connectionSiblings = speculativeTree.getSiblings(path).map((h) => h.toString('hex'));
    speculativeTree.set(path, connectionValue);

    return {
      ...this.preparePublication(speculativeTree, version),
      connectionSiblings,
    };
  }

  computeRootWithCreateChannelUpdate(
    oldRoot: string,
    portId: string,
    channelId: string,
    channelValue: Buffer,
    nextSequenceSendValue: Buffer,
    nextSequenceRecvValue: Buffer,
    nextSequenceAckValue: Buffer,
  ): CreateChannelStateRootResult {
    const version = this.version;
    const speculativeTree = this.getClonedTreeFromRoot(oldRoot);

    const channelPath = `channelEnds/ports/${portId}/channels/${channelId}`;
    const channelSiblings = speculativeTree.getSiblings(channelPath).map((h) => h.toString('hex'));
    speculativeTree.set(channelPath, channelValue);

    const nextSequenceSendPath = `nextSequenceSend/ports/${portId}/channels/${channelId}`;
    const nextSequenceSendSiblings = speculativeTree
      .getSiblings(nextSequenceSendPath)
      .map((h) => h.toString('hex'));
    speculativeTree.set(nextSequenceSendPath, nextSequenceSendValue);

    const nextSequenceRecvPath = `nextSequenceRecv/ports/${portId}/channels/${channelId}`;
    const nextSequenceRecvSiblings = speculativeTree
      .getSiblings(nextSequenceRecvPath)
      .map((h) => h.toString('hex'));
    speculativeTree.set(nextSequenceRecvPath, nextSequenceRecvValue);

    const nextSequenceAckPath = `nextSequenceAck/ports/${portId}/channels/${channelId}`;
    const nextSequenceAckSiblings = speculativeTree.getSiblings(nextSequenceAckPath).map((h) => h.toString('hex'));
    speculativeTree.set(nextSequenceAckPath, nextSequenceAckValue);

    return {
      ...this.preparePublication(speculativeTree, version),
      channelSiblings,
      nextSequenceSendSiblings,
      nextSequenceRecvSiblings,
      nextSequenceAckSiblings,
    };
  }

  computeRootWithUpdateChannelUpdate(
    oldRoot: string,
    portId: string,
    channelId: string,
    channelValue: Buffer,
  ): UpdateChannelStateRootResult {
    const version = this.version;
    const speculativeTree = this.getClonedTreeFromRoot(oldRoot);

    const channelPath = `channelEnds/ports/${portId}/channels/${channelId}`;
    const channelSiblings = speculativeTree.getSiblings(channelPath).map((h) => h.toString('hex'));
    speculativeTree.set(channelPath, channelValue);

    return {
      ...this.preparePublication(speculativeTree, version),
      channelSiblings,
    };
  }

  computeRootWithPruneConsensusStateUpdate(
    oldRoot: string,
    clientId: string,
    height: string | number | bigint,
    expectedValue: Buffer,
  ): PruneConsensusStateRootResult {
    const version = this.version;
    const tree = this.getClonedTreeFromRoot(oldRoot);
    const path = `clients/${clientId}/consensusStates/${String(height)}`;
    const value = tree.get(path);
    if (!value || !value.equals(expectedValue)) {
      throw new Error(`PruneConsensusState expects the authenticated consensus state at '${path}'`);
    }
    const consensusStateSiblings = tree.getSiblings(path).map((hash) => hash.toString('hex'));
    tree.set(path, Buffer.alloc(0));
    return { ...this.preparePublication(tree, version), consensusStateSiblings };
  }

  computeRootWithPrunePacketHistoryUpdate(
    oldRoot: string,
    portId: string,
    channelId: string,
    sequence: bigint,
    ordering: 'None' | 'Unordered' | 'Ordered',
  ): PrunePacketHistoryStateRootResult {
    if (ordering !== 'Unordered' && ordering !== 'Ordered') {
      throw new Error(`PrunePacketHistory does not support channel ordering '${ordering}'`);
    }

    const version = this.version;
    const speculativeTree = this.getClonedTreeFromRoot(oldRoot);
    const sequenceText = sequence.toString();
    const receiptPath = `receipts/ports/${portId}/channels/${channelId}/sequences/${sequenceText}`;
    const acknowledgementPath = `acks/ports/${portId}/channels/${channelId}/sequences/${sequenceText}`;

    if (ordering === 'Unordered' && !speculativeTree.get(receiptPath)) {
      throw new Error(`PrunePacketHistory expects an existing receipt at '${receiptPath}'`);
    }
    if (!speculativeTree.get(acknowledgementPath)) {
      throw new Error(`PrunePacketHistory expects an existing acknowledgement at '${acknowledgementPath}'`);
    }

    let packetReceiptSiblings: string[] = [];
    if (ordering === 'Unordered') {
      packetReceiptSiblings = speculativeTree.getSiblings(receiptPath).map((hash) => hash.toString('hex'));
      speculativeTree.set(receiptPath, Buffer.alloc(0));
    }

    const packetAcknowledgementSiblings = speculativeTree
      .getSiblings(acknowledgementPath)
      .map((hash) => hash.toString('hex'));
    speculativeTree.set(acknowledgementPath, Buffer.alloc(0));

    return {
      ...this.preparePublication(speculativeTree, version),
      packetReceiptSiblings,
      packetAcknowledgementSiblings,
    };
  }

  computeRootWithPortBind(
    oldRoot: string,
    portId: string,
    portValue: Buffer,
  ): BindPortStateRootResult {
    const version = this.version;
    const speculativeTree = this.getClonedTreeFromRoot(oldRoot);

    // Exact case-sensitive port text becomes the commitment path without aliases or normalization.
    const path = `ports/${portId}`;

    // The on-chain validator replays this update using the per-level sibling hashes.
    const portSiblings = speculativeTree.getSiblings(path).map((h) => h.toString('hex'));
    speculativeTree.set(path, portValue);

    return {
      ...this.preparePublication(speculativeTree, version),
      portSiblings,
    };
  }

  getCurrentTree(): ICS23MerkleTree {
    return this.currentTree.clone();
  }

  getCurrentRoot(): string {
    return this.currentTree.getRoot();
  }

  resetTreeState(): void {
    this.currentTree = new ICS23MerkleTree();
    this.hostState = null;
    this.version += 1;
  }
}
