import { type Data } from '@lucid-evolution/lucid';
import { AuthToken } from './auth-token';
import { ClientDatumState } from './client-datum-state';

export type ClientDatum = {
  state: ClientDatumState;
  token: AuthToken;
};
export async function encodeClientDatum(
  clientDatum: ClientDatum,
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
  const LeaftOpSchema = Data.Object({
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
    leaf_spec: LeaftOpSchema,
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
  type TClientDatum = Data.Static<typeof ClientDatumSchema>;
  const TClientDatum = ClientDatumSchema as unknown as ClientDatum;

  return Data.to(clientDatum, TClientDatum, { canonical: true });
}

export async function decodeClientDatum(
  clientDatum: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): Promise<ClientDatum> {
  const { Data } = Lucid;

  const RationalSchema = Data.Object({
    numerator: Data.Integer(),
    denominator: Data.Integer(),
  });
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const LeaftOpSchema = Data.Object({
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
    leaf_spec: LeaftOpSchema,
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
  type TClientDatum = Data.Static<typeof ClientDatumSchema>;
  const TClientDatum = ClientDatumSchema as unknown as ClientDatum;
  return Data.from(clientDatum, TClientDatum);
}

/**
 * Encode a Tendermint `ClientState` value exactly as the on-chain Aiken code does.
 *
 * This encoding is used for the `ibc_state_root` commitment tree value bytes at:
 * `clients/{clientId}/clientState`.
 */
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
  const LeaftOpSchema = Data.Object({
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
    leaf_spec: LeaftOpSchema,
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

  // IMPORTANT: do NOT set `{ canonical: true }` here.
  //
  // On-chain we commit to `aiken/cbor.serialise(...)` of these values, and Aiken's
  // CBOR serialization is not canonical (it may use indefinite-length arrays).
  //
  // For root correctness enforcement to work, the Gateway must produce the exact
  // same bytes as the on-chain `cbor.serialise` call.
  return Data.to(clientState, ClientStateSchema as any);
}

/**
 * Encode a Tendermint `ConsensusState` value exactly as the on-chain Aiken code does.
 *
 * This encoding is used for the `ibc_state_root` commitment tree value bytes at:
 * `clients/{clientId}/consensusStates/{height}`.
 */
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

  // See `encodeClientStateValue` for why canonical CBOR must NOT be used here.
  return Data.to(consensusState, ConsensusStateSchema as any);
}
