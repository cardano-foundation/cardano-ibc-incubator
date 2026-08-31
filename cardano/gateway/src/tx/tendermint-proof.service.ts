import { createHash } from 'node:crypto';

import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent, Dispatcher } from 'undici';

import {
  encodeEurekaMisbehaviourOutput,
  EUREKA_MISBEHAVIOUR_PROGRAM_VKEY,
  EurekaMisbehaviourOutput,
} from '../shared/types/sp1-misbehaviour';
import {
  encodeEurekaUpdateClientOutput,
  EUREKA_UPDATE_CLIENT_PROGRAM_VKEY,
  EurekaClientState,
  EurekaConsensusState,
  EurekaHeight,
  EurekaUpdateClientOutput,
} from '../shared/types/sp1-update-client';

const WRAPPED_PROOF_BYTES = 288;

type ProverClientState = {
  chainId: string;
  trustLevel: { numerator: string; denominator: string };
  latestHeight: { revisionNumber: string; revisionHeight: string };
  trustingPeriod: string;
  unbondingPeriod: string;
  isFrozen: false;
  zkAlgorithm: 'groth16';
};

type ProveUpdateClientRequest = {
  requestId: string;
  program: 'sp1-ics07-tendermint-update-client-v2.0.0';
  clientState: ProverClientState;
  trustedConsensusState: ReturnType<typeof decimalConsensusState>;
  header: string;
  time: string;
};

type ProveMisbehaviourRequest = {
  requestId: string;
  program: 'sp1-ics07-tendermint-misbehaviour-v2.0.0';
  clientState: ProverClientState;
  misbehaviour: string;
  trustedConsensusState1: ReturnType<typeof decimalConsensusState>;
  trustedConsensusState2: ReturnType<typeof decimalConsensusState>;
  time: string;
};

type ProveResponse = {
  requestId?: unknown;
  programVkey?: unknown;
  publicValues?: unknown;
  wrappedProof?: unknown;
};

export type TendermintProof = {
  proof: string;
  publicValues: string;
};

export function proverDispatcherOptions(timeoutMs: number) {
  return {
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  };
}

function decimalHeight(height: EurekaHeight) {
  return {
    revisionNumber: height.revisionNumber.toString(),
    revisionHeight: height.revisionHeight.toString(),
  };
}

function decimalConsensusState(consensusState: EurekaConsensusState) {
  return {
    timestamp: consensusState.timestamp.toString(),
    root: consensusState.root,
    nextValidatorsHash: consensusState.nextValidatorsHash,
  };
}

function proverClientState(clientState: EurekaClientState): ProverClientState {
  return {
    chainId: clientState.chainId,
    trustLevel: {
      numerator: clientState.trustLevel.numerator.toString(),
      denominator: clientState.trustLevel.denominator.toString(),
    },
    latestHeight: decimalHeight(clientState.latestHeight),
    trustingPeriod: clientState.trustingPeriod.toString(),
    unbondingPeriod: clientState.unbondingPeriod.toString(),
    isFrozen: false,
    zkAlgorithm: 'groth16',
  };
}

function exactHex(name: string, value: unknown, byteLength: number): string {
  if (typeof value !== 'string') {
    throw new Error(`SP1 prover returned a non-string ${name}`);
  }
  const normalized = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length !== byteLength * 2) {
    throw new Error(`SP1 prover returned an invalid ${name}; expected ${byteLength.toString()} bytes`);
  }
  return normalized.toLowerCase();
}

@Injectable()
export class TendermintProofService implements OnModuleInit {
  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const deployment = this.configService.get<{
      tendermintClient?: { protocol?: string };
      validators?: { tendermintProof?: unknown };
    }>('deployment');
    const protocol = deployment?.tendermintClient?.protocol;
    if (protocol === '07-tendermint-direct') {
      return;
    }
    if (protocol !== '07-tendermint-sp1') {
      throw new Error('The bridge deployment must declare a supported tendermintClient.protocol');
    }
    if (!this.configService.get<string>('sp1TendermintProverEndpoint')) {
      throw new Error('SP1_TENDERMINT_PROVER_ENDPOINT is required for protocol 07-tendermint-sp1');
    }
    if (!deployment?.validators?.tendermintProof) {
      throw new Error('The bridge deployment must include validators.tendermintProof for protocol 07-tendermint-sp1');
    }
  }

  async proveUpdateClient(args: {
    headerBytes: Uint8Array;
    expectedOutput: EurekaUpdateClientOutput;
  }): Promise<TendermintProof> {
    const expectedPublicValues = encodeEurekaUpdateClientOutput(args.expectedOutput);
    const request = {
      program: 'sp1-ics07-tendermint-update-client-v2.0.0',
      clientState: proverClientState(args.expectedOutput.clientState),
      trustedConsensusState: decimalConsensusState(args.expectedOutput.trustedConsensusState),
      header: Buffer.from(args.headerBytes).toString('base64'),
      time: args.expectedOutput.time.toString(),
    } satisfies Omit<ProveUpdateClientRequest, 'requestId'>;

    return this.requestProof({
      path: '/v1/tendermint/update-client/proof',
      programName: 'update-client',
      programVkey: EUREKA_UPDATE_CLIENT_PROGRAM_VKEY,
      inputBytes: args.headerBytes,
      expectedPublicValues,
      request,
    });
  }

  async proveMisbehaviour(args: {
    misbehaviourBytes: Uint8Array;
    expectedOutput: EurekaMisbehaviourOutput;
  }): Promise<TendermintProof> {
    const expectedPublicValues = encodeEurekaMisbehaviourOutput(args.expectedOutput);
    const request = {
      program: 'sp1-ics07-tendermint-misbehaviour-v2.0.0',
      clientState: proverClientState(args.expectedOutput.clientState),
      misbehaviour: Buffer.from(args.misbehaviourBytes).toString('base64'),
      trustedConsensusState1: decimalConsensusState(args.expectedOutput.trustedConsensusState1),
      trustedConsensusState2: decimalConsensusState(args.expectedOutput.trustedConsensusState2),
      time: args.expectedOutput.time.toString(),
    } satisfies Omit<ProveMisbehaviourRequest, 'requestId'>;

    return this.requestProof({
      path: '/v1/tendermint/misbehaviour/proof',
      programName: 'misbehaviour',
      programVkey: EUREKA_MISBEHAVIOUR_PROGRAM_VKEY,
      inputBytes: args.misbehaviourBytes,
      expectedPublicValues,
      request,
    });
  }

  private async requestProof(args: {
    path: string;
    programName: string;
    programVkey: string;
    inputBytes: Uint8Array;
    expectedPublicValues: Buffer;
    request: Omit<ProveUpdateClientRequest, 'requestId'> | Omit<ProveMisbehaviourRequest, 'requestId'>;
  }): Promise<TendermintProof> {
    const endpoint = this.configService.get<string>('sp1TendermintProverEndpoint')?.replace(/\/$/, '');
    if (!endpoint) {
      throw new Error('SP1_TENDERMINT_PROVER_ENDPOINT is required for Tendermint client proofs');
    }
    const timeoutMs = this.configService.get<number>('sp1TendermintProverTimeoutMs') ?? 7_200_000;
    const expectedPublicValuesHex = args.expectedPublicValues.toString('hex');
    const requestId = createHash('sha256')
      .update(args.programVkey, 'hex')
      .update(args.inputBytes)
      .update(args.expectedPublicValues)
      .digest('hex');
    const request = { requestId, ...args.request };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    // Node's default fetch header timeout is shorter than a real Injective proof.
    const dispatcher = new Agent(proverDispatcherOptions(timeoutMs));
    try {
      let response: Response;
      try {
        const requestInit: RequestInit & { dispatcher: Dispatcher } = {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
          dispatcher,
        };
        response = await fetch(`${endpoint}${args.path}`, requestInit);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`SP1 Tendermint prover request failed: ${reason}`);
      }
      if (!response.ok) {
        const body = (await response.text()).slice(0, 1_000);
        throw new Error(`SP1 Tendermint prover returned HTTP ${response.status.toString()}: ${body}`);
      }

      let result: ProveResponse;
      try {
        result = (await response.json()) as ProveResponse;
      } catch {
        throw new Error('SP1 Tendermint prover returned invalid JSON');
      }
      const returnedRequestId = exactHex('requestId', result.requestId, 32);
      if (returnedRequestId !== requestId) {
        throw new Error('SP1 prover response does not match the requested proof job');
      }
      const programVkey = exactHex('programVkey', result.programVkey, 32);
      if (programVkey !== args.programVkey) {
        throw new Error(`SP1 prover used unexpected ${args.programName} program key ${programVkey}`);
      }
      const publicValues = exactHex('publicValues', result.publicValues, args.expectedPublicValues.length);
      if (publicValues !== expectedPublicValuesHex) {
        throw new Error('SP1 prover public output does not match the requested Cardano client transition');
      }

      return {
        proof: exactHex('wrappedProof', result.wrappedProof, WRAPPED_PROOF_BYTES),
        publicValues,
      };
    } finally {
      clearTimeout(timeout);
      await dispatcher.close();
    }
  }
}
