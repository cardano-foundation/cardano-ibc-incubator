import { ICS23MerkleTree } from './ics23MerkleTree';

type ChannelStateLike = {
  channel: any;
  next_sequence_send: bigint;
  next_sequence_recv: bigint;
  next_sequence_ack: bigint;
  packet_commitment: Map<bigint, string>;
  packet_receipt: Map<bigint, string>;
  packet_acknowledgement: Map<bigint, string>;
};

type ChannelDatumLike = {
  state: ChannelStateLike;
  port: string;
};

type StateRootResult = {
  newRoot: string;
  commit: () => void;
};

type HandlePacketStateRootResult = StateRootResult & {
  channelSiblings: string[];
  nextSequenceSendSiblings: string[];
  nextSequenceRecvSiblings: string[];
  nextSequenceAckSiblings: string[];
  packetCommitmentSiblings: string[];
  packetReceiptSiblings: string[];
  packetAcknowledgementSiblings: string[];
};

let currentTree: ICS23MerkleTree = new ICS23MerkleTree();
let cachedKupoService: any = null;
let cachedLucidService: any = null;

export function initTreeServices(kupoService: any, lucidService: any): void {
  cachedKupoService = kupoService;
  cachedLucidService = lucidService;
}

export function isTreeAligned(onChainRoot: string): boolean {
  if (onChainRoot === '0'.repeat(64)) {
    return currentTree.getRoot() === onChainRoot;
  }
  return currentTree.getRoot() === onChainRoot;
}

export async function alignTreeWithChain(): Promise<{ root: string }> {
  if (!cachedKupoService || !cachedLucidService) {
    throw new Error('Tree services not initialized. Call initTreeServices() first.');
  }

  const result = await rebuildTreeFromChain(cachedKupoService, cachedLucidService);
  return { root: result.root };
}

function getClonedTreeFromRoot(rootHash: string): ICS23MerkleTree {
  if (rootHash === '0'.repeat(64)) {
    return new ICS23MerkleTree();
  }

  const currentRoot = currentTree.getRoot();
  if (currentRoot === rootHash) {
    return currentTree.clone();
  }

  throw new Error(
    `Tree out of sync with on-chain state. Expected root ${rootHash.substring(0, 16)}..., but in-memory root is ${currentRoot.substring(0, 16)}...`,
  );
}

async function encodeClientStateValue(
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

  return Data.to(clientState, ClientStateSchema as any);
}

async function encodeConsensusStateValue(
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

async function encodeConnectionEndValue(
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

async function encodeChannelEndValue(
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

export async function computeRootWithHandlePacketUpdate(
  oldRoot: string,
  portId: string,
  channelId: string,
  inputChannelDatum: ChannelDatumLike,
  outputChannelDatum: ChannelDatumLike,
  Lucid: typeof import('@lucid-evolution/lucid'),
): Promise<HandlePacketStateRootResult> {
  const speculativeTree = getClonedTreeFromRoot(oldRoot);
  const { Data } = Lucid;
  const encodePacketStoreValue = (bytesHex: string): Buffer =>
    Buffer.from(Data.to(bytesHex, Data.Bytes() as any) as any, 'hex');

  const channelPath = `channelEnds/ports/${portId}/channels/${channelId}`;
  let channelSiblings: string[] = [];
  if (inputChannelDatum.state.channel !== outputChannelDatum.state.channel) {
    const newChannelValue = Buffer.from(
      await encodeChannelEndValue(outputChannelDatum.state.channel, Lucid),
      'hex',
    );
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

  const newRoot = speculativeTree.getRoot();
  return {
    newRoot,
    channelSiblings,
    nextSequenceSendSiblings,
    nextSequenceRecvSiblings,
    nextSequenceAckSiblings,
    packetCommitmentSiblings,
    packetReceiptSiblings,
    packetAcknowledgementSiblings,
    commit: () => {
      currentTree = speculativeTree;
    },
  };
}

export async function rebuildTreeFromChain(
  kupoService: any,
  lucidService: any,
): Promise<{ tree: ICS23MerkleTree; root: string }> {
  const hostStateUtxo = await lucidService.findUtxoAtHostStateNFT();
  if (!hostStateUtxo?.datum) {
    throw new Error('HostState UTXO has no datum');
  }

  const hostStateDatum = await lucidService.decodeDatum(hostStateUtxo.datum, 'host_state');
  const expectedRoot = hostStateDatum.state.ibc_state_root;
  const tree = new ICS23MerkleTree();

  const boundPorts = hostStateDatum.state.bound_port ?? [];
  if (boundPorts.length > 0) {
    const { Data } = lucidService.LucidImporter;
    for (const portNumber of boundPorts) {
      const portId = `port-${portNumber.toString()}`;
      const portValue = Buffer.from(Data.to(portNumber as any, Data.Integer() as any), 'hex');
      tree.set(`ports/${portId}`, portValue);
    }
  }

  const clientUtxos = await kupoService.queryAllClientUtxos();
  for (const clientUtxo of clientUtxos) {
    if (!clientUtxo.datum) {
      continue;
    }

    const clientDatum = await lucidService.decodeDatum(clientUtxo.datum, 'client');
    const clientUnit = Object.keys(clientUtxo.assets || {}).find((unit) => unit !== 'lovelace');
    if (!clientUnit || clientUnit.length < 56 + 48 + 2) {
      continue;
    }

    const tokenName = clientUnit.slice(56);
    const postfixHex = tokenName.slice(48);
    const clientSequence = BigInt(Buffer.from(postfixHex, 'hex').toString('utf8'));
    const clientId = `07-tendermint-${clientSequence.toString()}`;

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
      const consensusValue = Buffer.from(
        await encodeConsensusStateValue(consensusState, lucidService.LucidImporter),
        'hex',
      );
      tree.set(`clients/${clientId}/consensusStates/${heightStr}`, consensusValue);
    }
  }

  const connectionUtxos = await kupoService.queryAllConnectionUtxos();
  for (const connectionUtxo of connectionUtxos) {
    if (!connectionUtxo.datum) {
      continue;
    }

    const connectionDatum = await lucidService.decodeDatum(connectionUtxo.datum, 'connection');
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

    const channelDatum = await lucidService.decodeDatum(channelUtxo.datum, 'channel');
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
    const portHex = (channelDatum as any).port;
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
    for (const [sequence, bytesHex] of (channelDatum as any).state.packet_commitment.entries()) {
      tree.set(
        `commitments/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`,
        Buffer.from(Data.to(bytesHex, bytesSchema) as any, 'hex'),
      );
    }
    for (const [sequence, bytesHex] of (channelDatum as any).state.packet_receipt.entries()) {
      tree.set(
        `receipts/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`,
        Buffer.from(Data.to(bytesHex, bytesSchema) as any, 'hex'),
      );
    }
    for (const [sequence, bytesHex] of (channelDatum as any).state.packet_acknowledgement.entries()) {
      tree.set(
        `acks/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`,
        Buffer.from(Data.to(bytesHex, bytesSchema) as any, 'hex'),
      );
    }
  }

  const computedRoot = tree.getRoot();
  if (computedRoot !== expectedRoot) {
    throw new Error(
      `Tree rebuild failed: expected ${expectedRoot} but computed ${computedRoot}`,
    );
  }

  currentTree = tree;
  return { tree, root: computedRoot };
}
