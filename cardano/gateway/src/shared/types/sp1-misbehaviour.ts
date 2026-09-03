import { ClientState } from './client-state-types';
import { ConsensusState } from './consensus-state';
import { Height } from './height';
import {
  assertEurekaUnsigned,
  encodeEurekaAbiWord,
  encodeEurekaClientState,
  encodeEurekaConsensusState,
  encodeEurekaHeight,
  EurekaClientState,
  EurekaConsensusState,
  EurekaHeight,
  toEurekaClientState,
  toEurekaConsensusState,
  toEurekaHeight,
} from './sp1-update-client';

const UINT128_MAX = 2n ** 128n - 1n;
const ABI_WORD_BYTES = 32n;

export const EUREKA_MISBEHAVIOUR_PROGRAM_VKEY = '0010008da4267c2e85d02616e853379e3c937c03a271b5b005f479cff09ccfcb';

export type EurekaMisbehaviourOutput = {
  clientState: EurekaClientState;
  time: bigint;
  trustedHeight1: EurekaHeight;
  trustedHeight2: EurekaHeight;
  trustedConsensusState1: EurekaConsensusState;
  trustedConsensusState2: EurekaConsensusState;
};

export function buildEurekaMisbehaviourOutput(args: {
  clientState: ClientState;
  time: bigint;
  trustedHeight1: Height;
  trustedHeight2: Height;
  trustedConsensusState1: ConsensusState;
  trustedConsensusState2: ConsensusState;
}): EurekaMisbehaviourOutput {
  assertEurekaUnsigned('time', args.time, UINT128_MAX);
  return {
    clientState: toEurekaClientState(args.clientState),
    time: args.time,
    trustedHeight1: toEurekaHeight('trustedHeight1', args.trustedHeight1),
    trustedHeight2: toEurekaHeight('trustedHeight2', args.trustedHeight2),
    trustedConsensusState1: toEurekaConsensusState('trustedConsensusState1', args.trustedConsensusState1),
    trustedConsensusState2: toEurekaConsensusState('trustedConsensusState2', args.trustedConsensusState2),
  };
}

/** Encode the exact Solidity `MisbehaviourOutput` committed by Eureka v2.0.0. */
export function encodeEurekaMisbehaviourOutput(output: EurekaMisbehaviourOutput): Buffer {
  const clientState = encodeEurekaClientState(output.clientState);
  const tupleHeadWordCount = 12n;
  const tuple = Buffer.concat([
    encodeEurekaAbiWord(tupleHeadWordCount * ABI_WORD_BYTES),
    encodeEurekaAbiWord(output.time),
    ...encodeEurekaHeight(output.trustedHeight1),
    ...encodeEurekaHeight(output.trustedHeight2),
    ...encodeEurekaConsensusState(output.trustedConsensusState1),
    ...encodeEurekaConsensusState(output.trustedConsensusState2),
    clientState,
  ]);

  return Buffer.concat([encodeEurekaAbiWord(ABI_WORD_BYTES), tuple]);
}
