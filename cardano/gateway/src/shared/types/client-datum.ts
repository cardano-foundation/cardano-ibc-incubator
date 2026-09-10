import { type Data } from '@lucid-evolution/lucid';
import { AuthToken } from './auth-token';
import { ClientDatumState } from './client-datum-state';

export type ClientDatum = {
  state: ClientDatumState;
  token: AuthToken;
  history_root: string;
};
export async function encodeClientDatum(
  clientDatum: ClientDatum,
  Lucid: typeof import('@lucid-evolution/lucid'),
): Promise<string> {
  const CML = (Lucid as any).CML;
  if (!CML) {
    throw new Error('Lucid CML is required to encode ClientDatum');
  }

  const bytes = (hex: string) => CML.PlutusData.new_bytes(Buffer.from(hex, 'hex'));
  const int = (value: bigint | number) => CML.PlutusData.new_integer(CML.BigInteger.from_str(value.toString()));
  const list = (values: any[]) => {
    const dataList = CML.PlutusDataList.new();
    values.forEach((value) => dataList.add(value));
    return CML.PlutusData.new_list(dataList);
  };
  const constr = (index: number, fields: any[]) => {
    const dataList = CML.PlutusDataList.new();
    fields.forEach((field) => dataList.add(field));
    return CML.PlutusData.new_constr_plutus_data(CML.ConstrPlutusData.new(BigInt(index), dataList));
  };
  const dataMap = (entries: [any, any][]) => {
    const map = CML.PlutusMap.new();
    entries.forEach(([key, value]) => map.set(key, value));
    return CML.PlutusData.new_map(map);
  };
  const mapEntries = <K, V>(map: Map<K, V>): [K, V][] => Array.from(map.entries());

  const height = (value: any) => constr(0, [int(value.revisionNumber), int(value.revisionHeight)]);
  const rational = (value: any) => constr(0, [int(value.numerator), int(value.denominator)]);
  const proofSpec = (value: any) =>
    constr(0, [
      constr(0, [
        int(value.leaf_spec.hash),
        int(value.leaf_spec.prehash_key),
        int(value.leaf_spec.prehash_value),
        int(value.leaf_spec.length),
        bytes(value.leaf_spec.prefix),
      ]),
      constr(0, [
        list(value.inner_spec.child_order.map(int)),
        int(value.inner_spec.child_size),
        int(value.inner_spec.min_prefix_length),
        int(value.inner_spec.max_prefix_length),
        bytes(value.inner_spec.empty_child),
        int(value.inner_spec.hash),
      ]),
      int(value.max_depth),
      int(value.min_depth),
      constr(value.prehash_key_before_comparison ? 1 : 0, []),
    ]);
  const clientState = (value: any) =>
    constr(0, [
      bytes(value.chainId),
      rational(value.trustLevel),
      int(value.trustingPeriod),
      int(value.unbondingPeriod),
      int(value.maxClockDrift),
      height(value.frozenHeight),
      height(value.latestHeight),
      list(value.proofSpecs.map(proofSpec)),
    ]);
  const consensusState = (value: any) =>
    constr(0, [int(value.timestamp), bytes(value.next_validators_hash), constr(0, [bytes(value.root.hash)])]);
  const authToken = (value: any) => constr(0, [bytes(value.policyId), bytes(value.name)]);

  return constr(0, [
    constr(0, [
      clientState(clientDatum.state.clientState),
      dataMap(
        mapEntries(clientDatum.state.consensusStates).map(([key, value]) => [height(key), consensusState(value)]),
      ),
      dataMap(mapEntries(clientDatum.state.processedTimes).map(([key, value]) => [height(key), int(value)])),
      dataMap(mapEntries(clientDatum.state.processedHeights).map(([key, value]) => [height(key), int(value)])),
    ]),
    authToken(clientDatum.token),
    bytes(clientDatum.history_root),
  ]).to_cbor_hex();
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
    processedTimes: Data.Map(HeightSchema, Data.Integer()),
    processedHeights: Data.Map(HeightSchema, Data.Integer()),
  });
  const ClientDatumSchema = Data.Object({
    state: ClientDatumStateSchema,
    token: AuthTokenSchema,
    history_root: Data.Bytes({ minLength: 32, maxLength: 32 }),
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
export { encodeClientStateValue } from '@cardano-ibc/tx-builder-runtime/ibcStateRoot';

/**
 * Encode a Tendermint `ConsensusState` value exactly as the on-chain Aiken code does.
 *
 * This encoding is used for the `ibc_state_root` commitment tree value bytes at:
 * `clients/{clientId}/consensusStates/{height}`.
 */
export { encodeConsensusStateValue } from '@cardano-ibc/tx-builder-runtime/ibcStateRoot';
