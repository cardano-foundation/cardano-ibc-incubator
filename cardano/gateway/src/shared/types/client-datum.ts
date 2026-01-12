import { type Data } from '@lucid-evolution/lucid';
import cbor from 'cbor';
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

  // Lucid's encoder can emit indefinite-length arrays; some on-chain decoders are stricter.
  // Canonical CBOR encoding is always definite-length, so we round-trip through a canonical encoder.
  const encoded = Data.to(clientDatum, TClientDatum, { canonical: true });
  const decoded = cbor.decodeFirstSync(Buffer.from(encoded, 'hex'));
  return cbor.encodeCanonical(decoded).toString('hex');
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
