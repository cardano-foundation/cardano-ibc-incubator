import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURE_SCHEMA_VERSION = 1;
const CHAIN_ID = 'injective-1';
const REVISION_NUMBER = '1';
const EXPECTED_VALIDATOR_COUNT = 45;
const EXPECTED_TOTAL_VOTING_POWER = '58207795';
const EXPECTED_VALIDATOR_HASH = '85e2f38d84848c577e196fc82d59ea0071fcdfbe1897c28f570b2c731cb83f9b';

const PRIMARY_RPC = 'https://sentry.tm.injective.network';
const CROSS_CHECK_RPCS = [
  { name: 'Polkachu', base_url: 'https://injective-rpc.polkachu.com' },
  { name: 'PublicNode', base_url: 'https://injective-rpc.publicnode.com' },
] as const;

const COMMIT_HEIGHTS = [180_315_900, 180_315_901, 180_315_953, 180_315_954, 180_315_956, 180_315_957] as const;
const VALIDATOR_HEIGHTS = [180_315_901, 180_315_954, 180_315_957] as const;

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'tendermint-update-capacity');
const SOURCE_DIR = path.join(FIXTURE_DIR, 'source');
const NORMALIZED_PATH = path.join(FIXTURE_DIR, 'normalized.json');
const MANIFEST_PATH = path.join(FIXTURE_DIR, 'manifest.json');

type GeneratorMode = 'check' | 'refresh' | 'write';
type JsonRecord = Record<string, unknown>;

type RpcBlockId = {
  hash: string;
  parts: {
    total: number;
    hash: string;
  };
};

type RpcCommitSignature = {
  block_id_flag: number;
  validator_address: string;
  timestamp: string;
  signature: string | null;
};

type RpcHeader = {
  version: {
    block: string;
    app?: string;
  };
  chain_id: string;
  height: string;
  time: string;
  last_block_id: RpcBlockId;
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

type RpcCommitResponse = {
  jsonrpc: string;
  id: number;
  result: {
    canonical: boolean;
    signed_header: {
      header: RpcHeader;
      commit: {
        height: string;
        round: number;
        block_id: RpcBlockId;
        signatures: RpcCommitSignature[];
      };
    };
  };
};

type RpcValidator = {
  address: string;
  pub_key: {
    type: string;
    value: string;
  };
  voting_power: string;
  proposer_priority: string;
};

type RpcValidatorResponse = {
  jsonrpc: string;
  id: number;
  result: {
    block_height: string;
    validators: RpcValidator[];
    count: string;
    total: string;
  };
};

type NormalizedBlockId = {
  hash: string;
  part_set_header: {
    total: string;
    hash: string;
  };
};

type NormalizedCommitSignature = {
  block_id_flag: number;
  validator_address: string;
  timestamp: string;
  signature: string;
};

type NormalizedSignedHeader = {
  header: {
    version: {
      block: string;
      app: string;
    };
    chain_id: string;
    height: string;
    time: string;
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
    height: string;
    round: string;
    block_id: NormalizedBlockId;
    signatures: NormalizedCommitSignature[];
  };
};

type NormalizedValidator = {
  address: string;
  pub_key: {
    ed25519: string;
  };
  voting_power: string;
  proposer_priority: string;
};

type NormalizedValidatorSet = {
  validators: NormalizedValidator[];
  proposer: NormalizedValidator;
  total_voting_power: string;
};

type ScenarioObservations = {
  validator_count: number;
  signature_count: number;
  commit_vote_count: number;
  absent_vote_count: number;
  nil_vote_count: number;
  total_voting_power: string;
  commit_voting_power: string;
  trusted_overlap_voting_power: string;
  validator_hash: string;
  block_id_hash: string;
};

type NormalizedScenario = {
  description: string;
  source: {
    target_height: string;
    trusted_height: string;
    trusted_validator_height: string;
  };
  header: {
    signed_header: NormalizedSignedHeader;
    validator_set: NormalizedValidatorSet;
    trusted_height: {
      revision_number: string;
      revision_height: string;
    };
    trusted_validators: NormalizedValidatorSet;
  };
  trusted_consensus_state: {
    timestamp: string;
    next_validators_hash: string;
    root: string;
  };
  observations: ScenarioObservations;
};

type NormalizedFixture = {
  schema_version: number;
  fixture: string;
  chain_id: string;
  byte_encoding: string;
  integer_encoding: string;
  scenarios: {
    adjacent_all_signed: NormalizedScenario;
    adjacent_mixed: NormalizedScenario;
    non_adjacent_mixed: NormalizedScenario;
  };
};

type CrossProviderCheck = {
  height: string;
  block_id_hash: string;
  validator_hash: string;
  providers: Array<{
    name: string;
    url: string;
    block_id_hash: string;
    validator_hash: string;
  }>;
};

type Provenance = {
  captured_at: string;
  primary_rpc: string;
  cross_provider_checks: CrossProviderCheck[];
};

type FixtureManifest = {
  schema_version: number;
  fixture: string;
  chain_id: string;
  provenance: Provenance;
  generator: {
    path: string;
    cometbft_reference_version: string;
    mode: string;
  };
  sources: Array<{
    file: string;
    kind: 'commit' | 'validators';
    height: string;
    url: string;
    sha256: string;
  }>;
  validated_invariants: {
    expected_validator_count: number;
    expected_total_voting_power: string;
    validator_hash: string;
    header_hashes_match_commit_block_ids: boolean;
    validator_addresses_match_public_keys: boolean;
    commit_and_nil_signatures_verify: boolean;
    adjacent_successor_validator_sets_match: boolean;
    scenario_observations: Record<keyof NormalizedFixture['scenarios'], ScenarioObservations>;
  };
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function requireRecord(value: unknown, label: string): JsonRecord {
  invariant(typeof value === 'object' && value !== null && !Array.isArray(value), `${label} must be an object`);
  return value as JsonRecord;
}

function requireString(value: unknown, label: string): string {
  invariant(typeof value === 'string', `${label} must be a string`);
  return value;
}

function requireNumber(value: unknown, label: string): number {
  invariant(typeof value === 'number' && Number.isFinite(value), `${label} must be a finite number`);
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  invariant(Array.isArray(value), `${label} must be an array`);
  return value;
}

function integerString(value: unknown, label: string): string {
  const normalized = typeof value === 'number' ? String(value) : requireString(value, label);
  invariant(/^-?\d+$/.test(normalized), `${label} must be an integer`);
  return normalized;
}

function normalizeHex(value: unknown, label: string): string {
  if (value === null || value === undefined) {
    return '';
  }
  const normalized = requireString(value, label).toLowerCase();
  invariant(normalized.length % 2 === 0 && /^[0-9a-f]*$/.test(normalized), `${label} must be even-length hex`);
  return normalized;
}

function decodeBase64(value: string, label: string): Buffer {
  invariant(/^[A-Za-z0-9+/]*={0,2}$/.test(value), `${label} must be base64`);
  const bytes = Buffer.from(value, 'base64');
  const withoutPadding = value.replace(/=+$/, '');
  invariant(bytes.toString('base64').replace(/=+$/, '') === withoutPadding, `${label} is not canonical base64`);
  return bytes;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function sha256(bytes: crypto.BinaryLike): Buffer {
  return crypto.createHash('sha256').update(bytes).digest();
}

function sha256Hex(bytes: crypto.BinaryLike): string {
  return sha256(bytes).toString('hex');
}

function sourceCommitPath(height: number): string {
  return path.join(SOURCE_DIR, `commit-${height}.json`);
}

function sourceValidatorPath(height: number): string {
  return path.join(SOURCE_DIR, `validators-${height}.json`);
}

function commitUrl(baseUrl: string, height: number): string {
  return `${baseUrl}/commit?height=${height}`;
}

function validatorUrl(baseUrl: string, height: number): string {
  return `${baseUrl}/validators?height=${height}&page=1&per_page=100`;
}

function parseCommitResponse(value: unknown, expectedHeight: number, label: string): RpcCommitResponse {
  const envelope = requireRecord(value, label);
  const result = requireRecord(envelope.result, `${label}.result`);
  const signedHeader = requireRecord(result.signed_header, `${label}.result.signed_header`);
  const header = requireRecord(signedHeader.header, `${label}.result.signed_header.header`);
  const commit = requireRecord(signedHeader.commit, `${label}.result.signed_header.commit`);

  invariant(result.canonical === true, `${label} must be the canonical commit`);
  invariant(
    integerString(header.height, `${label}.header.height`) === String(expectedHeight),
    `${label} height mismatch`,
  );
  invariant(requireString(header.chain_id, `${label}.header.chain_id`) === CHAIN_ID, `${label} chain ID mismatch`);
  invariant(
    integerString(commit.height, `${label}.commit.height`) === String(expectedHeight),
    `${label} commit height mismatch`,
  );
  requireRecord(header.version, `${label}.header.version`);
  requireRecord(header.last_block_id, `${label}.header.last_block_id`);
  requireRecord(commit.block_id, `${label}.commit.block_id`);
  const signatures = requireArray(commit.signatures, `${label}.commit.signatures`);
  invariant(signatures.length === EXPECTED_VALIDATOR_COUNT, `${label} must contain 45 commit slots`);

  for (const [index, rawSignature] of signatures.entries()) {
    const signature = requireRecord(rawSignature, `${label}.commit.signatures[${index}]`);
    const flag = requireNumber(signature.block_id_flag, `${label}.commit.signatures[${index}].block_id_flag`);
    invariant([1, 2, 3].includes(flag), `${label} signature ${index} has unsupported flag ${flag}`);
    requireString(signature.validator_address, `${label}.commit.signatures[${index}].validator_address`);
    requireString(signature.timestamp, `${label}.commit.signatures[${index}].timestamp`);
    invariant(
      signature.signature === null || typeof signature.signature === 'string',
      `${label}.commit.signatures[${index}].signature must be string or null`,
    );
  }

  return value as RpcCommitResponse;
}

function parseValidatorResponse(value: unknown, expectedHeight: number, label: string): RpcValidatorResponse {
  const envelope = requireRecord(value, label);
  const result = requireRecord(envelope.result, `${label}.result`);
  invariant(
    integerString(result.block_height, `${label}.result.block_height`) === String(expectedHeight),
    `${label} height mismatch`,
  );
  const validators = requireArray(result.validators, `${label}.result.validators`);
  invariant(
    integerString(result.count, `${label}.result.count`) === String(EXPECTED_VALIDATOR_COUNT),
    `${label} count mismatch`,
  );
  invariant(
    integerString(result.total, `${label}.result.total`) === String(EXPECTED_VALIDATOR_COUNT),
    `${label} total mismatch`,
  );
  invariant(validators.length === EXPECTED_VALIDATOR_COUNT, `${label} must contain 45 validators`);

  for (const [index, rawValidator] of validators.entries()) {
    const validator = requireRecord(rawValidator, `${label}.result.validators[${index}]`);
    requireString(validator.address, `${label}.validators[${index}].address`);
    const pubKey = requireRecord(validator.pub_key, `${label}.validators[${index}].pub_key`);
    invariant(
      requireString(pubKey.type, `${label}.validators[${index}].pub_key.type`) === 'tendermint/PubKeyEd25519',
      `${label} validator ${index} is not Ed25519`,
    );
    requireString(pubKey.value, `${label}.validators[${index}].pub_key.value`);
    integerString(validator.voting_power, `${label}.validators[${index}].voting_power`);
    integerString(validator.proposer_priority, `${label}.validators[${index}].proposer_priority`);
  }

  return value as RpcValidatorResponse;
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function readCommitSources(): Map<number, RpcCommitResponse> {
  return new Map(
    COMMIT_HEIGHTS.map((height) => {
      const filePath = sourceCommitPath(height);
      invariant(fs.existsSync(filePath), `Missing source fixture ${filePath}; run with --refresh`);
      return [height, parseCommitResponse(readJson(filePath), height, path.basename(filePath))];
    }),
  );
}

function readValidatorSources(): Map<number, RpcValidatorResponse> {
  return new Map(
    VALIDATOR_HEIGHTS.map((height) => {
      const filePath = sourceValidatorPath(height);
      invariant(fs.existsSync(filePath), `Missing source fixture ${filePath}; run with --refresh`);
      return [height, parseValidatorResponse(readJson(filePath), height, path.basename(filePath))];
    }),
  );
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

function encodeVarintField(fieldNumber: number, value: bigint): Buffer {
  if (value === 0n) {
    return Buffer.alloc(0);
  }
  return Buffer.concat([encodeFieldKey(fieldNumber, 0), encodeVarint(value)]);
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

function encodeSignedFixed64Field(fieldNumber: number, value: bigint): Buffer {
  if (value === 0n) {
    return Buffer.alloc(0);
  }
  const encoded = Buffer.alloc(8);
  encoded.writeBigInt64LE(value);
  return Buffer.concat([encodeFieldKey(fieldNumber, 1), encoded]);
}

function parseTimestamp(value: string, label: string): { nanoseconds: string; seconds: bigint; nanos: number } {
  if (value === '0001-01-01T00:00:00Z') {
    return { nanoseconds: '0', seconds: 0n, nanos: 0 };
  }

  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  invariant(match, `${label} must be an RFC3339Nano UTC timestamp`);
  const wholeSecondMilliseconds = Date.parse(`${match[1]}Z`);
  invariant(Number.isFinite(wholeSecondMilliseconds), `${label} is outside the supported timestamp range`);
  const seconds = BigInt(Math.trunc(wholeSecondMilliseconds / 1_000));
  const nanos = Number((match[2] ?? '').padEnd(9, '0'));
  const nanoseconds = seconds * 1_000_000_000n + BigInt(nanos);
  return { nanoseconds: nanoseconds.toString(), seconds, nanos };
}

function encodeTimestampFromNanoseconds(nanoseconds: string): Buffer {
  const total = BigInt(nanoseconds);
  const seconds = total / 1_000_000_000n;
  const nanos = total % 1_000_000_000n;
  return Buffer.concat([encodeVarintField(1, seconds), encodeVarintField(2, nanos)]);
}

function normalizeBlockId(value: RpcBlockId, label: string): NormalizedBlockId {
  const blockId = requireRecord(value, label);
  const parts = requireRecord(blockId.parts, `${label}.parts`);
  return {
    hash: normalizeHex(blockId.hash, `${label}.hash`),
    part_set_header: {
      total: integerString(parts.total, `${label}.parts.total`),
      hash: normalizeHex(parts.hash, `${label}.parts.hash`),
    },
  };
}

function encodeBlockId(blockId: NormalizedBlockId): Buffer {
  const partSetHeader = Buffer.concat([
    encodeVarintField(1, BigInt(blockId.part_set_header.total)),
    encodeBytesField(2, Buffer.from(blockId.part_set_header.hash, 'hex')),
  ]);
  return Buffer.concat([encodeBytesField(1, Buffer.from(blockId.hash, 'hex')), encodeMessageField(2, partSetHeader)]);
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

function validatorHash(validators: NormalizedValidator[]): string {
  const encoded = validators.map((validator) => {
    const publicKey = encodeBytesField(1, Buffer.from(validator.pub_key.ed25519, 'hex'));
    return Buffer.concat([encodeMessageField(1, publicKey), encodeVarintField(2, BigInt(validator.voting_power))]);
  });
  return simpleMerkleHash(encoded).toString('hex');
}

function headerHash(header: NormalizedSignedHeader['header']): string {
  const version = Buffer.concat([
    encodeVarintField(1, BigInt(header.version.block)),
    encodeVarintField(2, BigInt(header.version.app)),
  ]);
  const values = [
    version,
    encodeBytesField(1, Buffer.from(header.chain_id, 'utf8')),
    encodeVarintField(1, BigInt(header.height)),
    encodeTimestampFromNanoseconds(header.time),
    encodeBlockId(header.last_block_id),
    encodeBytesField(1, Buffer.from(header.last_commit_hash, 'hex')),
    encodeBytesField(1, Buffer.from(header.data_hash, 'hex')),
    encodeBytesField(1, Buffer.from(header.validators_hash, 'hex')),
    encodeBytesField(1, Buffer.from(header.next_validators_hash, 'hex')),
    encodeBytesField(1, Buffer.from(header.consensus_hash, 'hex')),
    encodeBytesField(1, Buffer.from(header.app_hash, 'hex')),
    encodeBytesField(1, Buffer.from(header.last_results_hash, 'hex')),
    encodeBytesField(1, Buffer.from(header.evidence_hash, 'hex')),
    encodeBytesField(1, Buffer.from(header.proposer_address, 'hex')),
  ];
  return simpleMerkleHash(values).toString('hex');
}

function canonicalVoteSignBytes(
  chainId: string,
  height: string,
  round: string,
  blockId: NormalizedBlockId | null,
  timestamp: string,
): Buffer {
  const fields = [
    encodeVarintField(1, 2n),
    encodeSignedFixed64Field(2, BigInt(height)),
    encodeSignedFixed64Field(3, BigInt(round)),
  ];
  if (blockId !== null) {
    fields.push(encodeMessageField(4, encodeBlockId(blockId)));
  }
  fields.push(encodeMessageField(5, encodeTimestampFromNanoseconds(timestamp)));
  fields.push(encodeBytesField(6, Buffer.from(chainId, 'utf8')));
  const message = Buffer.concat(fields);
  return Buffer.concat([encodeVarint(BigInt(message.length)), message]);
}

function verifyEd25519(publicKeyHex: string, message: Buffer, signatureHex: string): boolean {
  const rawPublicKey = Buffer.from(publicKeyHex, 'hex');
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawPublicKey]);
  const publicKey = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
  return crypto.verify(null, message, publicKey, Buffer.from(signatureHex, 'hex'));
}

function normalizeSignedHeader(response: RpcCommitResponse): NormalizedSignedHeader {
  const { header, commit } = response.result.signed_header;
  const normalizedHeader: NormalizedSignedHeader['header'] = {
    version: {
      block: integerString(header.version.block, 'header.version.block'),
      app: integerString(header.version.app ?? '0', 'header.version.app'),
    },
    chain_id: requireString(header.chain_id, 'header.chain_id'),
    height: integerString(header.height, 'header.height'),
    time: parseTimestamp(requireString(header.time, 'header.time'), 'header.time').nanoseconds,
    last_block_id: normalizeBlockId(header.last_block_id, 'header.last_block_id'),
    last_commit_hash: normalizeHex(header.last_commit_hash, 'header.last_commit_hash'),
    data_hash: normalizeHex(header.data_hash, 'header.data_hash'),
    validators_hash: normalizeHex(header.validators_hash, 'header.validators_hash'),
    next_validators_hash: normalizeHex(header.next_validators_hash, 'header.next_validators_hash'),
    consensus_hash: normalizeHex(header.consensus_hash, 'header.consensus_hash'),
    app_hash: normalizeHex(header.app_hash, 'header.app_hash'),
    last_results_hash: normalizeHex(header.last_results_hash, 'header.last_results_hash'),
    evidence_hash: normalizeHex(header.evidence_hash, 'header.evidence_hash'),
    proposer_address: normalizeHex(header.proposer_address, 'header.proposer_address'),
  };

  const normalizedCommit: NormalizedSignedHeader['commit'] = {
    height: integerString(commit.height, 'commit.height'),
    round: integerString(commit.round, 'commit.round'),
    block_id: normalizeBlockId(commit.block_id, 'commit.block_id'),
    signatures: commit.signatures.map((signature, index) => {
      const flag = requireNumber(signature.block_id_flag, `commit.signatures[${index}].block_id_flag`);
      const normalizedSignature = signature.signature ?? '';
      const signatureBytes =
        normalizedSignature === '' ? Buffer.alloc(0) : decodeBase64(normalizedSignature, `signature ${index}`);
      return {
        block_id_flag: flag,
        validator_address: normalizeHex(signature.validator_address, `commit.signatures[${index}].validator_address`),
        timestamp: parseTimestamp(signature.timestamp, `commit.signatures[${index}].timestamp`).nanoseconds,
        signature: signatureBytes.toString('hex'),
      };
    }),
  };

  invariant(normalizedHeader.chain_id === CHAIN_ID, `Unexpected chain ID ${normalizedHeader.chain_id}`);
  invariant(
    normalizedCommit.height === normalizedHeader.height,
    `Header/commit height mismatch at ${normalizedHeader.height}`,
  );
  invariant(
    headerHash(normalizedHeader) === normalizedCommit.block_id.hash,
    `Header hash does not match commit block ID at ${normalizedHeader.height}`,
  );
  return { header: normalizedHeader, commit: normalizedCommit };
}

function normalizeValidatorSet(response: RpcValidatorResponse, proposerAddress: string): NormalizedValidatorSet {
  const validators = response.result.validators.map((validator, index): NormalizedValidator => {
    const publicKey = decodeBase64(validator.pub_key.value, `validators[${index}].pub_key.value`);
    invariant(publicKey.length === 32, `Validator ${index} public key must be 32 bytes`);
    const address = normalizeHex(validator.address, `validators[${index}].address`);
    invariant(address.length === 40, `Validator ${index} address must be 20 bytes`);
    invariant(
      sha256(publicKey).subarray(0, 20).toString('hex') === address,
      `Validator ${index} address does not match its public key`,
    );
    return {
      address,
      pub_key: { ed25519: publicKey.toString('hex') },
      voting_power: integerString(validator.voting_power, `validators[${index}].voting_power`),
      proposer_priority: integerString(validator.proposer_priority, `validators[${index}].proposer_priority`),
    };
  });

  for (let index = 1; index < validators.length; index += 1) {
    const previous = validators[index - 1];
    const current = validators[index];
    const previousPower = BigInt(previous.voting_power);
    const currentPower = BigInt(current.voting_power);
    invariant(
      previousPower > currentPower || (previousPower === currentPower && previous.address < current.address),
      `Validator response is not in canonical power/address order at index ${index}`,
    );
  }

  const totalVotingPower = validators
    .reduce((total, validator) => total + BigInt(validator.voting_power), 0n)
    .toString();
  invariant(totalVotingPower === EXPECTED_TOTAL_VOTING_POWER, `Unexpected total voting power ${totalVotingPower}`);
  invariant(
    validatorHash(validators) === EXPECTED_VALIDATOR_HASH,
    'Validator set hash differs from pinned Injective hash',
  );

  const proposer = validators.find((validator) => validator.address === proposerAddress);
  invariant(proposer, `Proposer ${proposerAddress} not found in validator set`);
  return { validators, proposer, total_voting_power: totalVotingPower };
}

function analyzeScenario(
  signedHeader: NormalizedSignedHeader,
  validatorSet: NormalizedValidatorSet,
  trustedValidators: NormalizedValidatorSet,
): ScenarioObservations {
  invariant(
    signedHeader.commit.signatures.length === validatorSet.validators.length,
    `Signature/validator count mismatch at ${signedHeader.header.height}`,
  );

  let commitVotes = 0;
  let absentVotes = 0;
  let nilVotes = 0;
  let commitVotingPower = 0n;
  let trustedOverlapVotingPower = 0n;
  const trustedByAddress = new Map(trustedValidators.validators.map((validator) => [validator.address, validator]));

  for (const [index, signature] of signedHeader.commit.signatures.entries()) {
    const positionalValidator = validatorSet.validators[index];
    if (signature.block_id_flag === 1) {
      absentVotes += 1;
      invariant(
        signature.validator_address === '' && signature.timestamp === '0' && signature.signature === '',
        `Absent signature ${index} has non-empty fields`,
      );
      continue;
    }

    invariant(
      signature.validator_address === positionalValidator.address,
      `Signature ${index} is not positionally aligned`,
    );
    invariant(signature.signature.length === 128, `Signature ${index} is not 64 bytes`);
    invariant(BigInt(signature.timestamp) > 0n, `Signature ${index} has zero timestamp`);
    const blockId = signature.block_id_flag === 2 ? signedHeader.commit.block_id : null;
    invariant(
      verifyEd25519(
        positionalValidator.pub_key.ed25519,
        canonicalVoteSignBytes(
          signedHeader.header.chain_id,
          signedHeader.commit.height,
          signedHeader.commit.round,
          blockId,
          signature.timestamp,
        ),
        signature.signature,
      ),
      `Signature ${index} failed canonical Ed25519 verification`,
    );

    if (signature.block_id_flag === 2) {
      commitVotes += 1;
      commitVotingPower += BigInt(positionalValidator.voting_power);
      const trustedValidator = trustedByAddress.get(signature.validator_address);
      if (trustedValidator) {
        trustedOverlapVotingPower += BigInt(trustedValidator.voting_power);
      }
    } else {
      invariant(signature.block_id_flag === 3, `Unexpected signature flag ${signature.block_id_flag}`);
      nilVotes += 1;
    }
  }

  const totalVotingPower = BigInt(validatorSet.total_voting_power);
  invariant(commitVotingPower > (totalVotingPower * 2n) / 3n, 'Commit voting power is not strictly above two thirds');
  invariant(
    trustedOverlapVotingPower > BigInt(trustedValidators.total_voting_power) / 3n,
    'Trusted overlap is not strictly above one third',
  );

  return {
    validator_count: validatorSet.validators.length,
    signature_count: signedHeader.commit.signatures.length,
    commit_vote_count: commitVotes,
    absent_vote_count: absentVotes,
    nil_vote_count: nilVotes,
    total_voting_power: validatorSet.total_voting_power,
    commit_voting_power: commitVotingPower.toString(),
    trusted_overlap_voting_power: trustedOverlapVotingPower.toString(),
    validator_hash: validatorHash(validatorSet.validators),
    block_id_hash: signedHeader.commit.block_id.hash,
  };
}

function buildScenario(
  description: string,
  targetHeight: number,
  trustedHeight: number,
  trustedValidatorHeight: number,
  signedHeaders: Map<number, NormalizedSignedHeader>,
  validatorSets: Map<number, NormalizedValidatorSet>,
): NormalizedScenario {
  const signedHeader = signedHeaders.get(targetHeight);
  const validatorSet = validatorSets.get(targetHeight);
  const trustedHeader = signedHeaders.get(trustedHeight);
  const trustedValidators = validatorSets.get(trustedValidatorHeight);
  invariant(signedHeader, `Missing normalized signed header ${targetHeight}`);
  invariant(validatorSet, `Missing normalized validator set ${targetHeight}`);
  invariant(trustedHeader, `Missing normalized trusted header ${trustedHeight}`);
  invariant(trustedValidators, `Missing normalized trusted validators ${trustedValidatorHeight}`);
  invariant(
    trustedHeader.header.next_validators_hash === validatorHash(trustedValidators.validators),
    `Trusted height ${trustedHeight} next-validator hash does not match set at ${trustedValidatorHeight}`,
  );
  invariant(
    signedHeader.header.validators_hash === validatorHash(validatorSet.validators),
    `Target height ${targetHeight} validator hash does not match its validator set`,
  );

  return {
    description,
    source: {
      target_height: String(targetHeight),
      trusted_height: String(trustedHeight),
      trusted_validator_height: String(trustedValidatorHeight),
    },
    header: {
      signed_header: signedHeader,
      validator_set: validatorSet,
      trusted_height: {
        revision_number: REVISION_NUMBER,
        revision_height: String(trustedHeight),
      },
      trusted_validators: trustedValidators,
    },
    trusted_consensus_state: {
      timestamp: trustedHeader.header.time,
      next_validators_hash: trustedHeader.header.next_validators_hash,
      root: trustedHeader.header.app_hash,
    },
    observations: analyzeScenario(signedHeader, validatorSet, trustedValidators),
  };
}

function buildNormalizedFixture(
  commits: Map<number, RpcCommitResponse>,
  validators: Map<number, RpcValidatorResponse>,
): NormalizedFixture {
  const signedHeaders = new Map(
    [...commits.entries()].map(([height, response]) => [height, normalizeSignedHeader(response)]),
  );
  const validatorSets = new Map(
    [...validators.entries()].map(([height, response]) => {
      const signedHeader = signedHeaders.get(height);
      invariant(signedHeader, `A commit response is required to select proposer at height ${height}`);
      return [height, normalizeValidatorSet(response, signedHeader.header.proposer_address)];
    }),
  );

  for (const [height, signedHeader] of signedHeaders) {
    const validatorSet = [...validatorSets.values()].find(
      (candidate) => validatorHash(candidate.validators) === signedHeader.header.validators_hash,
    );
    invariant(validatorSet, `No captured validator set matches commit ${height}`);
    analyzeScenario(signedHeader, validatorSet, validatorSet);
  }

  const fixture: NormalizedFixture = {
    schema_version: FIXTURE_SCHEMA_VERSION,
    fixture: 'injective-tendermint-update-capacity',
    chain_id: CHAIN_ID,
    byte_encoding: 'lowercase hexadecimal without 0x prefix',
    integer_encoding: 'base-10 strings; timestamps are Unix nanoseconds and Go zero time is 0',
    scenarios: {
      adjacent_all_signed: buildScenario(
        'Live Injective mainnet adjacent update with 45 committing validators.',
        180_315_957,
        180_315_956,
        180_315_957,
        signedHeaders,
        validatorSets,
      ),
      adjacent_mixed: buildScenario(
        'Live Injective mainnet adjacent update with 43 commit, one absent, and one nil slot.',
        180_315_954,
        180_315_953,
        180_315_954,
        signedHeaders,
        validatorSets,
      ),
      non_adjacent_mixed: buildScenario(
        'Live Injective mainnet 54-block update with 43 commit, one absent, and one nil slot.',
        180_315_954,
        180_315_900,
        180_315_901,
        signedHeaders,
        validatorSets,
      ),
    },
  };

  invariant(fixture.scenarios.adjacent_all_signed.observations.commit_vote_count === 45, 'All-signed fixture changed');
  invariant(
    fixture.scenarios.adjacent_mixed.observations.commit_vote_count === 43 &&
      fixture.scenarios.adjacent_mixed.observations.absent_vote_count === 1 &&
      fixture.scenarios.adjacent_mixed.observations.nil_vote_count === 1,
    'Mixed fixture vote shape changed',
  );
  return fixture;
}

async function fetchJson(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'cardano-ibc-capacity-fixture-generator/1' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return (await response.json()) as unknown;
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function refreshSources(): Promise<void> {
  fs.mkdirSync(SOURCE_DIR, { recursive: true });
  for (const height of COMMIT_HEIGHTS) {
    const response = parseCommitResponse(await fetchJson(commitUrl(PRIMARY_RPC, height)), height, `commit ${height}`);
    fs.writeFileSync(sourceCommitPath(height), stableJson(response), 'utf8');
  }
  for (const height of VALIDATOR_HEIGHTS) {
    const response = parseValidatorResponse(
      await fetchJson(validatorUrl(PRIMARY_RPC, height)),
      height,
      `validators ${height}`,
    );
    fs.writeFileSync(sourceValidatorPath(height), stableJson(response), 'utf8');
  }
}

async function captureProvenance(commits: Map<number, RpcCommitResponse>): Promise<Provenance> {
  const crossProviderChecks: CrossProviderCheck[] = [];
  for (const height of COMMIT_HEIGHTS) {
    const primary = commits.get(height);
    invariant(primary, `Missing primary commit ${height}`);
    const expectedBlockId = normalizeHex(
      primary.result.signed_header.commit.block_id.hash,
      `commit ${height} block ID`,
    );
    const expectedValidatorHash = normalizeHex(
      primary.result.signed_header.header.validators_hash,
      `commit ${height} validator hash`,
    );
    const providers: CrossProviderCheck['providers'] = [
      {
        name: 'Injective official sentry',
        url: commitUrl(PRIMARY_RPC, height),
        block_id_hash: expectedBlockId,
        validator_hash: expectedValidatorHash,
      },
    ];

    for (const provider of CROSS_CHECK_RPCS) {
      const response = parseCommitResponse(
        await fetchJson(commitUrl(provider.base_url, height)),
        height,
        `${provider.name} commit ${height}`,
      );
      const blockId = normalizeHex(response.result.signed_header.commit.block_id.hash, `${provider.name} block ID`);
      const validatorSetHash = normalizeHex(
        response.result.signed_header.header.validators_hash,
        `${provider.name} validator hash`,
      );
      invariant(blockId === expectedBlockId, `${provider.name} block ID mismatch at ${height}`);
      invariant(validatorSetHash === expectedValidatorHash, `${provider.name} validator hash mismatch at ${height}`);
      providers.push({
        name: provider.name,
        url: commitUrl(provider.base_url, height),
        block_id_hash: blockId,
        validator_hash: validatorSetHash,
      });
    }

    crossProviderChecks.push({
      height: String(height),
      block_id_hash: expectedBlockId,
      validator_hash: expectedValidatorHash,
      providers,
    });
  }

  return {
    captured_at: new Date().toISOString(),
    primary_rpc: PRIMARY_RPC,
    cross_provider_checks: crossProviderChecks,
  };
}

function validateProvenance(provenance: Provenance, commits: Map<number, RpcCommitResponse>): void {
  invariant(provenance.primary_rpc === PRIMARY_RPC, 'Manifest primary RPC changed');
  invariant(!Number.isNaN(Date.parse(provenance.captured_at)), 'Manifest captured_at is invalid');
  invariant(
    provenance.cross_provider_checks.length === COMMIT_HEIGHTS.length,
    'Manifest cross-provider checks incomplete',
  );

  for (const height of COMMIT_HEIGHTS) {
    const commit = commits.get(height);
    const check = provenance.cross_provider_checks.find((candidate) => candidate.height === String(height));
    invariant(commit && check, `Manifest missing cross-provider check at ${height}`);
    const blockId = normalizeHex(commit.result.signed_header.commit.block_id.hash, `commit ${height} block ID`);
    const validatorSetHash = normalizeHex(
      commit.result.signed_header.header.validators_hash,
      `commit ${height} val hash`,
    );
    invariant(check.block_id_hash === blockId, `Manifest block ID mismatch at ${height}`);
    invariant(check.validator_hash === validatorSetHash, `Manifest validator hash mismatch at ${height}`);
    invariant(check.providers.length === 3, `Manifest must record three providers at ${height}`);
    for (const provider of check.providers) {
      invariant(provider.block_id_hash === blockId, `Manifest provider block ID mismatch at ${height}`);
      invariant(provider.validator_hash === validatorSetHash, `Manifest provider validator hash mismatch at ${height}`);
    }
  }
}

function sourceEntries(): FixtureManifest['sources'] {
  const commits = COMMIT_HEIGHTS.map((height) => {
    const filePath = sourceCommitPath(height);
    return {
      file: path.relative(FIXTURE_DIR, filePath),
      kind: 'commit' as const,
      height: String(height),
      url: commitUrl(PRIMARY_RPC, height),
      sha256: sha256Hex(fs.readFileSync(filePath)),
    };
  });
  const validators = VALIDATOR_HEIGHTS.map((height) => {
    const filePath = sourceValidatorPath(height);
    return {
      file: path.relative(FIXTURE_DIR, filePath),
      kind: 'validators' as const,
      height: String(height),
      url: validatorUrl(PRIMARY_RPC, height),
      sha256: sha256Hex(fs.readFileSync(filePath)),
    };
  });
  return [...commits, ...validators];
}

function buildManifest(normalized: NormalizedFixture, provenance: Provenance): FixtureManifest {
  return {
    schema_version: FIXTURE_SCHEMA_VERSION,
    fixture: normalized.fixture,
    chain_id: normalized.chain_id,
    provenance,
    generator: {
      path: 'cardano/gateway/src/scripts/test/generate-injective-tendermint-capacity-fixture.ts',
      cometbft_reference_version: 'v0.38.21',
      mode: 'committed sources are offline inputs; --refresh is explicit',
    },
    sources: sourceEntries(),
    validated_invariants: {
      expected_validator_count: EXPECTED_VALIDATOR_COUNT,
      expected_total_voting_power: EXPECTED_TOTAL_VOTING_POWER,
      validator_hash: EXPECTED_VALIDATOR_HASH,
      header_hashes_match_commit_block_ids: true,
      validator_addresses_match_public_keys: true,
      commit_and_nil_signatures_verify: true,
      adjacent_successor_validator_sets_match: true,
      scenario_observations: {
        adjacent_all_signed: normalized.scenarios.adjacent_all_signed.observations,
        adjacent_mixed: normalized.scenarios.adjacent_mixed.observations,
        non_adjacent_mixed: normalized.scenarios.non_adjacent_mixed.observations,
      },
    },
  };
}

function parseExistingManifest(): FixtureManifest {
  invariant(fs.existsSync(MANIFEST_PATH), `Missing ${MANIFEST_PATH}; run with --refresh`);
  const value = requireRecord(readJson(MANIFEST_PATH), 'manifest');
  const provenance = requireRecord(value.provenance, 'manifest.provenance');
  const checks = requireArray(provenance.cross_provider_checks, 'manifest.provenance.cross_provider_checks');
  return {
    ...(value as unknown as FixtureManifest),
    provenance: {
      captured_at: requireString(provenance.captured_at, 'manifest.provenance.captured_at'),
      primary_rpc: requireString(provenance.primary_rpc, 'manifest.provenance.primary_rpc'),
      cross_provider_checks: checks as CrossProviderCheck[],
    },
  };
}

function assertGeneratedFile(filePath: string, expected: unknown): void {
  invariant(fs.existsSync(filePath), `Missing generated fixture ${filePath}`);
  const actual = fs.readFileSync(filePath, 'utf8');
  invariant(actual === stableJson(expected), `${filePath} is stale; run this generator with --write`);
}

function writeDerived(normalized: NormalizedFixture, manifest: FixtureManifest): void {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.writeFileSync(NORMALIZED_PATH, stableJson(normalized), 'utf8');
  fs.writeFileSync(MANIFEST_PATH, stableJson(manifest), 'utf8');
}

function parseMode(argv: string[]): GeneratorMode {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Usage: ts-node src/scripts/test/generate-injective-tendermint-capacity-fixture.ts [--check|--write|--refresh]

  --check    Validate committed sources, manifest, and normalized output without writing (default).
  --write    Regenerate derived normalized.json and manifest.json from committed source responses.
  --refresh  Fetch the nine pinned source responses, cross-check three RPC providers, and write all fixtures.`);
    process.exit(0);
  }
  invariant(argv.length <= 1, 'Specify at most one of --check, --write, or --refresh');
  const arg = argv[0] ?? '--check';
  if (arg === '--check') return 'check';
  if (arg === '--write') return 'write';
  if (arg === '--refresh') return 'refresh';
  throw new Error(`Unknown argument ${arg}`);
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  if (mode === 'refresh') {
    await refreshSources();
  }

  const commits = readCommitSources();
  const validators = readValidatorSources();
  const normalized = buildNormalizedFixture(commits, validators);
  const existingManifest = mode === 'refresh' ? undefined : parseExistingManifest();
  const provenance = mode === 'refresh' ? await captureProvenance(commits) : existingManifest!.provenance;
  validateProvenance(provenance, commits);
  const manifest = buildManifest(normalized, provenance);

  if (mode === 'check') {
    assertGeneratedFile(NORMALIZED_PATH, normalized);
    assertGeneratedFile(MANIFEST_PATH, manifest);
  } else {
    writeDerived(normalized, manifest);
  }

  const observations = normalized.scenarios;
  console.log(
    `Injective Tendermint capacity fixtures ${mode === 'check' ? 'validated' : 'generated'}: ` +
      `adjacent-all=${observations.adjacent_all_signed.observations.commit_vote_count}/45, ` +
      `adjacent-mixed=${observations.adjacent_mixed.observations.commit_vote_count}/45, ` +
      `non-adjacent-mixed=${observations.non_adjacent_mixed.observations.commit_vote_count}/45.`,
  );
}

main().catch((error) => {
  console.error(
    `Injective Tendermint capacity fixture generation failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
