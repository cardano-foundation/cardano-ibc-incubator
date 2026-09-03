import { createHash } from 'node:crypto';

import { ClientState } from './client-state-types';
import { ConsensusState } from './consensus-state';
import { Height } from './height';

const NANOSECONDS_PER_SECOND = 1_000_000_000n;
const UINT8_MAX = 2n ** 8n - 1n;
const UINT32_MAX = 2n ** 32n - 1n;
const UINT64_MAX = 2n ** 64n - 1n;
const UINT128_MAX = 2n ** 128n - 1n;
const ABI_WORD_BYTES = 32;

export const EUREKA_UPDATE_CLIENT_PROGRAM_VKEY = '00d38536f65ab10e7eff0895b1b9f7cf12f89691631742bb487fe090027e0e6d';
export const EUREKA_UPDATE_CLIENT_MAX_CLOCK_DRIFT_NS = 15_000_000_000n;

export type EurekaHeight = {
  revisionNumber: bigint;
  revisionHeight: bigint;
};

export type EurekaClientState = {
  chainId: string;
  trustLevel: {
    numerator: bigint;
    denominator: bigint;
  };
  latestHeight: EurekaHeight;
  trustingPeriod: bigint;
  unbondingPeriod: bigint;
  isFrozen: boolean;
  zkAlgorithm: 0;
};

export type EurekaConsensusState = {
  timestamp: bigint;
  root: string;
  nextValidatorsHash: string;
};

export type EurekaUpdateClientOutput = {
  clientState: EurekaClientState;
  trustedConsensusState: EurekaConsensusState;
  newConsensusState: EurekaConsensusState;
  time: bigint;
  trustedHeight: EurekaHeight;
  newHeight: EurekaHeight;
};

export function assertEurekaUnsigned(name: string, value: bigint, maximum: bigint): void {
  if (value < 0n || value > maximum) {
    throw new Error(`${name} must be between 0 and ${maximum.toString()}`);
  }
}

export function assertEurekaBytes32(name: string, value: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be exactly 32 bytes of hexadecimal data`);
  }
  return value.toLowerCase();
}

export function toEurekaHeight(name: string, height: Height): EurekaHeight {
  assertEurekaUnsigned(`${name}.revisionNumber`, height.revisionNumber, UINT64_MAX);
  assertEurekaUnsigned(`${name}.revisionHeight`, height.revisionHeight, UINT64_MAX);
  return {
    revisionNumber: height.revisionNumber,
    revisionHeight: height.revisionHeight,
  };
}

function decodeChainId(chainIdHex: string): string {
  if (chainIdHex.length === 0 || chainIdHex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(chainIdHex)) {
    throw new Error('clientState.chainId must be non-empty hexadecimal UTF-8 bytes');
  }
  const bytes = Buffer.from(chainIdHex, 'hex');
  let chainId: string;
  try {
    chainId = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('clientState.chainId must contain valid UTF-8');
  }
  if (bytes.length > 50) {
    throw new Error('clientState.chainId must not exceed 50 UTF-8 bytes');
  }
  return chainId;
}

function durationSeconds(name: string, nanoseconds: bigint): bigint {
  if (nanoseconds <= 0n || nanoseconds % NANOSECONDS_PER_SECOND !== 0n) {
    throw new Error(`${name} must be a positive whole number of seconds for the Eureka program`);
  }
  const seconds = nanoseconds / NANOSECONDS_PER_SECOND;
  assertEurekaUnsigned(name, seconds, UINT32_MAX);
  return seconds;
}

export function toEurekaClientState(clientState: ClientState): EurekaClientState {
  if (clientState.maxClockDrift !== EUREKA_UPDATE_CLIENT_MAX_CLOCK_DRIFT_NS) {
    throw new Error(
      `the released Eureka update-client program requires max_clock_drift=${EUREKA_UPDATE_CLIENT_MAX_CLOCK_DRIFT_NS.toString()}ns`,
    );
  }
  assertEurekaUnsigned('clientState.trustLevel.numerator', clientState.trustLevel.numerator, UINT8_MAX);
  assertEurekaUnsigned('clientState.trustLevel.denominator', clientState.trustLevel.denominator, UINT8_MAX);
  if (clientState.trustLevel.denominator === 0n) {
    throw new Error('clientState.trustLevel.denominator must be greater than zero');
  }
  if (clientState.trustLevel.numerator === 0n) {
    throw new Error('clientState.trustLevel.numerator must be greater than zero');
  }
  if (clientState.trustLevel.numerator > clientState.trustLevel.denominator) {
    throw new Error('clientState.trustLevel.numerator must not exceed its denominator');
  }
  if (3n * clientState.trustLevel.numerator < clientState.trustLevel.denominator) {
    throw new Error('clientState.trustLevel must be at least one third');
  }
  if (clientState.frozenHeight.revisionNumber !== 0n || clientState.frozenHeight.revisionHeight !== 0n) {
    throw new Error('the Eureka update-client program requires an unfrozen client');
  }

  return {
    chainId: decodeChainId(clientState.chainId),
    trustLevel: {
      numerator: clientState.trustLevel.numerator,
      denominator: clientState.trustLevel.denominator,
    },
    latestHeight: toEurekaHeight('clientState.latestHeight', clientState.latestHeight),
    trustingPeriod: durationSeconds('clientState.trustingPeriod', clientState.trustingPeriod),
    unbondingPeriod: durationSeconds('clientState.unbondingPeriod', clientState.unbondingPeriod),
    isFrozen: false,
    zkAlgorithm: 0,
  };
}

export function toEurekaConsensusState(name: string, consensusState: ConsensusState): EurekaConsensusState {
  assertEurekaUnsigned(`${name}.timestamp`, consensusState.timestamp, UINT128_MAX);
  return {
    timestamp: consensusState.timestamp,
    root: assertEurekaBytes32(`${name}.root`, consensusState.root.hash),
    nextValidatorsHash: assertEurekaBytes32(`${name}.nextValidatorsHash`, consensusState.next_validators_hash),
  };
}

export function buildEurekaUpdateClientOutput(args: {
  clientState: ClientState;
  trustedConsensusState: ConsensusState;
  newConsensusState: ConsensusState;
  time: bigint;
  trustedHeight: Height;
  newHeight: Height;
}): EurekaUpdateClientOutput {
  assertEurekaUnsigned('time', args.time, UINT128_MAX);
  return {
    clientState: toEurekaClientState(args.clientState),
    trustedConsensusState: toEurekaConsensusState('trustedConsensusState', args.trustedConsensusState),
    newConsensusState: toEurekaConsensusState('newConsensusState', args.newConsensusState),
    time: args.time,
    trustedHeight: toEurekaHeight('trustedHeight', args.trustedHeight),
    newHeight: toEurekaHeight('newHeight', args.newHeight),
  };
}

export function encodeEurekaAbiWord(value: bigint): Buffer {
  assertEurekaUnsigned('ABI integer', value, 2n ** 256n - 1n);
  return Buffer.from(value.toString(16).padStart(ABI_WORD_BYTES * 2, '0'), 'hex');
}

function encodeEurekaBytes32(value: string): Buffer {
  return Buffer.from(assertEurekaBytes32('ABI bytes32', value), 'hex');
}

export function encodeEurekaClientState(clientState: EurekaClientState): Buffer {
  const chainId = Buffer.from(clientState.chainId, 'utf8');
  const paddedLength = Math.ceil(chainId.length / ABI_WORD_BYTES) * ABI_WORD_BYTES;
  const paddedChainId = Buffer.alloc(paddedLength);
  chainId.copy(paddedChainId);
  const headWordCount = 9n;

  return Buffer.concat([
    encodeEurekaAbiWord(headWordCount * BigInt(ABI_WORD_BYTES)),
    encodeEurekaAbiWord(clientState.trustLevel.numerator),
    encodeEurekaAbiWord(clientState.trustLevel.denominator),
    encodeEurekaAbiWord(clientState.latestHeight.revisionNumber),
    encodeEurekaAbiWord(clientState.latestHeight.revisionHeight),
    encodeEurekaAbiWord(clientState.trustingPeriod),
    encodeEurekaAbiWord(clientState.unbondingPeriod),
    encodeEurekaAbiWord(clientState.isFrozen ? 1n : 0n),
    encodeEurekaAbiWord(BigInt(clientState.zkAlgorithm)),
    encodeEurekaAbiWord(BigInt(chainId.length)),
    paddedChainId,
  ]);
}

export function encodeEurekaConsensusState(consensusState: EurekaConsensusState): Buffer[] {
  return [
    encodeEurekaAbiWord(consensusState.timestamp),
    encodeEurekaBytes32(consensusState.root),
    encodeEurekaBytes32(consensusState.nextValidatorsHash),
  ];
}

export function encodeEurekaHeight(height: EurekaHeight): Buffer[] {
  return [encodeEurekaAbiWord(height.revisionNumber), encodeEurekaAbiWord(height.revisionHeight)];
}

export function encodeEurekaUpdateClientOutput(output: EurekaUpdateClientOutput): Buffer {
  const clientState = encodeEurekaClientState(output.clientState);
  const tupleHeadWordCount = 12n;
  const tuple = Buffer.concat([
    encodeEurekaAbiWord(tupleHeadWordCount * BigInt(ABI_WORD_BYTES)),
    ...encodeEurekaConsensusState(output.trustedConsensusState),
    ...encodeEurekaConsensusState(output.newConsensusState),
    encodeEurekaAbiWord(output.time),
    ...encodeEurekaHeight(output.trustedHeight),
    ...encodeEurekaHeight(output.newHeight),
    clientState,
  ]);

  return Buffer.concat([encodeEurekaAbiWord(BigInt(ABI_WORD_BYTES)), tuple]);
}

export function maskedEurekaPublicValuesDigest(publicValues: Uint8Array): bigint {
  const digest = createHash('sha256').update(publicValues).digest();
  return BigInt(`0x${digest.toString('hex')}`) % 2n ** 253n;
}
