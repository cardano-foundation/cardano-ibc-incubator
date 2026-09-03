import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as Lucid from '@lucid-evolution/lucid';

import { LucidService, type CodecType } from '@shared/modules/lucid/lucid.service';
import { encodeClientDatum, type ClientDatum } from '@shared/types/client-datum';
import { encodeSpendClientRedeemer } from '@shared/types/client-redeemer';
import { type ClientState } from '@shared/types/client-state-types';
import { type ConsensusState } from '@shared/types/consensus-state';
import { type Header } from '@shared/types/header';
import { encodeHostStateDatum, type HostStateDatum } from '@shared/types/host-state-datum';
import { type Height } from '@shared/types/height';
import {
  buildEurekaUpdateClientOutput,
  encodeEurekaUpdateClientOutput,
  EUREKA_UPDATE_CLIENT_MAX_CLOCK_DRIFT_NS,
  EUREKA_UPDATE_CLIENT_PROGRAM_VKEY,
} from '@shared/types/sp1-update-client';
import { encodeTendermintProofRedeemer } from '@shared/types/tendermint-proof-redeemer';

export const CARDANO_MAX_TX_SIZE_BYTES = 16_384;
export const CARDANO_TX_SIZE_HEADROOM_BYTES = 750;
export const CARDANO_SAFE_TX_SIZE_BYTES = CARDANO_MAX_TX_SIZE_BYTES - CARDANO_TX_SIZE_HEADROOM_BYTES;
export const CARDANO_MAX_TX_EX_MEM = 16_500_000n;
export const CARDANO_MAX_TX_EX_STEPS = 10_000_000_000n;
export const CARDANO_SAFE_TX_EX_MEM = 15_675_000n;
export const CARDANO_SAFE_TX_EX_STEPS = 9_500_000_000n;

const EUREKA_UPDATE_CLIENT_PROGRAM = 'sp1-ics07-tendermint-update-client-v2.0.0';

export const DEFAULT_NORMALIZED_FIXTURE_PATH = path.resolve(
  __dirname,
  '../test/fixtures/tendermint-update-capacity/normalized.json',
);

const repoRoot = path.resolve(__dirname, '../../../../..');
export const DEFAULT_SP1_PROOF_METADATA_PATH = path.join(
  repoRoot,
  'cardano/sp1-tendermint-prover/artifacts/injective-45/metadata.json',
);
export const DEFAULT_SP1_WRAPPED_PROOF_PATH = path.join(
  repoRoot,
  'cardano/sp1-tendermint-prover/artifacts/injective-45/wrapped_proof.bin',
);
export const DEFAULT_SP1_PUBLIC_VALUES_PATH = path.join(
  repoRoot,
  'cardano/sp1-tendermint-prover/artifacts/injective-45/public_values.bin',
);

/**
 * These values deliberately model the integer widths of execution units in a
 * completed transaction. They are not the result of evaluating either script.
 */
export const STRUCTURAL_PLACEHOLDER_EX_UNITS = {
  hostState: { mem: 10_000_000n, steps: 5_000_000_000n },
  spendClient: { mem: 10_000_000n, steps: 5_000_000_000n },
} as const;

export const STRUCTURAL_PLACEHOLDER_PROOF_EX_UNITS = {
  ...STRUCTURAL_PLACEHOLDER_EX_UNITS,
  tendermintProof: { mem: 10_000_000n, steps: 5_000_000_000n },
} as const;

const HOST_STATE_POLICY_ID = 'a1'.repeat(28);
const HOST_STATE_ASSET_NAME = '484f53545f5354415445';
const CLIENT_POLICY_ID = 'b2'.repeat(28);
const CLIENT_ASSET_NAME = '43'.repeat(32);
const HOST_STATE_SCRIPT_HASH = 'c3'.repeat(28);
const SPEND_CLIENT_SCRIPT_HASH = 'd4'.repeat(28);
const TENDERMINT_PROOF_SCRIPT_HASH = 'e7'.repeat(28);
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
  observations?: Record<string, unknown>;
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

export type ProofStructuralExUnits = StructuralExUnits & {
  tendermintProof: { mem: bigint; steps: bigint };
};

export type ProofArtifactPaths = {
  metadataPath?: string;
  wrappedProofPath?: string;
  publicValuesPath?: string;
};

export type ExUnitsSource = 'structural-placeholder' | 'aiken-unit-tests';

export type CapacityPayloadSizes = {
  spendClientRedeemerBytes: number;
  hostStateRedeemerBytes: number;
  tendermintProofRedeemerBytes: number;
  wrappedProofBytes: number;
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
  rewardRedeemers: number;
  withdrawals: number;
  vkeyWitnesses: number;
};

export type CapacityScenarioReport = {
  scenario: string;
  mode: 'direct' | 'sp1';
  classification: 'structural-signed-lower-bound';
  ledgerEvaluated: false;
  providerCompleted: false;
  balanced: false;
  exUnitsSource: ExUnitsSource;
  validatorCount: number;
  trustedValidatorCount: number;
  commitSlots: number;
  committingSlots: number;
  absentSlots: number;
  nilSlots: number;
  adjacent: boolean;
  inputConsensusStates: 1;
  outputConsensusStates: 2;
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
    tendermintProof?: { mem: string; steps: string };
    total: { mem: string; steps: string };
    absoluteMargin: { mem: string; steps: string };
    safeMargin: { mem: string; steps: string };
  };
};

export type CapacityScenarioArtifact = {
  report: CapacityScenarioReport;
  unsignedCbor: string;
  signedCbor: string;
  encoded: {
    spendClientRedeemer: string;
    hostStateRedeemer: string;
    tendermintProofRedeemer?: string;
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

/**
 * Resize the real all-signed fixture without claiming to produce a valid
 * Tendermint header. This preserves the production field widths and is used
 * only to measure how direct-path CBOR grows with validator count.
 */
export function resizeCapacityScenario(
  scenario: NormalizedCapacityScenario,
  validatorCount: number,
): NormalizedCapacityScenario {
  if (!Number.isSafeInteger(validatorCount) || validatorCount < 1) {
    throw new Error(`validatorCount must be a positive safe integer; found ${validatorCount}`);
  }

  const resized = JSON.parse(JSON.stringify(scenario)) as NormalizedCapacityScenario;
  const sourceValidators = scenario.header.validator_set.validators;
  const sourceTrustedValidators = scenario.header.trusted_validators.validators;
  const sourceSignatures = scenario.header.signed_header.commit.signatures;
  if (sourceValidators.length === 0 || sourceTrustedValidators.length === 0 || sourceSignatures.length === 0) {
    throw new Error('Cannot resize an empty Tendermint validator fixture');
  }

  const addressFor = (index: number) => (index + 1).toString(16).padStart(40, '0');
  const resizeValidatorSet = (set: NormalizedValidatorSet, source: NormalizedValidator[]) => {
    set.validators = Array.from({ length: validatorCount }, (_, index) => ({
      ...source[index % source.length],
      address: addressFor(index),
    }));
    set.proposer = { ...set.validators[0] };
    set.total_voting_power = set.validators
      .reduce((total, validator) => total + asBigInt(validator.voting_power, 'validator.voting_power'), 0n)
      .toString();
  };

  resizeValidatorSet(resized.header.validator_set, sourceValidators);
  resizeValidatorSet(resized.header.trusted_validators, sourceTrustedValidators);
  resized.header.signed_header.header.proposer_address = addressFor(0);
  resized.header.signed_header.commit.signatures = Array.from({ length: validatorCount }, (_, index) => ({
    ...sourceSignatures[index % sourceSignatures.length],
    block_id_flag: '2',
    validator_address: addressFor(index),
  }));
  return resized;
}

function outputConsensusStates(header: Header, trustedConsensusState: ConsensusState): Array<[Height, ConsensusState]> {
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
  return [
    [newHeight, newConsensusState],
    [header.trustedHeight, trustedConsensusState],
  ];
}

function representativeInputClientState(header: Header): ClientState {
  return {
    chainId: header.signedHeader.header.chainId,
    trustLevel: { numerator: 1n, denominator: 3n },
    trustingPeriod: 1_209_600_000_000_000n,
    unbondingPeriod: 1_814_400_000_000_000n,
    maxClockDrift: EUREKA_UPDATE_CLIENT_MAX_CLOCK_DRIFT_NS,
    frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
    latestHeight: header.trustedHeight,
    proofSpecs: [],
  };
}

async function encodeRepresentativeDatums(
  header: Header,
  trustedConsensusState: ConsensusState,
): Promise<{ updatedClientDatum: string; updatedHostStateDatum: string }> {
  // Start with one unexpired trusted state and retain it when prepending the
  // target state. This is the smallest valid no-pruning UpdateClient output.
  const states = outputConsensusStates(header, trustedConsensusState);
  const txValidFromNs =
    ((header.signedHeader.header.time - EUREKA_UPDATE_CLIENT_MAX_CLOCK_DRIFT_NS) / 1_000_000n + 1_000n) * 1_000_000n;
  const processedTimes = new Map<Height, bigint>([
    [states[0][0], txValidFromNs],
    [states[1][0], 0n],
  ]);
  const processedHeights = new Map<Height, bigint>([
    [states[0][0], txValidFromNs / 4_000_000_000n],
    [states[1][0], 0n],
  ]);
  const inputClientState = representativeInputClientState(header);
  const clientDatum: ClientDatum = {
    state: {
      clientState: {
        ...inputClientState,
        latestHeight: states[0][0],
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
      last_update_time: txValidFromNs / 1_000_000n,
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

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function encodeExpectedEurekaPublicValues(
  header: Header,
  trustedConsensusState: ConsensusState,
  proofTime: bigint,
): Buffer {
  const trustedHeight = header.trustedHeight;
  const newHeight: Height = {
    revisionNumber: trustedHeight.revisionNumber,
    revisionHeight: header.signedHeader.header.height,
  };
  const newConsensusState: ConsensusState = {
    timestamp: header.signedHeader.header.time,
    next_validators_hash: header.signedHeader.header.nextValidatorsHash,
    root: { hash: header.signedHeader.header.appHash },
  };
  return encodeEurekaUpdateClientOutput(
    buildEurekaUpdateClientOutput({
      clientState: representativeInputClientState(header),
      trustedConsensusState,
      newConsensusState,
      time: proofTime,
      trustedHeight,
      newHeight,
    }),
  );
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

type StructuralProofWitness = {
  redeemer: string;
  exUnits: { mem: bigint; steps: bigint };
};

function buildRedeemers(
  hostStateRedeemer: string,
  spendClientRedeemer: string,
  exUnits: StructuralExUnits,
  proofWitness?: StructuralProofWitness,
) {
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
  if (proofWitness) {
    map.insert(
      CML.RedeemerKey.new(CML.RedeemerTag.Reward, 0n),
      CML.RedeemerVal.new(
        CML.PlutusData.from_cbor_hex(proofWitness.redeemer),
        CML.ExUnits.new(proofWitness.exUnits.mem, proofWitness.exUnits.steps),
      ),
    );
  }
  return CML.Redeemers.new_map_redeemer_key_to_redeemer_val(map);
}

function buildStructuralTransactions(
  hostStateRedeemer: string,
  spendClientRedeemer: string,
  updatedHostStateDatum: string,
  updatedClientDatum: string,
  exUnits: StructuralExUnits,
  proofWitness?: StructuralProofWitness,
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
  body.set_reference_inputs(
    inputList(proofWitness ? [txInput('55'), txInput('66'), txInput('77')] : [txInput('55'), txInput('66')]),
  );
  if (proofWitness) {
    const withdrawals = CML.MapRewardAccountToCoin.new();
    withdrawals.insert(
      CML.RewardAddress.new(0, CML.Credential.new_script(CML.ScriptHash.from_hex(TENDERMINT_PROOF_SCRIPT_HASH))),
      0n,
    );
    body.set_withdrawals(withdrawals);
  }
  body.set_validity_interval_start(120_000_000n);
  body.set_ttl(120_000_600n);
  body.set_network_id(CML.NetworkId.testnet());

  const scriptDataRedeemers = buildRedeemers(hostStateRedeemer, spendClientRedeemer, exUnits, proofWitness);
  body.set_script_data_hash(
    CML.hash_script_data(scriptDataRedeemers, Lucid.createCostModels(Lucid.PROTOCOL_PARAMETERS_DEFAULT.costModels)),
  );

  const unsignedWitnesses = CML.TransactionWitnessSet.new();
  unsignedWitnesses.set_redeemers(buildRedeemers(hostStateRedeemer, spendClientRedeemer, exUnits, proofWitness));
  const unsigned = CML.Transaction.new(body, unsignedWitnesses, true);

  const signingKey = CML.PrivateKey.from_normal_bytes(Buffer.alloc(32, 0x42));
  const vkeys = CML.VkeywitnessList.new();
  vkeys.add(CML.make_vkey_witness(CML.hash_transaction(body), signingKey));
  const signedWitnesses = CML.TransactionWitnessSet.new();
  signedWitnesses.set_redeemers(buildRedeemers(hostStateRedeemer, spendClientRedeemer, exUnits, proofWitness));
  signedWitnesses.set_vkeywitnesses(vkeys);
  const signed = CML.Transaction.new(body, signedWitnesses, true);

  return { unsigned, signed };
}

function inspectShape(transaction: InstanceType<typeof Lucid.CML.Transaction>): CapacityTransactionShape {
  const body = transaction.body();
  const witnesses = transaction.witness_set();
  const redeemers = witnesses.redeemers()?.as_map_redeemer_key_to_redeemer_val();
  const redeemerKeys = redeemers?.keys();
  const tags = redeemerKeys
    ? Array.from({ length: redeemerKeys.len() }, (_, index) => redeemerKeys.get(index).tag())
    : [];
  const spendRedeemers = tags.filter((tag) => tag === Lucid.CML.RedeemerTag.Spend).length;
  return {
    regularInputs: body.inputs().len(),
    scriptInputs: spendRedeemers,
    collateralInputs: body.collateral_inputs()?.len() ?? 0,
    referenceInputs: body.reference_inputs()?.len() ?? 0,
    inlineDatumOutputs: Array.from({ length: body.outputs().len() }, (_, index) => body.outputs().get(index)).filter(
      (output) => output.datum()?.as_datum() !== undefined,
    ).length,
    spendRedeemers,
    rewardRedeemers: tags.filter((tag) => tag === Lucid.CML.RedeemerTag.Reward).length,
    withdrawals: body.withdrawals()?.len() ?? 0,
    vkeyWitnesses: witnesses.vkeywitnesses()?.len() ?? 0,
  };
}

function assertCandidateShape(shape: CapacityTransactionShape, mode: 'direct' | 'sp1'): void {
  const expected: CapacityTransactionShape = {
    regularInputs: 3,
    scriptInputs: 2,
    collateralInputs: 1,
    referenceInputs: mode === 'sp1' ? 3 : 2,
    inlineDatumOutputs: 2,
    spendRedeemers: 2,
    rewardRedeemers: mode === 'sp1' ? 1 : 0,
    withdrawals: mode === 'sp1' ? 1 : 0,
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
  assertCandidateShape(shape, 'direct');

  const signatures = header.signedHeader.commit.signatures;
  const payloads = {
    spendClientRedeemerBytes: byteLength(spendClientRedeemer),
    hostStateRedeemerBytes: byteLength(hostStateRedeemer),
    tendermintProofRedeemerBytes: 0,
    wrappedProofBytes: 0,
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
      mode: 'direct',
      classification: 'structural-signed-lower-bound',
      ledgerEvaluated: false,
      providerCompleted: false,
      balanced: false,
      exUnitsSource,
      validatorCount: header.validatorSet.validators.length,
      trustedValidatorCount: header.trustedValidators.validators.length,
      commitSlots: signatures.length,
      committingSlots: signatures.filter((signature) => signature.block_id_flag === 2n).length,
      absentSlots: signatures.filter((signature) => signature.block_id_flag === 1n).length,
      nilSlots: signatures.filter((signature) => signature.block_id_flag === 3n).length,
      adjacent: header.signedHeader.header.height === header.trustedHeight.revisionHeight + 1n,
      inputConsensusStates: 1,
      outputConsensusStates: 2,
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
        absoluteMargin: {
          mem: (CARDANO_MAX_TX_EX_MEM - totalExUnits.mem).toString(),
          steps: (CARDANO_MAX_TX_EX_STEPS - totalExUnits.steps).toString(),
        },
        safeMargin: {
          mem: (CARDANO_SAFE_TX_EX_MEM - totalExUnits.mem).toString(),
          steps: (CARDANO_SAFE_TX_EX_STEPS - totalExUnits.steps).toString(),
        },
      },
    },
  };
}

type Sp1ProofMetadata = {
  case: string;
  program: string;
  programVkey: string;
  validators: number;
  proofTimeNanos: JsonInteger;
  trustedHeight: { revisionNumber: JsonInteger; revisionHeight: JsonInteger };
  newHeight: { revisionNumber: JsonInteger; revisionHeight: JsonInteger };
  wrappedProof: { bytes: number; path: string; sha256: string };
  publicValues: { bytes: number; path: string; sha256: string };
};

export async function analyzeProofCapacityScenario(
  scenarioName: string,
  scenario: NormalizedCapacityScenario,
  exUnits: ProofStructuralExUnits = STRUCTURAL_PLACEHOLDER_PROOF_EX_UNITS,
  exUnitsSource: ExUnitsSource = 'structural-placeholder',
  artifactPaths: ProofArtifactPaths = {},
): Promise<CapacityScenarioArtifact> {
  const metadataPath = artifactPaths.metadataPath ?? DEFAULT_SP1_PROOF_METADATA_PATH;
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Sp1ProofMetadata;
  const wrappedProofPath =
    artifactPaths.wrappedProofPath ?? path.resolve(path.dirname(metadataPath), metadata.wrappedProof.path);
  const publicValuesPath =
    artifactPaths.publicValuesPath ?? path.resolve(path.dirname(metadataPath), metadata.publicValues.path);
  const wrappedProof = fs.readFileSync(wrappedProofPath);
  const publicValues = fs.readFileSync(publicValuesPath);
  const header = normalizedHeaderToGateway(scenario.header);
  const trustedConsensusState = normalizedConsensusStateToGateway(scenario.trusted_consensus_state);
  const trustedHeight = header.trustedHeight;
  const newHeight: Height = {
    revisionNumber: trustedHeight.revisionNumber,
    revisionHeight: header.signedHeader.header.height,
  };

  if (metadata.case !== 'injective-45') {
    throw new Error(`Expected the injective-45 SP1 artifact; found ${metadata.case}`);
  }
  if (metadata.program !== EUREKA_UPDATE_CLIENT_PROGRAM) {
    throw new Error(`Expected SP1 program ${EUREKA_UPDATE_CLIENT_PROGRAM}; found ${metadata.program}`);
  }
  if (metadata.programVkey !== EUREKA_UPDATE_CLIENT_PROGRAM_VKEY) {
    throw new Error(`Expected SP1 program vkey ${EUREKA_UPDATE_CLIENT_PROGRAM_VKEY}; found ${metadata.programVkey}`);
  }

  if (
    asBigInt(metadata.trustedHeight.revisionNumber, 'metadata.trustedHeight.revisionNumber') !==
      trustedHeight.revisionNumber ||
    asBigInt(metadata.trustedHeight.revisionHeight, 'metadata.trustedHeight.revisionHeight') !==
      trustedHeight.revisionHeight ||
    asBigInt(metadata.newHeight.revisionNumber, 'metadata.newHeight.revisionNumber') !== newHeight.revisionNumber ||
    asBigInt(metadata.newHeight.revisionHeight, 'metadata.newHeight.revisionHeight') !== newHeight.revisionHeight
  ) {
    throw new Error('The SP1 proof metadata does not match the normalized Tendermint scenario heights');
  }
  if (metadata.validators !== header.validatorSet.validators.length) {
    throw new Error(
      `The SP1 proof covers ${metadata.validators} validators, but the scenario contains ${header.validatorSet.validators.length}`,
    );
  }
  if (metadata.wrappedProof.bytes !== wrappedProof.length) {
    throw new Error(
      `The SP1 wrapped proof metadata declares ${metadata.wrappedProof.bytes} bytes; found ${wrappedProof.length}`,
    );
  }
  const wrappedProofSha256 = sha256(wrappedProof);
  if (metadata.wrappedProof.sha256 !== wrappedProofSha256) {
    throw new Error(`The SP1 wrapped proof SHA-256 is ${wrappedProofSha256}; expected ${metadata.wrappedProof.sha256}`);
  }

  if (metadata.publicValues.bytes !== publicValues.length) {
    throw new Error(
      `The SP1 public-values metadata declares ${metadata.publicValues.bytes} bytes; found ${publicValues.length}`,
    );
  }
  const publicValuesSha256 = sha256(publicValues);
  if (metadata.publicValues.sha256 !== publicValuesSha256) {
    throw new Error(`The SP1 public-values SHA-256 is ${publicValuesSha256}; expected ${metadata.publicValues.sha256}`);
  }
  const proofTime = asBigInt(metadata.proofTimeNanos, 'metadata.proofTimeNanos');
  const expectedPublicValues = encodeExpectedEurekaPublicValues(header, trustedConsensusState, proofTime);
  if (!publicValues.equals(expectedPublicValues)) {
    throw new Error('The tracked SP1 public values do not encode the normalized Tendermint scenario');
  }

  const spendClientRedeemer = await encodeSpendClientRedeemer('UpdateClientProof', Lucid);
  const hostStateRedeemer = await encodeHostStateUpdateRedeemer();
  const tendermintProofRedeemer = encodeTendermintProofRedeemer(
    {
      Update: {
        client_input_ref: { transaction_id: '22'.repeat(32), output_index: 0n },
        trusted_height: trustedHeight,
        new_height: newHeight,
        new_consensus_state: {
          timestamp: header.signedHeader.header.time,
          next_validators_hash: header.signedHeader.header.nextValidatorsHash,
          root: { hash: header.signedHeader.header.appHash },
        },
        proof_time: proofTime,
        proof: wrappedProof.toString('hex'),
      },
    },
    Lucid,
  );
  const { updatedClientDatum, updatedHostStateDatum } = await encodeRepresentativeDatums(header, trustedConsensusState);
  const transactions = buildStructuralTransactions(
    hostStateRedeemer,
    spendClientRedeemer,
    updatedHostStateDatum,
    updatedClientDatum,
    exUnits,
    { redeemer: tendermintProofRedeemer, exUnits: exUnits.tendermintProof },
  );
  const unsignedCbor = transactions.unsigned.to_canonical_cbor_hex();
  const signedCbor = transactions.signed.to_canonical_cbor_hex();
  const unsignedBytes = byteLength(unsignedCbor);
  const signedBytes = byteLength(signedCbor);
  const shape = inspectShape(transactions.signed);
  assertCandidateShape(shape, 'sp1');

  const signatures = header.signedHeader.commit.signatures;
  const payloads: CapacityPayloadSizes = {
    spendClientRedeemerBytes: byteLength(spendClientRedeemer),
    hostStateRedeemerBytes: byteLength(hostStateRedeemer),
    tendermintProofRedeemerBytes: byteLength(tendermintProofRedeemer),
    wrappedProofBytes: wrappedProof.length,
    updatedClientDatumBytes: byteLength(updatedClientDatum),
    updatedHostStateDatumBytes: byteLength(updatedHostStateDatum),
    totalBytes: 0,
  };
  payloads.totalBytes =
    payloads.spendClientRedeemerBytes +
    payloads.hostStateRedeemerBytes +
    payloads.tendermintProofRedeemerBytes +
    payloads.updatedClientDatumBytes +
    payloads.updatedHostStateDatumBytes;
  const totalExUnits = {
    mem: exUnits.hostState.mem + exUnits.spendClient.mem + exUnits.tendermintProof.mem,
    steps: exUnits.hostState.steps + exUnits.spendClient.steps + exUnits.tendermintProof.steps,
  };

  return {
    unsignedCbor,
    signedCbor,
    encoded: {
      spendClientRedeemer,
      hostStateRedeemer,
      tendermintProofRedeemer,
      updatedClientDatum,
      updatedHostStateDatum,
    },
    report: {
      scenario: scenarioName,
      mode: 'sp1',
      classification: 'structural-signed-lower-bound',
      ledgerEvaluated: false,
      providerCompleted: false,
      balanced: false,
      exUnitsSource,
      validatorCount: header.validatorSet.validators.length,
      trustedValidatorCount: header.trustedValidators.validators.length,
      commitSlots: signatures.length,
      committingSlots: signatures.filter((signature) => signature.block_id_flag === 2n).length,
      absentSlots: signatures.filter((signature) => signature.block_id_flag === 1n).length,
      nilSlots: signatures.filter((signature) => signature.block_id_flag === 3n).length,
      adjacent: header.signedHeader.header.height === trustedHeight.revisionHeight + 1n,
      inputConsensusStates: 1,
      outputConsensusStates: 2,
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
        tendermintProof: {
          mem: exUnits.tendermintProof.mem.toString(),
          steps: exUnits.tendermintProof.steps.toString(),
        },
        total: { mem: totalExUnits.mem.toString(), steps: totalExUnits.steps.toString() },
        absoluteMargin: {
          mem: (CARDANO_MAX_TX_EX_MEM - totalExUnits.mem).toString(),
          steps: (CARDANO_MAX_TX_EX_STEPS - totalExUnits.steps).toString(),
        },
        safeMargin: {
          mem: (CARDANO_SAFE_TX_EX_MEM - totalExUnits.mem).toString(),
          steps: (CARDANO_SAFE_TX_EX_STEPS - totalExUnits.steps).toString(),
        },
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
      `pub const ${name}_spend_client_redeemer_cbor: ByteArray =\n  #"${redeemer}"`,
      `pub const ${name}_trusted_timestamp: Int = ${trustedConsensusState.timestamp}`,
      `pub const ${name}_trusted_app_hash: ByteArray =\n  #"${trustedConsensusState.root.hash}"`,
      `pub const ${name}_trusted_validator_set_hash: ByteArray =\n  #"${trustedConsensusState.next_validators_hash}"`,
      `pub const ${name}_header_app_hash: ByteArray =\n  #"${header.signedHeader.header.appHash}"`,
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
  const proofExUnits = report.scriptExUnits.tendermintProof
    ? ` proof=${report.scriptExUnits.tendermintProof.mem}/${report.scriptExUnits.tendermintProof.steps}`
    : '';
  return [
    `${report.scenario} (${report.mode}; ${report.classification}; ledger-evaluated=${report.ledgerEvaluated}; provider-completed=${report.providerCompleted}; balanced=${report.balanced})`,
    `  validators: current=${report.validatorCount} trusted=${report.trustedValidatorCount}`,
    `  commit slots: total=${report.commitSlots} commit=${report.committingSlots} absent=${report.absentSlots} nil=${report.nilSlots}`,
    `  consensus history: input=${report.inputConsensusStates} output=${report.outputConsensusStates} removed=${report.removedConsensusStates}`,
    `  exact CBOR: unsigned=${report.unsignedBytes} signed=${report.signedBytes} signing-overhead=${report.signingOverheadBytes}`,
    `  size margins: absolute=${report.absoluteSizeMarginBytes} safe=${report.safeSizeMarginBytes}`,
    `  payload bytes: spend-client=${report.payloads.spendClientRedeemerBytes} host-state=${report.payloads.hostStateRedeemerBytes} proof-redeemer=${report.payloads.tendermintProofRedeemerBytes} wrapped-proof(nested)=${report.payloads.wrappedProofBytes} client-datum=${report.payloads.updatedClientDatumBytes} host-datum=${report.payloads.updatedHostStateDatumBytes} total=${report.payloads.totalBytes}`,
    `  shape: regular-inputs=${report.shape.regularInputs} script-inputs=${report.shape.scriptInputs} collateral=${report.shape.collateralInputs} references=${report.shape.referenceInputs} inline-outputs=${report.shape.inlineDatumOutputs} spend-redeemers=${report.shape.spendRedeemers} reward-redeemers=${report.shape.rewardRedeemers} withdrawals=${report.shape.withdrawals} vkeys=${report.shape.vkeyWitnesses}`,
    `  script ex-units (${report.exUnitsSource}; ledger-evaluated=${report.ledgerEvaluated}): host-state=${report.scriptExUnits.hostState.mem}/${report.scriptExUnits.hostState.steps} spend-client=${report.scriptExUnits.spendClient.mem}/${report.scriptExUnits.spendClient.steps}${proofExUnits} total=${report.scriptExUnits.total.mem}/${report.scriptExUnits.total.steps}`,
    `  ex-unit margins: absolute=${report.scriptExUnits.absoluteMargin.mem}/${report.scriptExUnits.absoluteMargin.steps} safe=${report.scriptExUnits.safeMargin.mem}/${report.scriptExUnits.safeMargin.steps}`,
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
