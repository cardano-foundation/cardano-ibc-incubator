import * as crypto from 'node:crypto';

import * as Lucid from '@lucid-evolution/lucid';

import { type Header } from '@shared/types/header';

import {
  analyzeCapacityScenario,
  CARDANO_MAX_TX_SIZE_BYTES,
  CARDANO_SAFE_TX_SIZE_BYTES,
  loadNormalizedCapacityFixture,
  normalizedHeaderToGateway,
  STRUCTURAL_PLACEHOLDER_EX_UNITS,
  type CapacityTransactionShape,
  type StructuralExUnits,
} from './tendermint-update-capacity';

const HOST_STATE_POLICY_ID = 'a1'.repeat(28);
const HOST_STATE_ASSET_NAME = '484f53545f5354415445';
const CLIENT_POLICY_ID = 'b2'.repeat(28);
const CLIENT_ASSET_NAME = '43'.repeat(32);
const HOST_STATE_SCRIPT_HASH = 'c3'.repeat(28);
const SPEND_CLIENT_SCRIPT_HASH = 'd4'.repeat(28);
const VALIDATOR_SET_REGISTRY_POLICY_ID = 'e7'.repeat(28);
const VALIDATOR_SET_REGISTRY_SCRIPT_HASH = 'e8'.repeat(28);
// Covers the approximate min-UTxO cost of the largest 10.6 KiB inline datum
// under the repository's 4,310 lovelace-per-byte protocol fixture.
const VALIDATOR_SET_REGISTRY_OUTPUT_LOVELACE = 100_000_000n;

const SPARSE_PATH_DEPTH = 64;
const SIGNATURE_BYTES = 64;
const TIMESTAMP_BYTES = 8;
const VOTING_POWER_BYTES = 8;
const VALIDATOR_PUBLIC_KEY_BYTES = 32;

type Validator = Header['validatorSet']['validators'][number];

type SelectedSigner = {
  validatorIndex: number;
  votingPower: bigint;
  timestamp: bigint;
  signature: string;
};

type SyntheticValidatorMaterial = {
  validator: Validator;
  privateKey: crypto.KeyObject;
};

type CompactScenario = {
  name: string;
  source: 'injective-mainnet-fixture' | 'synthetic-equal-power';
  header: Header;
  validators: Validator[];
  selectedSigners: SelectedSigner[];
};

export type CompactCapacityReport = {
  scenario: string;
  source: CompactScenario['source'];
  updateMode: 'adjacent';
  classification: 'structural-signed-lower-bound';
  ledgerEvaluated: false;
  providerCompleted: false;
  balanced: false;
  validatorCount: number;
  signerCount: number;
  signedVotingPower: string;
  totalVotingPower: string;
  strictTwoThirdsQuorum: true;
  compactWitness: {
    signerBitmapBytes: number;
    timestampBlobBytes: number;
    signatureBlobBytes: number;
    encodedSpendClientRedeemerBytes: number;
  };
  validatorSetReference: {
    registrationPolicyImplemented: false;
    hash: string;
    inlineDatumBytes: number;
    bytesSerializedInUpdate: 0;
    updateReferenceInputs: 1;
    registration: {
      classification: 'structural-signed-lower-bound';
      ledgerEvaluated: false;
      providerCompleted: false;
      balanced: false;
      unsignedBytes: number;
      signedBytes: number;
      signingOverheadBytes: number;
      absoluteSizeMarginBytes: number;
      safeSizeMarginBytes: number;
    };
  };
  hostStateProof: {
    allDefaultPrototype: true;
    depth: 64;
    pathCount: 2;
    nonDefaultSiblingCount: 0;
    encodedCompactRedeemerBytes: number;
    encodedFullRedeemerBytes: number;
  };
  payloads: {
    compactSpendClientRedeemerBytes: number;
    compactHostStateRedeemerBytes: number;
    updatedClientDatumBytes: number;
    updatedHostStateDatumBytes: number;
    totalBytes: number;
  };
  unsignedBytes: number;
  signedBytes: number;
  signingOverheadBytes: number;
  absoluteSizeMarginBytes: number;
  safeSizeMarginBytes: number;
  shape: CapacityTransactionShape;
};

export type CompactCapacityArtifact = {
  report: CompactCapacityReport;
  unsignedCbor: string;
  signedCbor: string;
  registrationUnsignedCbor: string;
  registrationSignedCbor: string;
  encoded: {
    spendClientRedeemer: string;
    hostStateRedeemer: string;
    validatorSetReferenceDatum: string;
    updatedClientDatum: string;
    updatedHostStateDatum: string;
  };
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function byteLength(hex: string): number {
  invariant(hex.length % 2 === 0, `Expected even-length hex; found ${hex.length} characters`);
  return hex.length / 2;
}

function hexBytes(value: string, expectedBytes: number, label: string): Buffer {
  invariant(/^[0-9a-f]+$/.test(value), `${label} must be lowercase hexadecimal`);
  invariant(value.length === expectedBytes * 2, `${label} must contain ${expectedBytes} bytes`);
  return Buffer.from(value, 'hex');
}

function sha256(value: crypto.BinaryLike): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

function encodeVarint(value: bigint): Buffer {
  invariant(value >= 0n, `Cannot unsigned-varint encode ${value}`);
  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 0x80n) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }
  bytes.push(Number(remaining));
  return Buffer.from(bytes);
}

function encodeFieldKey(fieldNumber: number, wireType: number): Buffer {
  return encodeVarint(BigInt((fieldNumber << 3) | wireType));
}

function encodeBytesField(fieldNumber: number, value: Buffer): Buffer {
  if (value.length === 0) {
    return Buffer.alloc(0);
  }
  return Buffer.concat([encodeFieldKey(fieldNumber, 2), encodeVarint(BigInt(value.length)), value]);
}

function encodeMessageField(fieldNumber: number, value: Buffer): Buffer {
  return Buffer.concat([encodeFieldKey(fieldNumber, 2), encodeVarint(BigInt(value.length)), value]);
}

function encodeVarintField(fieldNumber: number, value: bigint): Buffer {
  if (value === 0n) {
    return Buffer.alloc(0);
  }
  return Buffer.concat([encodeFieldKey(fieldNumber, 0), encodeVarint(value)]);
}

function encodeSignedFixed64Field(fieldNumber: number, value: bigint): Buffer {
  if (value === 0n) {
    return Buffer.alloc(0);
  }
  const encoded = Buffer.alloc(8);
  encoded.writeBigInt64LE(value);
  return Buffer.concat([encodeFieldKey(fieldNumber, 1), encoded]);
}

function encodeTimestampFromNanoseconds(nanoseconds: bigint): Buffer {
  const seconds = nanoseconds / 1_000_000_000n;
  const nanos = nanoseconds % 1_000_000_000n;
  return Buffer.concat([encodeVarintField(1, seconds), encodeVarintField(2, nanos)]);
}

function encodeBlockId(blockId: Header['signedHeader']['commit']['blockId']): Buffer {
  const partSetHeader = Buffer.concat([
    encodeVarintField(1, blockId.partSetHeader.total),
    encodeBytesField(2, hexBytes(blockId.partSetHeader.hash, 32, 'part-set header hash')),
  ]);
  return Buffer.concat([
    encodeBytesField(1, hexBytes(blockId.hash, 32, 'block ID hash')),
    encodeMessageField(2, partSetHeader),
  ]);
}

function simpleMerkleHash(items: Buffer[]): Buffer {
  if (items.length === 0) {
    return sha256(Buffer.alloc(0));
  }
  if (items.length === 1) {
    return sha256(Buffer.concat([Buffer.from([0]), items[0]]));
  }

  let split = 1;
  while (split * 2 < items.length) {
    split *= 2;
  }
  return sha256(
    Buffer.concat([Buffer.from([1]), simpleMerkleHash(items.slice(0, split)), simpleMerkleHash(items.slice(split))]),
  );
}

/** CometBFT's RFC-6962 hash of ordered SimpleValidator protobuf values. */
export function cometValidatorSetHash(validators: Validator[]): string {
  const leaves = validators.map((validator, index) => {
    const publicKey = encodeBytesField(
      1,
      hexBytes(validator.pubkey, VALIDATOR_PUBLIC_KEY_BYTES, `validators[${index}].pubkey`),
    );
    return Buffer.concat([encodeMessageField(1, publicKey), encodeVarintField(2, validator.votingPower)]);
  });
  return simpleMerkleHash(leaves).toString('hex');
}

/** CometBFT's RFC-6962 hash of the protobuf-encoded header fields. */
export function cometHeaderHash(header: Header['signedHeader']['header']): string {
  const version = Buffer.concat([encodeVarintField(1, header.version.block), encodeVarintField(2, header.version.app)]);
  const protobufBytesField = (value: string, label: string) => encodeBytesField(1, hexBytes(value, 32, label));
  return simpleMerkleHash([
    version,
    encodeBytesField(1, Buffer.from(header.chainId, 'hex')),
    encodeVarintField(1, header.height),
    encodeTimestampFromNanoseconds(header.time),
    encodeBlockId(header.lastBlockId),
    protobufBytesField(header.lastCommitHash, 'last commit hash'),
    protobufBytesField(header.dataHash, 'data hash'),
    protobufBytesField(header.validatorsHash, 'validators hash'),
    protobufBytesField(header.nextValidatorsHash, 'next validators hash'),
    protobufBytesField(header.consensusHash, 'consensus hash'),
    protobufBytesField(header.appHash, 'app hash'),
    protobufBytesField(header.lastResultsHash, 'last results hash'),
    protobufBytesField(header.evidenceHash, 'evidence hash'),
    encodeBytesField(1, hexBytes(header.proposerAddress, 20, 'proposer address')),
  ]).toString('hex');
}

function canonicalVoteSignBytes(
  header: Header,
  timestamp: bigint,
  blockId: Header['signedHeader']['commit']['blockId'],
): Buffer {
  const message = Buffer.concat([
    encodeVarintField(1, 2n),
    encodeSignedFixed64Field(2, header.signedHeader.commit.height),
    encodeSignedFixed64Field(3, header.signedHeader.commit.round),
    encodeMessageField(4, encodeBlockId(blockId)),
    encodeMessageField(5, encodeTimestampFromNanoseconds(timestamp)),
    encodeBytesField(6, Buffer.from(header.signedHeader.header.chainId, 'hex')),
  ]);
  return Buffer.concat([encodeVarint(BigInt(message.length)), message]);
}

function ed25519PrivateKey(seed: Buffer): crypto.KeyObject {
  invariant(seed.length === 32, 'Ed25519 seed must contain 32 bytes');
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  return crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
}

function rawEd25519PublicKey(privateKey: crypto.KeyObject): Buffer {
  const spki = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  invariant(Buffer.isBuffer(spki) && spki.length === 44, 'Unexpected Ed25519 SPKI encoding');
  return spki.subarray(-32);
}

function verifyEd25519(publicKeyHex: string, message: Buffer, signatureHex: string): boolean {
  const spki = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    hexBytes(publicKeyHex, VALIDATOR_PUBLIC_KEY_BYTES, 'Ed25519 public key'),
  ]);
  const publicKey = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
  return crypto.verify(null, message, publicKey, hexBytes(signatureHex, SIGNATURE_BYTES, 'Ed25519 signature'));
}

function totalVotingPower(validators: Validator[]): bigint {
  return validators.reduce((total, validator) => total + validator.votingPower, 0n);
}

function validatorAddress(pubkey: string): string {
  return sha256(hexBytes(pubkey, VALIDATOR_PUBLIC_KEY_BYTES, 'validator public key'))
    .subarray(0, 20)
    .toString('hex');
}

function validateValidatorSet(validators: Validator[], expectedHash: string): bigint {
  invariant(validators.length > 0, 'Validator set must not be empty');
  const seenAddresses = new Set<string>();
  validators.forEach((validator, index) => {
    invariant(validator.votingPower > 0n, `validators[${index}].votingPower must be positive`);
    invariant(
      validator.address === validatorAddress(validator.pubkey),
      `validators[${index}].address is not sha256(pubkey)[0:20]`,
    );
    invariant(!seenAddresses.has(validator.address), `validators[${index}].address is duplicated`);
    seenAddresses.add(validator.address);

    if (index > 0) {
      const previous = validators[index - 1];
      invariant(
        previous.votingPower > validator.votingPower ||
          (previous.votingPower === validator.votingPower && previous.address < validator.address),
        `validators[${index}] is not in canonical voting-power/address order`,
      );
    }
  });
  invariant(cometValidatorSetHash(validators) === expectedHash, 'Validator set does not match header.validatorsHash');
  return totalVotingPower(validators);
}

function selectInjectiveQuorum(header: Header): SelectedSigner[] {
  const validators = header.validatorSet.validators;
  const signatures = header.signedHeader.commit.signatures;
  invariant(signatures.length === validators.length, 'Injective fixture commit slots must match its validator count');

  const candidates = validators.flatMap((validator, validatorIndex) => {
    const commit = signatures[validatorIndex];
    if (commit.block_id_flag !== 2n) {
      return [];
    }
    invariant(
      commit.validator_address === validator.address,
      `Commit slot ${validatorIndex} does not match its validator address`,
    );
    hexBytes(commit.signature, SIGNATURE_BYTES, `commit.signatures[${validatorIndex}].signature`);
    invariant(
      verifyEd25519(
        validator.pubkey,
        canonicalVoteSignBytes(header, commit.timestamp, header.signedHeader.commit.blockId),
        commit.signature,
      ),
      `Commit slot ${validatorIndex} is not a valid canonical Tendermint Ed25519 signature`,
    );
    return [
      {
        validatorIndex,
        votingPower: validator.votingPower,
        timestamp: commit.timestamp,
        signature: commit.signature,
      },
    ];
  });

  candidates.sort((left, right) => {
    if (left.votingPower !== right.votingPower) {
      return left.votingPower > right.votingPower ? -1 : 1;
    }
    return left.validatorIndex - right.validatorIndex;
  });
  const total = totalVotingPower(validators);
  let signed = 0n;
  const selected: SelectedSigner[] = [];
  for (const candidate of candidates) {
    selected.push(candidate);
    signed += candidate.votingPower;
    if (signed * 3n > total * 2n) {
      break;
    }
  }
  invariant(signed * 3n > total * 2n, 'Injective fixture does not contain a strict two-thirds commit quorum');
  return selected.sort((left, right) => left.validatorIndex - right.validatorIndex);
}

function syntheticBytes(domain: string, validatorCount: number, index: number, length: number): Buffer {
  const chunks: Buffer[] = [];
  let counter = 0;
  while (Buffer.concat(chunks).length < length) {
    chunks.push(sha256(`${domain}:${validatorCount}:${index}:${counter}`));
    counter += 1;
  }
  return Buffer.concat(chunks).subarray(0, length);
}

function syntheticValidatorSet(validatorCount: number): SyntheticValidatorMaterial[] {
  const materials = Array.from({ length: validatorCount }, (_, index) => {
    const privateKey = ed25519PrivateKey(syntheticBytes('validator-seed', validatorCount, index, 32));
    const pubkey = rawEd25519PublicKey(privateKey).toString('hex');
    return {
      privateKey,
      validator: {
        address: validatorAddress(pubkey),
        pubkey,
        votingPower: 1n,
        proposerPriority: 0n,
      },
    };
  });
  return materials.sort((left, right) => left.validator.address.localeCompare(right.validator.address));
}

function syntheticQuorum(materials: SyntheticValidatorMaterial[], header: Header): SelectedSigner[] {
  const signerCount = Math.floor((materials.length * 2) / 3) + 1;
  return materials.slice(0, signerCount).map(({ validator, privateKey }, validatorIndex) => {
    const timestamp = header.signedHeader.header.time + BigInt(validatorIndex);
    const signBytes = canonicalVoteSignBytes(header, timestamp, header.signedHeader.commit.blockId);
    const signature = crypto.sign(null, signBytes, privateKey).toString('hex');
    invariant(
      verifyEd25519(validator.pubkey, signBytes, signature),
      `Synthetic signature ${validatorIndex} failed canonical vote verification`,
    );
    return { validatorIndex, votingPower: validator.votingPower, timestamp, signature };
  });
}

function cloneHeaderWithValidatorSet(header: Header, validators: Validator[]): Header {
  const validatorSetHash = cometValidatorSetHash(validators);
  const withValidatorSet: Header = {
    ...header,
    signedHeader: {
      ...header.signedHeader,
      header: {
        ...header.signedHeader.header,
        validatorsHash: validatorSetHash,
        nextValidatorsHash: validatorSetHash,
        proposerAddress: validators[0].address,
      },
    },
    validatorSet: {
      validators,
      proposer: validators[0],
      totalVotingPower: totalVotingPower(validators),
    },
  };
  return {
    ...withValidatorSet,
    signedHeader: {
      ...withValidatorSet.signedHeader,
      commit: {
        ...withValidatorSet.signedHeader.commit,
        blockId: {
          ...withValidatorSet.signedHeader.commit.blockId,
          hash: cometHeaderHash(withValidatorSet.signedHeader.header),
        },
      },
    },
  };
}

function packSigned64(value: bigint, label: string): Buffer {
  invariant(value >= -(1n << 63n) && value < 1n << 63n, `${label} does not fit a signed 64-bit integer`);
  const encoded = Buffer.alloc(8);
  encoded.writeBigInt64BE(value);
  return encoded;
}

function encodeSignerBitmap(validatorCount: number, signers: SelectedSigner[]): Buffer {
  const bitmap = Buffer.alloc(Math.ceil(validatorCount / 8));
  let previousIndex = -1;
  for (const signer of signers) {
    invariant(signer.validatorIndex > previousIndex, 'Selected signer indices must be unique and ascending');
    invariant(signer.validatorIndex < validatorCount, `Signer index ${signer.validatorIndex} is out of range`);
    bitmap[signer.validatorIndex >> 3] |= 1 << (signer.validatorIndex & 7);
    previousIndex = signer.validatorIndex;
  }
  return bitmap;
}

export function signerIndicesFromBitmap(bitmap: Buffer, validatorCount: number): number[] {
  invariant(bitmap.length === Math.ceil(validatorCount / 8), 'Signer bitmap length does not match validator count');
  const indices: number[] = [];
  for (let index = 0; index < validatorCount; index += 1) {
    if ((bitmap[index >> 3] & (1 << (index & 7))) !== 0) {
      indices.push(index);
    }
  }
  const unusedBits = bitmap.length * 8 - validatorCount;
  if (unusedBits > 0) {
    const usedBitsInLastByte = 8 - unusedBits;
    invariant(
      bitmap[bitmap.length - 1] >> usedBitsInLastByte === 0,
      'Signer bitmap has non-zero bits outside the validator set',
    );
  }
  return indices;
}

function packedCommitWitness(validatorCount: number, signers: SelectedSigner[]) {
  const signerBitmap = encodeSignerBitmap(validatorCount, signers);
  const timestamps = Buffer.concat(
    signers.map((signer, index) => packSigned64(signer.timestamp, `signers[${index}].timestamp`)),
  );
  const signatures = Buffer.concat(
    signers.map((signer, index) => hexBytes(signer.signature, SIGNATURE_BYTES, `signers[${index}].signature`)),
  );
  invariant(timestamps.length === signers.length * TIMESTAMP_BYTES, 'Packed timestamp length is inconsistent');
  invariant(signatures.length === signers.length * SIGNATURE_BYTES, 'Packed signature length is inconsistent');
  invariant(
    signerIndicesFromBitmap(signerBitmap, validatorCount).every(
      (validatorIndex, index) => validatorIndex === signers[index].validatorIndex,
    ),
    'Signer bitmap does not round-trip to the selected indices',
  );
  return { signerBitmap, timestamps, signatures };
}

function encodeCompactSpendClientRedeemer(scenario: CompactScenario): {
  cbor: string;
  signerBitmapBytes: number;
  timestampBlobBytes: number;
  signatureBlobBytes: number;
} {
  const { Data } = Lucid;
  const PartSetHeaderSchema = Data.Object({ total: Data.Integer(), hash: Data.Bytes() });
  const BlockIdSchema = Data.Object({ hash: Data.Bytes(), partSetHeader: PartSetHeaderSchema });
  const ConsensusVersionSchema = Data.Object({ block: Data.Integer(), app: Data.Integer() });
  const TmHeaderSchema = Data.Object({
    version: ConsensusVersionSchema,
    chainId: Data.Bytes(),
    height: Data.Integer(),
    time: Data.Integer(),
    lastBlockId: BlockIdSchema,
    lastCommitHash: Data.Bytes(),
    dataHash: Data.Bytes(),
    validatorsHash: Data.Bytes(),
    nextValidatorsHash: Data.Bytes(),
    consensusHash: Data.Bytes(),
    appHash: Data.Bytes(),
    lastResultsHash: Data.Bytes(),
    evidenceHash: Data.Bytes(),
    proposerAddress: Data.Bytes(),
  });
  const HeightSchema = Data.Object({ revisionNumber: Data.Integer(), revisionHeight: Data.Integer() });
  const CompactCommitSchema = Data.Object({
    round: Data.Integer(),
    blockId: BlockIdSchema,
    signerBitmap: Data.Bytes(),
    timestamps: Data.Bytes(),
    signatures: Data.Bytes(),
  });
  const CompactHeaderSchema = Data.Object({
    header: TmHeaderSchema,
    commit: CompactCommitSchema,
    trustedHeight: HeightSchema,
  });
  const RedeemerSchema = Data.Enum([
    Data.Object({ CompactUpdateClient: Data.Object({ header: CompactHeaderSchema }) }),
    Data.Literal('Other'),
  ]);
  const packed = packedCommitWitness(scenario.validators.length, scenario.selectedSigners);
  const value = {
    CompactUpdateClient: {
      header: {
        header: scenario.header.signedHeader.header,
        commit: {
          round: scenario.header.signedHeader.commit.round,
          blockId: scenario.header.signedHeader.commit.blockId,
          signerBitmap: packed.signerBitmap.toString('hex'),
          timestamps: packed.timestamps.toString('hex'),
          signatures: packed.signatures.toString('hex'),
        },
        trustedHeight: scenario.header.trustedHeight,
      },
    },
  };
  return {
    cbor: Data.to(value as never, RedeemerSchema as never, { canonical: true }),
    signerBitmapBytes: packed.signerBitmap.length,
    timestampBlobBytes: packed.timestamps.length,
    signatureBlobBytes: packed.signatures.length,
  };
}

function encodeCompactHostStateRedeemer(): string {
  const { Data } = Lucid;
  const SparsePathSchema = Data.Object({ nonDefaultBitmap: Data.Bytes(), siblings: Data.Bytes() });
  const RedeemerSchema = Data.Enum([
    Data.Object({
      CompactUpdateClient: Data.Object({
        clientStatePath: SparsePathSchema,
        consensusStatePath: SparsePathSchema,
        removedConsensusStatePaths: Data.Array(SparsePathSchema),
      }),
    }),
    Data.Literal('Other'),
  ]);
  const defaultPath = { nonDefaultBitmap: '00'.repeat(SPARSE_PATH_DEPTH / 8), siblings: '' };
  return Data.to(
    {
      CompactUpdateClient: {
        clientStatePath: defaultPath,
        consensusStatePath: defaultPath,
        removedConsensusStatePaths: [],
      },
    } as never,
    RedeemerSchema as never,
    { canonical: true },
  );
}

function encodeValidatorSetReferenceDatum(validators: Validator[], expectedHash: string): string {
  const { Data } = Lucid;
  const DatumSchema = Data.Object({
    formatVersion: Data.Integer(),
    validatorSetHash: Data.Bytes(),
    validatorCount: Data.Integer(),
    publicKeys: Data.Bytes(),
    votingPowers: Data.Bytes(),
    totalVotingPower: Data.Integer(),
  });
  const totalPower = validateValidatorSet(validators, expectedHash);
  const publicKeys = Buffer.concat(
    validators.map((validator, index) =>
      hexBytes(validator.pubkey, VALIDATOR_PUBLIC_KEY_BYTES, `validators[${index}].pubkey`),
    ),
  );
  const votingPowers = Buffer.concat(
    validators.map((validator, index) => packSigned64(validator.votingPower, `validators[${index}].votingPower`)),
  );
  invariant(
    publicKeys.length === validators.length * VALIDATOR_PUBLIC_KEY_BYTES,
    'Public-key blob length is inconsistent',
  );
  invariant(votingPowers.length === validators.length * VOTING_POWER_BYTES, 'Voting-power blob length is inconsistent');
  return Data.to(
    {
      formatVersion: 1n,
      validatorSetHash: expectedHash,
      validatorCount: BigInt(validators.length),
      publicKeys: publicKeys.toString('hex'),
      votingPowers: votingPowers.toString('hex'),
      totalVotingPower: totalPower,
    } as never,
    DatumSchema as never,
    { canonical: true },
  );
}

function txInput(hashByte: string, index = 0n) {
  return Lucid.CML.TransactionInput.new(Lucid.CML.TransactionHash.from_hex(hashByte.repeat(32)), index);
}

function inputList(inputs: ReturnType<typeof txInput>[]) {
  const list = Lucid.CML.TransactionInputList.new();
  inputs.forEach((input) => list.add(input));
  return list;
}

function nftValue(policyId: string, assetName: string, lovelace: bigint) {
  const assets = Lucid.CML.MultiAsset.new();
  assets.set(
    Lucid.CML.ScriptHash.from_hex(policyId),
    Lucid.CML.AssetName.from_raw_bytes(Buffer.from(assetName, 'hex')),
    1n,
  );
  return Lucid.CML.Value.new(lovelace, assets);
}

function scriptAddress(scriptHash: string) {
  return Lucid.CML.EnterpriseAddress.new(
    0,
    Lucid.CML.Credential.new_script(Lucid.CML.ScriptHash.from_hex(scriptHash)),
  ).to_address();
}

function outputList(updatedHostStateDatum: string, updatedClientDatum: string) {
  const outputs = Lucid.CML.TransactionOutputList.new();
  outputs.add(
    Lucid.CML.TransactionOutput.new(
      scriptAddress(HOST_STATE_SCRIPT_HASH),
      nftValue(HOST_STATE_POLICY_ID, HOST_STATE_ASSET_NAME, 5_000_000n),
      Lucid.CML.DatumOption.new_datum(Lucid.CML.PlutusData.from_cbor_hex(updatedHostStateDatum)),
    ),
  );
  outputs.add(
    Lucid.CML.TransactionOutput.new(
      scriptAddress(SPEND_CLIENT_SCRIPT_HASH),
      nftValue(CLIENT_POLICY_ID, CLIENT_ASSET_NAME, 5_000_000n),
      Lucid.CML.DatumOption.new_datum(Lucid.CML.PlutusData.from_cbor_hex(updatedClientDatum)),
    ),
  );
  return outputs;
}

function buildRedeemers(hostStateRedeemer: string, spendClientRedeemer: string, exUnits: StructuralExUnits) {
  const redeemers = Lucid.CML.MapRedeemerKeyToRedeemerVal.new();
  redeemers.insert(
    Lucid.CML.RedeemerKey.new(Lucid.CML.RedeemerTag.Spend, 0n),
    Lucid.CML.RedeemerVal.new(
      Lucid.CML.PlutusData.from_cbor_hex(hostStateRedeemer),
      Lucid.CML.ExUnits.new(exUnits.hostState.mem, exUnits.hostState.steps),
    ),
  );
  redeemers.insert(
    Lucid.CML.RedeemerKey.new(Lucid.CML.RedeemerTag.Spend, 1n),
    Lucid.CML.RedeemerVal.new(
      Lucid.CML.PlutusData.from_cbor_hex(spendClientRedeemer),
      Lucid.CML.ExUnits.new(exUnits.spendClient.mem, exUnits.spendClient.steps),
    ),
  );
  return Lucid.CML.Redeemers.new_map_redeemer_key_to_redeemer_val(redeemers);
}

function buildStructuralTransactions(
  hostStateRedeemer: string,
  spendClientRedeemer: string,
  updatedHostStateDatum: string,
  updatedClientDatum: string,
  exUnits: StructuralExUnits,
) {
  const body = Lucid.CML.TransactionBody.new(
    inputList([txInput('11'), txInput('22'), txInput('33')]),
    outputList(updatedHostStateDatum, updatedClientDatum),
    2_000_000n,
  );
  body.set_collateral_inputs(inputList([txInput('44')]));
  body.set_total_collateral(5_000_000n);
  // Two reference scripts plus one candidate validator-set reference UTxO.
  // The prototype models its datum but does not implement the registry policy
  // that must authenticate this input in production.
  body.set_reference_inputs(inputList([txInput('55'), txInput('66'), txInput('77')]));
  body.set_validity_interval_start(120_000_000n);
  body.set_ttl(120_000_600n);
  body.set_network_id(Lucid.CML.NetworkId.testnet());

  const scriptDataRedeemers = buildRedeemers(hostStateRedeemer, spendClientRedeemer, exUnits);
  body.set_script_data_hash(
    Lucid.CML.hash_script_data(
      scriptDataRedeemers,
      Lucid.createCostModels(Lucid.PROTOCOL_PARAMETERS_DEFAULT.costModels),
    ),
  );

  const unsignedWitnesses = Lucid.CML.TransactionWitnessSet.new();
  unsignedWitnesses.set_redeemers(buildRedeemers(hostStateRedeemer, spendClientRedeemer, exUnits));
  const unsigned = Lucid.CML.Transaction.new(body, unsignedWitnesses, true);

  const signingKey = Lucid.CML.PrivateKey.from_normal_bytes(Buffer.alloc(32, 0x42));
  const vkeys = Lucid.CML.VkeywitnessList.new();
  vkeys.add(Lucid.CML.make_vkey_witness(Lucid.CML.hash_transaction(body), signingKey));
  const signedWitnesses = Lucid.CML.TransactionWitnessSet.new();
  signedWitnesses.set_redeemers(buildRedeemers(hostStateRedeemer, spendClientRedeemer, exUnits));
  signedWitnesses.set_vkeywitnesses(vkeys);
  const signed = Lucid.CML.Transaction.new(body, signedWitnesses, true);

  return { unsigned, signed };
}

function buildRegistrationRedeemers(exUnits: StructuralExUnits) {
  const redeemers = Lucid.CML.MapRedeemerKeyToRedeemerVal.new();
  const unitRedeemer = Lucid.Data.to(new Lucid.Constr(0, []), undefined, { canonical: true });
  redeemers.insert(
    Lucid.CML.RedeemerKey.new(Lucid.CML.RedeemerTag.Mint, 0n),
    Lucid.CML.RedeemerVal.new(
      Lucid.CML.PlutusData.from_cbor_hex(unitRedeemer),
      Lucid.CML.ExUnits.new(exUnits.spendClient.mem, exUnits.spendClient.steps),
    ),
  );
  return Lucid.CML.Redeemers.new_map_redeemer_key_to_redeemer_val(redeemers);
}

function buildValidatorSetRegistrationTransactions(
  validatorSetReferenceDatum: string,
  validatorSetHash: string,
  exUnits: StructuralExUnits,
) {
  const outputs = Lucid.CML.TransactionOutputList.new();
  outputs.add(
    Lucid.CML.TransactionOutput.new(
      scriptAddress(VALIDATOR_SET_REGISTRY_SCRIPT_HASH),
      nftValue(VALIDATOR_SET_REGISTRY_POLICY_ID, validatorSetHash, VALIDATOR_SET_REGISTRY_OUTPUT_LOVELACE),
      Lucid.CML.DatumOption.new_datum(Lucid.CML.PlutusData.from_cbor_hex(validatorSetReferenceDatum)),
    ),
  );
  const body = Lucid.CML.TransactionBody.new(inputList([txInput('88')]), outputs, 2_000_000n);
  body.set_collateral_inputs(inputList([txInput('99')]));
  body.set_total_collateral(5_000_000n);
  body.set_reference_inputs(inputList([txInput('aa')]));
  body.set_validity_interval_start(120_000_000n);
  body.set_ttl(120_000_600n);
  body.set_network_id(Lucid.CML.NetworkId.testnet());
  const mint = Lucid.CML.Mint.new();
  mint.set(
    Lucid.CML.ScriptHash.from_hex(VALIDATOR_SET_REGISTRY_POLICY_ID),
    Lucid.CML.AssetName.from_raw_bytes(Buffer.from(validatorSetHash, 'hex')),
    1n,
  );
  body.set_mint(mint);

  const scriptDataRedeemers = buildRegistrationRedeemers(exUnits);
  body.set_script_data_hash(
    Lucid.CML.hash_script_data(
      scriptDataRedeemers,
      Lucid.createCostModels(Lucid.PROTOCOL_PARAMETERS_DEFAULT.costModels),
    ),
  );

  const unsignedWitnesses = Lucid.CML.TransactionWitnessSet.new();
  unsignedWitnesses.set_redeemers(buildRegistrationRedeemers(exUnits));
  const unsigned = Lucid.CML.Transaction.new(body, unsignedWitnesses, true);

  const signingKey = Lucid.CML.PrivateKey.from_normal_bytes(Buffer.alloc(32, 0x24));
  const vkeys = Lucid.CML.VkeywitnessList.new();
  vkeys.add(Lucid.CML.make_vkey_witness(Lucid.CML.hash_transaction(body), signingKey));
  const signedWitnesses = Lucid.CML.TransactionWitnessSet.new();
  signedWitnesses.set_redeemers(buildRegistrationRedeemers(exUnits));
  signedWitnesses.set_vkeywitnesses(vkeys);
  const signed = Lucid.CML.Transaction.new(body, signedWitnesses, true);
  return { unsigned, signed };
}

function inspectShape(transaction: InstanceType<typeof Lucid.CML.Transaction>): CapacityTransactionShape {
  const body = transaction.body();
  const witnesses = transaction.witness_set();
  return {
    regularInputs: body.inputs().len(),
    scriptInputs: 2,
    collateralInputs: body.collateral_inputs()?.len() ?? 0,
    referenceInputs: body.reference_inputs()?.len() ?? 0,
    inlineDatumOutputs: Array.from({ length: body.outputs().len() }, (_, index) => body.outputs().get(index)).filter(
      (output) => output.datum()?.as_datum() !== undefined,
    ).length,
    spendRedeemers: witnesses.redeemers()?.as_map_redeemer_key_to_redeemer_val()?.len() ?? 0,
    vkeyWitnesses: witnesses.vkeywitnesses()?.len() ?? 0,
  };
}

function assertStructuralShape(shape: CapacityTransactionShape): void {
  const expected: CapacityTransactionShape = {
    regularInputs: 3,
    scriptInputs: 2,
    collateralInputs: 1,
    referenceInputs: 3,
    inlineDatumOutputs: 2,
    spendRedeemers: 2,
    vkeyWitnesses: 1,
  };
  for (const key of Object.keys(expected) as Array<keyof CapacityTransactionShape>) {
    invariant(
      shape[key] === expected[key],
      `Structural transaction ${key} must be ${expected[key]}; found ${shape[key]}`,
    );
  }
}

async function analyzeCompactScenario(
  scenario: CompactScenario,
  sharedPayloads: {
    updatedClientDatum: string;
    updatedHostStateDatum: string;
    fullHostStateRedeemerBytes: number;
  },
): Promise<CompactCapacityArtifact> {
  const spendClient = encodeCompactSpendClientRedeemer(scenario);
  const hostStateRedeemer = encodeCompactHostStateRedeemer();
  const validatorSetHash = scenario.header.signedHeader.header.validatorsHash;
  const validatorSetReferenceDatum = encodeValidatorSetReferenceDatum(scenario.validators, validatorSetHash);
  const registrationTransactions = buildValidatorSetRegistrationTransactions(
    validatorSetReferenceDatum,
    validatorSetHash,
    STRUCTURAL_PLACEHOLDER_EX_UNITS,
  );
  const transactions = buildStructuralTransactions(
    hostStateRedeemer,
    spendClient.cbor,
    sharedPayloads.updatedHostStateDatum,
    sharedPayloads.updatedClientDatum,
    STRUCTURAL_PLACEHOLDER_EX_UNITS,
  );
  const unsignedCbor = transactions.unsigned.to_canonical_cbor_hex();
  const signedCbor = transactions.signed.to_canonical_cbor_hex();
  const registrationUnsignedCbor = registrationTransactions.unsigned.to_canonical_cbor_hex();
  const registrationSignedCbor = registrationTransactions.signed.to_canonical_cbor_hex();
  const shape = inspectShape(transactions.signed);
  assertStructuralShape(shape);

  const signedVotingPower = scenario.selectedSigners.reduce((total, signer) => total + signer.votingPower, 0n);
  const totalPower = totalVotingPower(scenario.validators);
  invariant(signedVotingPower * 3n > totalPower * 2n, `${scenario.name} does not have a strict two-thirds quorum`);

  const payloads = {
    compactSpendClientRedeemerBytes: byteLength(spendClient.cbor),
    compactHostStateRedeemerBytes: byteLength(hostStateRedeemer),
    updatedClientDatumBytes: byteLength(sharedPayloads.updatedClientDatum),
    updatedHostStateDatumBytes: byteLength(sharedPayloads.updatedHostStateDatum),
    totalBytes: 0,
  };
  payloads.totalBytes =
    payloads.compactSpendClientRedeemerBytes +
    payloads.compactHostStateRedeemerBytes +
    payloads.updatedClientDatumBytes +
    payloads.updatedHostStateDatumBytes;
  const unsignedBytes = byteLength(unsignedCbor);
  const signedBytes = byteLength(signedCbor);

  return {
    unsignedCbor,
    signedCbor,
    registrationUnsignedCbor,
    registrationSignedCbor,
    encoded: {
      spendClientRedeemer: spendClient.cbor,
      hostStateRedeemer,
      validatorSetReferenceDatum,
      updatedClientDatum: sharedPayloads.updatedClientDatum,
      updatedHostStateDatum: sharedPayloads.updatedHostStateDatum,
    },
    report: {
      scenario: scenario.name,
      source: scenario.source,
      updateMode: 'adjacent',
      classification: 'structural-signed-lower-bound',
      ledgerEvaluated: false,
      providerCompleted: false,
      balanced: false,
      validatorCount: scenario.validators.length,
      signerCount: scenario.selectedSigners.length,
      signedVotingPower: signedVotingPower.toString(),
      totalVotingPower: totalPower.toString(),
      strictTwoThirdsQuorum: true,
      compactWitness: {
        signerBitmapBytes: spendClient.signerBitmapBytes,
        timestampBlobBytes: spendClient.timestampBlobBytes,
        signatureBlobBytes: spendClient.signatureBlobBytes,
        encodedSpendClientRedeemerBytes: payloads.compactSpendClientRedeemerBytes,
      },
      validatorSetReference: {
        registrationPolicyImplemented: false,
        hash: validatorSetHash,
        inlineDatumBytes: byteLength(validatorSetReferenceDatum),
        bytesSerializedInUpdate: 0,
        updateReferenceInputs: 1,
        registration: {
          classification: 'structural-signed-lower-bound',
          ledgerEvaluated: false,
          providerCompleted: false,
          balanced: false,
          unsignedBytes: byteLength(registrationUnsignedCbor),
          signedBytes: byteLength(registrationSignedCbor),
          signingOverheadBytes: byteLength(registrationSignedCbor) - byteLength(registrationUnsignedCbor),
          absoluteSizeMarginBytes: CARDANO_MAX_TX_SIZE_BYTES - byteLength(registrationSignedCbor),
          safeSizeMarginBytes: CARDANO_SAFE_TX_SIZE_BYTES - byteLength(registrationSignedCbor),
        },
      },
      hostStateProof: {
        allDefaultPrototype: true,
        depth: SPARSE_PATH_DEPTH,
        pathCount: 2,
        nonDefaultSiblingCount: 0,
        encodedCompactRedeemerBytes: payloads.compactHostStateRedeemerBytes,
        encodedFullRedeemerBytes: sharedPayloads.fullHostStateRedeemerBytes,
      },
      payloads,
      unsignedBytes,
      signedBytes,
      signingOverheadBytes: signedBytes - unsignedBytes,
      absoluteSizeMarginBytes: CARDANO_MAX_TX_SIZE_BYTES - signedBytes,
      safeSizeMarginBytes: CARDANO_SAFE_TX_SIZE_BYTES - signedBytes,
      shape,
    },
  };
}

export async function analyzeCompactTendermintUpdateCapacity(): Promise<CompactCapacityArtifact[]> {
  const fixture = loadNormalizedCapacityFixture();
  const fixtureScenario = fixture.scenarios.adjacent_all_signed;
  const fixtureHeader = normalizedHeaderToGateway(fixtureScenario.header);
  const baseline = await analyzeCapacityScenario('adjacent_all_signed', fixtureScenario);

  const fixtureTotal = validateValidatorSet(
    fixtureHeader.validatorSet.validators,
    fixtureHeader.signedHeader.header.validatorsHash,
  );
  invariant(
    fixtureTotal === fixtureHeader.validatorSet.totalVotingPower,
    'Fixture relayed total voting power differs from the validator entries',
  );

  const scenarios: CompactScenario[] = [
    {
      name: 'injective-45-minimum-power-quorum',
      source: 'injective-mainnet-fixture',
      header: fixtureHeader,
      validators: fixtureHeader.validatorSet.validators,
      selectedSigners: selectInjectiveQuorum(fixtureHeader),
    },
    ...[200, 256].map((validatorCount): CompactScenario => {
      const materials = syntheticValidatorSet(validatorCount);
      const validators = materials.map(({ validator }) => validator);
      invariant(
        new Set(validators.map(({ pubkey }) => pubkey)).size === validatorCount,
        `Synthetic ${validatorCount}-validator set must contain unique Ed25519 keys`,
      );
      const header = cloneHeaderWithValidatorSet(fixtureHeader, validators);
      return {
        name: `equal-power-${validatorCount}-minimum-quorum`,
        source: 'synthetic-equal-power',
        header,
        validators,
        selectedSigners: syntheticQuorum(materials, header),
      };
    }),
  ];

  const sharedPayloads = {
    updatedClientDatum: baseline.encoded.updatedClientDatum,
    updatedHostStateDatum: baseline.encoded.updatedHostStateDatum,
    fullHostStateRedeemerBytes: byteLength(baseline.encoded.hostStateRedeemer),
  };
  const artifacts = await Promise.all(scenarios.map((scenario) => analyzeCompactScenario(scenario, sharedPayloads)));
  assertPrototypeResults(artifacts);
  return artifacts;
}

export function assertPrototypeResults(artifacts: CompactCapacityArtifact[]): void {
  invariant(artifacts.length === 3, `Expected three compact capacity scenarios; found ${artifacts.length}`);
  const byCount = new Map(artifacts.map((artifact) => [artifact.report.validatorCount, artifact.report]));
  const injective = byCount.get(45);
  const equalPower200 = byCount.get(200);
  const equalPower256 = byCount.get(256);
  invariant(
    injective?.signerCount === 15,
    `Injective minimum quorum must contain 15 signers; found ${injective?.signerCount}`,
  );
  invariant(equalPower200?.signerCount === 134, 'A 200-validator equal-power quorum must contain 134 signers');
  invariant(equalPower256?.signerCount === 171, 'A 256-validator equal-power quorum must contain 171 signers');
  for (const artifact of artifacts) {
    const report = artifact.report;
    invariant(report.signedBytes > report.unsignedBytes, `${report.scenario} signed transaction must include a vkey`);
    invariant(report.shape.referenceInputs === 3, `${report.scenario} must include one validator-set reference input`);
    invariant(
      !report.validatorSetReference.registrationPolicyImplemented,
      `${report.scenario} must remain explicitly marked as a registry-policy prototype`,
    );
    invariant(
      report.validatorSetReference.bytesSerializedInUpdate === 0,
      `${report.scenario} must not serialize the referenced validator set in the update`,
    );
    invariant(
      report.hostStateProof.encodedCompactRedeemerBytes < report.hostStateProof.encodedFullRedeemerBytes,
      `${report.scenario} compact HostState proof must be smaller than the full proof`,
    );
    invariant(
      report.compactWitness.timestampBlobBytes === report.signerCount * TIMESTAMP_BYTES,
      `${report.scenario} timestamp blob length is inconsistent`,
    );
    invariant(
      report.compactWitness.signatureBlobBytes === report.signerCount * SIGNATURE_BYTES,
      `${report.scenario} signature blob length is inconsistent`,
    );
  }
}

export function formatCompactCapacityReport(report: CompactCapacityReport): string {
  return [
    `${report.scenario} (${report.updateMode}; ${report.classification}; ledger-evaluated=${report.ledgerEvaluated}; provider-completed=${report.providerCompleted}; balanced=${report.balanced})`,
    `  validators=${report.validatorCount} signers=${report.signerCount} signed-power=${report.signedVotingPower}/${report.totalVotingPower} strict->2/3=${report.strictTwoThirdsQuorum}`,
    `  compact witness bytes: bitmap=${report.compactWitness.signerBitmapBytes} timestamps=${report.compactWitness.timestampBlobBytes} signatures=${report.compactWitness.signatureBlobBytes} spend-redeemer=${report.compactWitness.encodedSpendClientRedeemerBytes}`,
    `  validator-set reference: datum=${report.validatorSetReference.inlineDatumBytes} serialized-in-update=${report.validatorSetReference.bytesSerializedInUpdate} reference-inputs=${report.validatorSetReference.updateReferenceInputs} registry-policy-implemented=${report.validatorSetReference.registrationPolicyImplemented} hash=${report.validatorSetReference.hash}`,
    `  validator-set registration (${report.validatorSetReference.registration.classification}; ledger-evaluated=${report.validatorSetReference.registration.ledgerEvaluated}; provider-completed=${report.validatorSetReference.registration.providerCompleted}; balanced=${report.validatorSetReference.registration.balanced}): unsigned=${report.validatorSetReference.registration.unsignedBytes} signed=${report.validatorSetReference.registration.signedBytes} safe-margin=${report.validatorSetReference.registration.safeSizeMarginBytes}`,
    `  HostState proof: depth=${report.hostStateProof.depth} paths=${report.hostStateProof.pathCount} all-default-prototype=${report.hostStateProof.allDefaultPrototype} non-default-siblings=${report.hostStateProof.nonDefaultSiblingCount} compact=${report.hostStateProof.encodedCompactRedeemerBytes} full=${report.hostStateProof.encodedFullRedeemerBytes}`,
    `  exact CBOR: unsigned=${report.unsignedBytes} signed=${report.signedBytes} signing-overhead=${report.signingOverheadBytes}`,
    `  size margins: absolute=${report.absoluteSizeMarginBytes} safe=${report.safeSizeMarginBytes}`,
    `  payload bytes: spend-client=${report.payloads.compactSpendClientRedeemerBytes} host-state=${report.payloads.compactHostStateRedeemerBytes} client-datum=${report.payloads.updatedClientDatumBytes} host-datum=${report.payloads.updatedHostStateDatumBytes} total=${report.payloads.totalBytes}`,
    `  shape: regular-inputs=${report.shape.regularInputs} script-inputs=${report.shape.scriptInputs} collateral=${report.shape.collateralInputs} references=${report.shape.referenceInputs} inline-outputs=${report.shape.inlineDatumOutputs} spend-redeemers=${report.shape.spendRedeemers} vkeys=${report.shape.vkeyWitnesses}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const artifacts = await analyzeCompactTendermintUpdateCapacity();
  console.log(artifacts.map(({ report }) => formatCompactCapacityReport(report)).join('\n\n'));
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
