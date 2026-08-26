import * as fs from 'node:fs';
import * as path from 'node:path';

import * as Lucid from '@lucid-evolution/lucid';

import { LucidService, type CodecType } from '@shared/modules/lucid/lucid.service';
import { encodeClientDatum, type ClientDatum } from '@shared/types/client-datum';
import { encodeSpendClientRedeemer } from '@shared/types/client-redeemer';
import { type ConsensusState } from '@shared/types/consensus-state';
import { type Header } from '@shared/types/header';
import { encodeHostStateDatum, type HostStateDatum } from '@shared/types/host-state-datum';
import { type Height } from '@shared/types/height';

export const CARDANO_MAX_TX_SIZE_BYTES = 16_384;
export const CARDANO_TX_SIZE_HEADROOM_BYTES = 750;
export const CARDANO_SAFE_TX_SIZE_BYTES = CARDANO_MAX_TX_SIZE_BYTES - CARDANO_TX_SIZE_HEADROOM_BYTES;

export const DEFAULT_NORMALIZED_FIXTURE_PATH = path.resolve(
  __dirname,
  '../test/fixtures/tendermint-update-capacity/normalized.json',
);

/**
 * These values deliberately model the integer widths of execution units in a
 * completed transaction. They are not the result of evaluating either script.
 */
export const STRUCTURAL_PLACEHOLDER_EX_UNITS = {
  hostState: { mem: 10_000_000n, steps: 3_000_000_000n },
  spendClient: { mem: 10_000_000n, steps: 5_000_000_000n },
} as const;

const HOST_STATE_POLICY_ID = 'a1'.repeat(28);
const HOST_STATE_ASSET_NAME = '484f53545f5354415445';
const CLIENT_POLICY_ID = 'b2'.repeat(28);
const CLIENT_ASSET_NAME = '43'.repeat(32);
const HOST_STATE_SCRIPT_HASH = 'c3'.repeat(28);
const SPEND_CLIENT_SCRIPT_HASH = 'd4'.repeat(28);
const ZERO_HASH = '00'.repeat(32);
const HOST_STATE_SIBLINGS = Array.from({ length: 64 }, () => ZERO_HASH);

type JsonInteger = string | number | bigint;

type NormalizedPartSetHeader = {
  total: JsonInteger;
  hash: string;
};

type NormalizedBlockId = {
  hash: string;
  part_set_header: NormalizedPartSetHeader;
};

type NormalizedValidator = {
  address: string;
  pub_key?: { ed25519?: string; secp256k1?: string };
  pubkey?: string;
  voting_power: JsonInteger;
  proposer_priority: JsonInteger;
};

type NormalizedValidatorSet = {
  validators: NormalizedValidator[];
  proposer: NormalizedValidator;
  total_voting_power: JsonInteger;
};

type NormalizedTimestamp = JsonInteger | { seconds: JsonInteger; nanos: JsonInteger };

export type NormalizedHeader = {
  signed_header: {
    header: {
      version: { block: JsonInteger; app: JsonInteger };
      chain_id: string;
      height: JsonInteger;
      time: NormalizedTimestamp;
      last_block_id: NormalizedBlockId;
      last_commit_hash: string;
      data_hash: string;
      validators_hash: string;
      next_validators_hash: string;
      consensus_hash: string;
      app_hash: string;
      last_results_hash: string;
      evidence_hash: string;
      proposer_address: string;
    };
    commit: {
      height: JsonInteger;
      round: JsonInteger;
      block_id: NormalizedBlockId;
      signatures: Array<{
        block_id_flag: JsonInteger;
        validator_address: string;
        timestamp: NormalizedTimestamp;
        signature: string;
      }>;
    };
  };
  validator_set: NormalizedValidatorSet;
  trusted_height: {
    revision_number: JsonInteger;
    revision_height: JsonInteger;
  };
  trusted_validators: NormalizedValidatorSet;
};

export type NormalizedConsensusState = {
  timestamp: NormalizedTimestamp;
  next_validators_hash: string;
  root: string | { hash: string };
};

export type NormalizedCapacityScenario = {
  header: NormalizedHeader;
  trusted_consensus_state: NormalizedConsensusState;
  observed?: Record<string, unknown>;
  [key: string]: unknown;
};

export type NormalizedCapacityFixture = {
  schema_version: JsonInteger;
  chain_id: string;
  scenarios: {
    adjacent_all_signed: NormalizedCapacityScenario;
    adjacent_mixed: NormalizedCapacityScenario;
    non_adjacent_mixed: NormalizedCapacityScenario;
    [name: string]: NormalizedCapacityScenario;
  };
  [key: string]: unknown;
};

export type StructuralExUnits = {
  hostState: { mem: bigint; steps: bigint };
  spendClient: { mem: bigint; steps: bigint };
};

export type ExUnitsSource = 'structural-placeholder' | 'aiken-unit-tests';

export type CapacityPayloadSizes = {
  spendClientRedeemerBytes: number;
  hostStateRedeemerBytes: number;
  updatedClientDatumBytes: number;
  updatedHostStateDatumBytes: number;
  totalBytes: number;
};

export type CapacityTransactionShape = {
  regularInputs: number;
  scriptInputs: number;
  collateralInputs: number;
  referenceInputs: number;
  inlineDatumOutputs: number;
  spendRedeemers: number;
  vkeyWitnesses: number;
};

export type CapacityScenarioReport = {
  scenario: string;
  classification: 'structural-signed-candidate';
  ledgerEvaluated: false;
  exUnitsSource: ExUnitsSource;
  validatorCount: number;
  trustedValidatorCount: number;
  commitSlots: number;
  committingSlots: number;
  absentSlots: number;
  nilSlots: number;
  adjacent: boolean;
  retainedHistory: 1;
  removedConsensusStates: 0;
  unsignedBytes: number;
  signedBytes: number;
  signingOverheadBytes: number;
  absoluteSizeMarginBytes: number;
  safeSizeMarginBytes: number;
  payloads: CapacityPayloadSizes;
  shape: CapacityTransactionShape;
  scriptExUnits: {
    hostState: { mem: string; steps: string };
    spendClient: { mem: string; steps: string };
    total: { mem: string; steps: string };
  };
};

export type CapacityScenarioArtifact = {
  report: CapacityScenarioReport;
  unsignedCbor: string;
  signedCbor: string;
  encoded: {
    spendClientRedeemer: string;
    hostStateRedeemer: string;
    updatedClientDatum: string;
    updatedHostStateDatum: string;
  };
};

function asBigInt(value: JsonInteger, label: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`${label} must be an integer; found ${String(value)}`);
  }
}

function asTimestamp(value: NormalizedTimestamp, label: string): bigint {
  if (typeof value === 'object') {
    return asBigInt(value.seconds, `${label}.seconds`) * 1_000_000_000n + asBigInt(value.nanos, `${label}.nanos`);
  }
  return asBigInt(value, label);
}

function assertHex(value: string, label: string, bytes?: number): string {
  if (!/^[0-9a-f]*$/.test(value) || value.length % 2 !== 0) {
    throw new Error(`${label} must be lowercase, even-length hex`);
  }
  if (bytes !== undefined && value.length !== bytes * 2) {
    throw new Error(`${label} must contain ${bytes} bytes; found ${value.length / 2}`);
  }
  return value;
}

function chainIdHex(chainId: string): string {
  return assertHex(Buffer.from(chainId, 'utf8').toString('hex'), 'chain id');
}

function convertBlockId(value: NormalizedBlockId, label: string) {
  return {
    hash: assertHex(value.hash, `${label}.hash`),
    partSetHeader: {
      total: asBigInt(value.part_set_header.total, `${label}.part_set_header.total`),
      hash: assertHex(value.part_set_header.hash, `${label}.part_set_header.hash`),
    },
  };
}

function convertValidator(value: NormalizedValidator, label: string) {
  const pubkey = value.pubkey ?? value.pub_key?.ed25519 ?? value.pub_key?.secp256k1;
  if (!pubkey) {
    throw new Error(`${label} has no public key`);
  }
  return {
    address: assertHex(value.address, `${label}.address`, 20),
    pubkey: assertHex(pubkey, `${label}.pubkey`, 32),
    votingPower: asBigInt(value.voting_power, `${label}.voting_power`),
    proposerPriority: asBigInt(value.proposer_priority, `${label}.proposer_priority`),
  };
}

function convertValidatorSet(value: NormalizedValidatorSet, label: string) {
  return {
    validators: value.validators.map((validator, index) =>
      convertValidator(validator, `${label}.validators[${index}]`),
    ),
    proposer: convertValidator(value.proposer, `${label}.proposer`),
    totalVotingPower: asBigInt(value.total_voting_power, `${label}.total_voting_power`),
  };
}

export function normalizedHeaderToGateway(value: NormalizedHeader): Header {
  const header = value.signed_header.header;
  const commit = value.signed_header.commit;
  return {
    signedHeader: {
      header: {
        version: {
          block: asBigInt(header.version.block, 'header.version.block'),
          app: asBigInt(header.version.app, 'header.version.app'),
        },
        chainId: chainIdHex(header.chain_id),
        height: asBigInt(header.height, 'header.height'),
        time: asTimestamp(header.time, 'header.time'),
        lastBlockId: convertBlockId(header.last_block_id, 'header.last_block_id'),
        lastCommitHash: assertHex(header.last_commit_hash, 'header.last_commit_hash'),
        dataHash: assertHex(header.data_hash, 'header.data_hash'),
        validatorsHash: assertHex(header.validators_hash, 'header.validators_hash'),
        nextValidatorsHash: assertHex(header.next_validators_hash, 'header.next_validators_hash'),
        consensusHash: assertHex(header.consensus_hash, 'header.consensus_hash'),
        appHash: assertHex(header.app_hash, 'header.app_hash'),
        lastResultsHash: assertHex(header.last_results_hash, 'header.last_results_hash'),
        evidenceHash: assertHex(header.evidence_hash, 'header.evidence_hash'),
        proposerAddress: assertHex(header.proposer_address, 'header.proposer_address'),
      },
      commit: {
        height: asBigInt(commit.height, 'commit.height'),
        round: asBigInt(commit.round, 'commit.round'),
        blockId: convertBlockId(commit.block_id, 'commit.block_id'),
        signatures: commit.signatures.map((signature, index) => ({
          block_id_flag: asBigInt(signature.block_id_flag, `commit.signatures[${index}].block_id_flag`),
          validator_address: assertHex(signature.validator_address, `commit.signatures[${index}].validator_address`),
          timestamp: asTimestamp(signature.timestamp, `commit.signatures[${index}].timestamp`),
          signature: assertHex(signature.signature, `commit.signatures[${index}].signature`),
        })),
      },
    },
    validatorSet: convertValidatorSet(value.validator_set, 'validator_set'),
    trustedHeight: {
      revisionNumber: asBigInt(value.trusted_height.revision_number, 'trusted_height.revision_number'),
      revisionHeight: asBigInt(value.trusted_height.revision_height, 'trusted_height.revision_height'),
    },
    trustedValidators: convertValidatorSet(value.trusted_validators, 'trusted_validators'),
  };
}

function normalizedConsensusStateToGateway(value: NormalizedConsensusState): ConsensusState {
  const root = typeof value.root === 'string' ? value.root : value.root.hash;
  return {
    timestamp: asTimestamp(value.timestamp, 'trusted_consensus_state.timestamp'),
    next_validators_hash: assertHex(value.next_validators_hash, 'trusted_consensus_state.next_validators_hash'),
    root: { hash: assertHex(root, 'trusted_consensus_state.root') },
  };
}

export function loadNormalizedCapacityFixture(filePath = DEFAULT_NORMALIZED_FIXTURE_PATH): NormalizedCapacityFixture {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as NormalizedCapacityFixture;
}

function retainedConsensusStates(header: Header): Array<[Height, ConsensusState]> {
  const revisionNumber = header.trustedHeight.revisionNumber;
  const newHeight: Height = {
    revisionNumber,
    revisionHeight: header.signedHeader.header.height,
  };
  const newConsensusState: ConsensusState = {
    timestamp: header.signedHeader.header.time,
    next_validators_hash: header.signedHeader.header.nextValidatorsHash,
    root: { hash: header.signedHeader.header.appHash },
  };
  return [[newHeight, newConsensusState]];
}

async function encodeRepresentativeDatums(
  header: Header,
  _trustedConsensusState: ConsensusState,
): Promise<{ updatedClientDatum: string; updatedHostStateDatum: string }> {
  // Keep the output at the minimum valid history so this benchmark isolates
  // validator/commit capacity from consensus-state pruning costs.
  const states = retainedConsensusStates(header);
  const processedTimes = new Map(states.map(([height, state]) => [height, state.timestamp]));
  const processedHeights = new Map(states.map(([height]) => [height, height.revisionHeight]));
  const clientDatum: ClientDatum = {
    state: {
      clientState: {
        chainId: header.signedHeader.header.chainId,
        trustLevel: { numerator: 1n, denominator: 3n },
        trustingPeriod: 1_209_600_000_000_000n,
        unbondingPeriod: 1_814_400_000_000_000n,
        maxClockDrift: 600_000_000_000n,
        frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
        latestHeight: {
          revisionNumber: header.trustedHeight.revisionNumber,
          revisionHeight: header.signedHeader.header.height,
        },
        proofSpecs: [],
      },
      consensusStates: new Map(states),
      processedTimes,
      processedHeights,
    },
    token: { policyId: CLIENT_POLICY_ID, name: CLIENT_ASSET_NAME },
  };

  const hostStateDatum: HostStateDatum = {
    state: {
      version: 2n,
      ibc_state_root: 'e5'.repeat(32),
      next_client_sequence: 1n,
      next_connection_sequence: 1n,
      next_channel_sequence: 1n,
      bound_port: [],
      last_update_time: header.signedHeader.header.time / 1_000_000n,
    },
    nft_policy: HOST_STATE_POLICY_ID,
    deployer: 'f6'.repeat(28),
    control: { port_registry: new Map(), shutdown: 'Active' },
  };

  return {
    updatedClientDatum: await encodeClientDatum(clientDatum, Lucid),
    updatedHostStateDatum: await encodeHostStateDatum(hostStateDatum, Lucid),
  };
}

type HostStateEncoder = (this: { LucidImporter: typeof Lucid }, data: unknown, type: CodecType) => Promise<string>;

async function encodeHostStateUpdateRedeemer(): Promise<string> {
  const encode = LucidService.prototype.encode as HostStateEncoder;
  return encode.call(
    { LucidImporter: Lucid },
    {
      UpdateClient: {
        client_state_siblings: [...HOST_STATE_SIBLINGS],
        consensus_state_siblings: [...HOST_STATE_SIBLINGS],
        removed_consensus_state_siblings: [],
      },
    },
    'host_state_redeemer',
  );
}

function byteLength(hex: string): number {
  if (hex.length % 2 !== 0) {
    throw new Error(`Expected even-length CBOR hex; found ${hex.length} characters`);
  }
  return hex.length / 2;
}

function txInput(hashByte: string, index = 0n) {
  const CML = Lucid.CML;
  return CML.TransactionInput.new(CML.TransactionHash.from_hex(hashByte.repeat(32)), index);
}

function inputList(inputs: ReturnType<typeof txInput>[]) {
  const list = Lucid.CML.TransactionInputList.new();
  inputs.forEach((input) => list.add(input));
  return list;
}

function nftValue(policyId: string, assetName: string, lovelace: bigint) {
  const CML = Lucid.CML;
  const assets = CML.MultiAsset.new();
  assets.set(CML.ScriptHash.from_hex(policyId), CML.AssetName.from_raw_bytes(Buffer.from(assetName, 'hex')), 1n);
  return CML.Value.new(lovelace, assets);
}

function scriptAddress(scriptHash: string) {
  const CML = Lucid.CML;
  return CML.EnterpriseAddress.new(0, CML.Credential.new_script(CML.ScriptHash.from_hex(scriptHash))).to_address();
}

function outputList(updatedHostStateDatum: string, updatedClientDatum: string) {
  const CML = Lucid.CML;
  const outputs = CML.TransactionOutputList.new();
  outputs.add(
    CML.TransactionOutput.new(
      scriptAddress(HOST_STATE_SCRIPT_HASH),
      nftValue(HOST_STATE_POLICY_ID, HOST_STATE_ASSET_NAME, 5_000_000n),
      CML.DatumOption.new_datum(CML.PlutusData.from_cbor_hex(updatedHostStateDatum)),
    ),
  );
  outputs.add(
    CML.TransactionOutput.new(
      scriptAddress(SPEND_CLIENT_SCRIPT_HASH),
      nftValue(CLIENT_POLICY_ID, CLIENT_ASSET_NAME, 5_000_000n),
      CML.DatumOption.new_datum(CML.PlutusData.from_cbor_hex(updatedClientDatum)),
    ),
  );
  return outputs;
}

function buildRedeemers(hostStateRedeemer: string, spendClientRedeemer: string, exUnits: StructuralExUnits) {
  const CML = Lucid.CML;
  const map = CML.MapRedeemerKeyToRedeemerVal.new();
  map.insert(
    CML.RedeemerKey.new(CML.RedeemerTag.Spend, 0n),
    CML.RedeemerVal.new(
      CML.PlutusData.from_cbor_hex(hostStateRedeemer),
      CML.ExUnits.new(exUnits.hostState.mem, exUnits.hostState.steps),
    ),
  );
  map.insert(
    CML.RedeemerKey.new(CML.RedeemerTag.Spend, 1n),
    CML.RedeemerVal.new(
      CML.PlutusData.from_cbor_hex(spendClientRedeemer),
      CML.ExUnits.new(exUnits.spendClient.mem, exUnits.spendClient.steps),
    ),
  );
  return CML.Redeemers.new_map_redeemer_key_to_redeemer_val(map);
}

function buildStructuralTransactions(
  hostStateRedeemer: string,
  spendClientRedeemer: string,
  updatedHostStateDatum: string,
  updatedClientDatum: string,
  exUnits: StructuralExUnits,
) {
  const CML = Lucid.CML;
  // Hash ordering fixes HostState and SpendClient at redeemer indices 0 and 1.
  // The third regular input supplies fees and requires the single vkey witness.
  const body = CML.TransactionBody.new(
    inputList([txInput('11'), txInput('22'), txInput('33')]),
    outputList(updatedHostStateDatum, updatedClientDatum),
    2_000_000n,
  );
  body.set_collateral_inputs(inputList([txInput('44')]));
  body.set_total_collateral(5_000_000n);
  body.set_reference_inputs(inputList([txInput('55'), txInput('66')]));
  body.set_validity_interval_start(120_000_000n);
  body.set_ttl(120_000_600n);
  body.set_network_id(CML.NetworkId.testnet());

  const scriptDataRedeemers = buildRedeemers(hostStateRedeemer, spendClientRedeemer, exUnits);
  body.set_script_data_hash(
    CML.hash_script_data(scriptDataRedeemers, Lucid.createCostModels(Lucid.PROTOCOL_PARAMETERS_DEFAULT.costModels)),
  );

  const unsignedWitnesses = CML.TransactionWitnessSet.new();
  unsignedWitnesses.set_redeemers(buildRedeemers(hostStateRedeemer, spendClientRedeemer, exUnits));
  const unsigned = CML.Transaction.new(body, unsignedWitnesses, true);

  const signingKey = CML.PrivateKey.from_normal_bytes(Buffer.alloc(32, 0x42));
  const vkeys = CML.VkeywitnessList.new();
  vkeys.add(CML.make_vkey_witness(CML.hash_transaction(body), signingKey));
  const signedWitnesses = CML.TransactionWitnessSet.new();
  signedWitnesses.set_redeemers(buildRedeemers(hostStateRedeemer, spendClientRedeemer, exUnits));
  signedWitnesses.set_vkeywitnesses(vkeys);
  const signed = CML.Transaction.new(body, signedWitnesses, true);

  return { unsigned, signed };
}

function inspectShape(transaction: InstanceType<typeof Lucid.CML.Transaction>): CapacityTransactionShape {
  const body = transaction.body();
  const witnesses = transaction.witness_set();
  const redeemers = witnesses.redeemers()?.as_map_redeemer_key_to_redeemer_val();
  return {
    regularInputs: body.inputs().len(),
    scriptInputs: 2,
    collateralInputs: body.collateral_inputs()?.len() ?? 0,
    referenceInputs: body.reference_inputs()?.len() ?? 0,
    inlineDatumOutputs: Array.from({ length: body.outputs().len() }, (_, index) => body.outputs().get(index)).filter(
      (output) => output.datum()?.as_datum() !== undefined,
    ).length,
    spendRedeemers: redeemers?.len() ?? 0,
    vkeyWitnesses: witnesses.vkeywitnesses()?.len() ?? 0,
  };
}

function assertCandidateShape(shape: CapacityTransactionShape): void {
  const expected: CapacityTransactionShape = {
    regularInputs: 3,
    scriptInputs: 2,
    collateralInputs: 1,
    referenceInputs: 2,
    inlineDatumOutputs: 2,
    spendRedeemers: 2,
    vkeyWitnesses: 1,
  };
  for (const key of Object.keys(expected) as Array<keyof CapacityTransactionShape>) {
    if (shape[key] !== expected[key]) {
      throw new Error(`Structural transaction ${key} must be ${expected[key]}; found ${shape[key]}`);
    }
  }
}

export async function analyzeCapacityScenario(
  scenarioName: string,
  scenario: NormalizedCapacityScenario,
  exUnits: StructuralExUnits = STRUCTURAL_PLACEHOLDER_EX_UNITS,
  exUnitsSource: ExUnitsSource = 'structural-placeholder',
): Promise<CapacityScenarioArtifact> {
  const header = normalizedHeaderToGateway(scenario.header);
  const trustedConsensusState = normalizedConsensusStateToGateway(scenario.trusted_consensus_state);
  const spendClientRedeemer = await encodeSpendClientRedeemer(
    { UpdateClient: { msg: { HeaderCase: [header] } } },
    Lucid,
  );
  const hostStateRedeemer = await encodeHostStateUpdateRedeemer();
  const { updatedClientDatum, updatedHostStateDatum } = await encodeRepresentativeDatums(header, trustedConsensusState);
  const transactions = buildStructuralTransactions(
    hostStateRedeemer,
    spendClientRedeemer,
    updatedHostStateDatum,
    updatedClientDatum,
    exUnits,
  );
  const unsignedCbor = transactions.unsigned.to_canonical_cbor_hex();
  const signedCbor = transactions.signed.to_canonical_cbor_hex();
  const unsignedBytes = byteLength(unsignedCbor);
  const signedBytes = byteLength(signedCbor);
  const shape = inspectShape(transactions.signed);
  assertCandidateShape(shape);

  const signatures = header.signedHeader.commit.signatures;
  const payloads = {
    spendClientRedeemerBytes: byteLength(spendClientRedeemer),
    hostStateRedeemerBytes: byteLength(hostStateRedeemer),
    updatedClientDatumBytes: byteLength(updatedClientDatum),
    updatedHostStateDatumBytes: byteLength(updatedHostStateDatum),
    totalBytes: 0,
  };
  payloads.totalBytes =
    payloads.spendClientRedeemerBytes +
    payloads.hostStateRedeemerBytes +
    payloads.updatedClientDatumBytes +
    payloads.updatedHostStateDatumBytes;
  const totalExUnits = {
    mem: exUnits.hostState.mem + exUnits.spendClient.mem,
    steps: exUnits.hostState.steps + exUnits.spendClient.steps,
  };

  return {
    unsignedCbor,
    signedCbor,
    encoded: { spendClientRedeemer, hostStateRedeemer, updatedClientDatum, updatedHostStateDatum },
    report: {
      scenario: scenarioName,
      classification: 'structural-signed-candidate',
      ledgerEvaluated: false,
      exUnitsSource,
      validatorCount: header.validatorSet.validators.length,
      trustedValidatorCount: header.trustedValidators.validators.length,
      commitSlots: signatures.length,
      committingSlots: signatures.filter((signature) => signature.block_id_flag === 2n).length,
      absentSlots: signatures.filter((signature) => signature.block_id_flag === 1n).length,
      nilSlots: signatures.filter((signature) => signature.block_id_flag === 3n).length,
      adjacent: header.signedHeader.header.height === header.trustedHeight.revisionHeight + 1n,
      retainedHistory: 1,
      removedConsensusStates: 0,
      unsignedBytes,
      signedBytes,
      signingOverheadBytes: signedBytes - unsignedBytes,
      absoluteSizeMarginBytes: CARDANO_MAX_TX_SIZE_BYTES - signedBytes,
      safeSizeMarginBytes: CARDANO_SAFE_TX_SIZE_BYTES - signedBytes,
      payloads,
      shape,
      scriptExUnits: {
        hostState: { mem: exUnits.hostState.mem.toString(), steps: exUnits.hostState.steps.toString() },
        spendClient: { mem: exUnits.spendClient.mem.toString(), steps: exUnits.spendClient.steps.toString() },
        total: { mem: totalExUnits.mem.toString(), steps: totalExUnits.steps.toString() },
      },
    },
  };
}

export async function analyzeNormalizedCapacityFixture(
  fixturePath = DEFAULT_NORMALIZED_FIXTURE_PATH,
  exUnits: StructuralExUnits = STRUCTURAL_PLACEHOLDER_EX_UNITS,
  exUnitsSource: ExUnitsSource = 'structural-placeholder',
): Promise<CapacityScenarioArtifact[]> {
  const fixture = loadNormalizedCapacityFixture(fixturePath);
  const names = ['adjacent_all_signed', 'adjacent_mixed', 'non_adjacent_mixed'] as const;
  return Promise.all(
    names.map((name) => analyzeCapacityScenario(name, fixture.scenarios[name], exUnits, exUnitsSource)),
  );
}

/**
 * Render the stable boundary between the normalized live fixture and Aiken's
 * whole-validator tests. The redeemers are encoded by the same production
 * encoder used by the Gateway; Aiken only has to deserialize them and supply
 * the trusted consensus-state fields that are not carried in a Header.
 */
export async function renderAikenFixtureModule(fixturePath = DEFAULT_NORMALIZED_FIXTURE_PATH): Promise<string> {
  const fixture = loadNormalizedCapacityFixture(fixturePath);
  const names = ['adjacent_all_signed', 'adjacent_mixed', 'non_adjacent_mixed'] as const;
  const declarations: string[] = [];

  for (const name of names) {
    const scenario = fixture.scenarios[name];
    if (!scenario) {
      throw new Error(`Normalized fixture is missing scenario '${name}'`);
    }
    const header = normalizedHeaderToGateway(scenario.header);
    const trustedConsensusState = normalizedConsensusStateToGateway(scenario.trusted_consensus_state);
    const redeemer = await encodeSpendClientRedeemer({ UpdateClient: { msg: { HeaderCase: [header] } } }, Lucid);
    declarations.push(
      `pub const ${name}_spend_client_redeemer_cbor: ByteArray = #"${redeemer}"`,
      `pub const ${name}_trusted_timestamp: Int = ${trustedConsensusState.timestamp}`,
      `pub const ${name}_trusted_app_hash: ByteArray = #"${trustedConsensusState.root.hash}"`,
      `pub const ${name}_trusted_validator_set_hash: ByteArray = #"${trustedConsensusState.next_validators_hash}"`,
      `pub const ${name}_header_app_hash: ByteArray = #"${header.signedHeader.header.appHash}"`,
    );
  }

  return [
    '//// Generated from the normalized Tendermint capacity fixture.',
    '//// Do not hand-edit: regenerate it through the Gateway fixture tooling.',
    '',
    declarations.join('\n\n'),
    '',
  ].join('\n');
}

export function formatCapacityReport(report: CapacityScenarioReport): string {
  return [
    `${report.scenario} (${report.classification}; ledger-evaluated=${report.ledgerEvaluated})`,
    `  validators: current=${report.validatorCount} trusted=${report.trustedValidatorCount}`,
    `  commit slots: total=${report.commitSlots} commit=${report.committingSlots} absent=${report.absentSlots} nil=${report.nilSlots}`,
    `  consensus history: retained=${report.retainedHistory} removed=${report.removedConsensusStates}`,
    `  exact CBOR: unsigned=${report.unsignedBytes} signed=${report.signedBytes} signing-overhead=${report.signingOverheadBytes}`,
    `  size margins: absolute=${report.absoluteSizeMarginBytes} safe=${report.safeSizeMarginBytes}`,
    `  payload bytes: spend-client=${report.payloads.spendClientRedeemerBytes} host-state=${report.payloads.hostStateRedeemerBytes} client-datum=${report.payloads.updatedClientDatumBytes} host-datum=${report.payloads.updatedHostStateDatumBytes} total=${report.payloads.totalBytes}`,
    `  shape: regular-inputs=${report.shape.regularInputs} script-inputs=${report.shape.scriptInputs} collateral=${report.shape.collateralInputs} references=${report.shape.referenceInputs} inline-outputs=${report.shape.inlineDatumOutputs} spend-redeemers=${report.shape.spendRedeemers} vkeys=${report.shape.vkeyWitnesses}`,
    `  script ex-units (${report.exUnitsSource}; ledger-evaluated=${report.ledgerEvaluated}): mem=${report.scriptExUnits.total.mem} steps=${report.scriptExUnits.total.steps}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const fixturePath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_NORMALIZED_FIXTURE_PATH;
  const artifacts = await analyzeNormalizedCapacityFixture(fixturePath);
  console.log(artifacts.map(({ report }) => formatCapacityReport(report)).join('\n\n'));
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
