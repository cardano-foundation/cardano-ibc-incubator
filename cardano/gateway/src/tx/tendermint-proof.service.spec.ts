import { ConfigService } from '@nestjs/config';
import { Agent } from 'undici';

import {
  buildEurekaMisbehaviourOutput,
  encodeEurekaMisbehaviourOutput,
  EUREKA_MISBEHAVIOUR_PROGRAM_VKEY,
} from '../shared/types/sp1-misbehaviour';
import { buildEurekaUpdateClientOutput, encodeEurekaUpdateClientOutput } from '../shared/types/sp1-update-client';
import { proverDispatcherOptions, TendermintProofService } from './tendermint-proof.service';

const expectedOutput = buildEurekaUpdateClientOutput({
  clientState: {
    chainId: Buffer.from('injective-1').toString('hex'),
    trustLevel: { numerator: 1n, denominator: 3n },
    trustingPeriod: 1_209_600_000_000_000n,
    unbondingPeriod: 1_814_400_000_000_000n,
    maxClockDrift: 15_000_000_000n,
    frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
    latestHeight: { revisionNumber: 1n, revisionHeight: 10n },
    proofSpecs: [],
  },
  trustedConsensusState: {
    timestamp: 1n,
    root: { hash: '11'.repeat(32) },
    next_validators_hash: '22'.repeat(32),
  },
  newConsensusState: {
    timestamp: 2n,
    root: { hash: '33'.repeat(32) },
    next_validators_hash: '44'.repeat(32),
  },
  time: 3n,
  trustedHeight: { revisionNumber: 1n, revisionHeight: 10n },
  newHeight: { revisionNumber: 1n, revisionHeight: 11n },
});

const expectedMisbehaviourOutput = buildEurekaMisbehaviourOutput({
  clientState: {
    chainId: Buffer.from('injective-1').toString('hex'),
    trustLevel: { numerator: 1n, denominator: 3n },
    trustingPeriod: 1_209_600_000_000_000n,
    unbondingPeriod: 1_814_400_000_000_000n,
    maxClockDrift: 15_000_000_000n,
    frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
    latestHeight: { revisionNumber: 1n, revisionHeight: 10n },
    proofSpecs: [],
  },
  time: 3n,
  trustedHeight1: { revisionNumber: 1n, revisionHeight: 9n },
  trustedHeight2: { revisionNumber: 1n, revisionHeight: 10n },
  trustedConsensusState1: {
    timestamp: 1n,
    root: { hash: '11'.repeat(32) },
    next_validators_hash: '22'.repeat(32),
  },
  trustedConsensusState2: {
    timestamp: 2n,
    root: { hash: '33'.repeat(32) },
    next_validators_hash: '44'.repeat(32),
  },
});

function config(values: Record<string, unknown>) {
  return {
    get: jest.fn((name: string) => values[name]),
  } as unknown as ConfigService;
}

describe('TendermintProofService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fails startup when SP1 mode is missing its prover or deployed verifier', () => {
    expect(() => new TendermintProofService(config({ tendermintUpdateClientMode: 'sp1' })).onModuleInit()).toThrow(
      'SP1_TENDERMINT_PROVER_ENDPOINT',
    );

    expect(() =>
      new TendermintProofService(
        config({ tendermintUpdateClientMode: 'sp1', sp1TendermintProverEndpoint: 'http://prover' }),
      ).onModuleInit(),
    ).toThrow('validators.tendermintProof');
  });

  it('accepts a complete SP1 runtime configuration', () => {
    const service = new TendermintProofService(
      config({
        tendermintUpdateClientMode: 'sp1',
        sp1TendermintProverEndpoint: 'http://prover',
        deployment: { validators: { tendermintProof: { scriptHash: '11'.repeat(28) } } },
      }),
    );

    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('uses the configured proof timeout for response headers and bodies', () => {
    expect(proverDispatcherOptions(7_200_000)).toEqual({
      headersTimeout: 7_200_000,
      bodyTimeout: 7_200_000,
    });
  });

  it('accepts only the proof for the exact requested transition', async () => {
    const publicValues = encodeEurekaUpdateClientOutput(expectedOutput).toString('hex');
    global.fetch = jest.fn().mockImplementation(async (_url, init) => {
      const request = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          requestId: request.requestId,
          programVkey: '00d38536f65ab10e7eff0895b1b9f7cf12f89691631742bb487fe090027e0e6d',
          publicValues,
          wrappedProof: '55'.repeat(288),
        }),
        { status: 200 },
      );
    });
    const service = new TendermintProofService(
      config({ sp1TendermintProverEndpoint: 'http://prover:8080/', sp1TendermintProverTimeoutMs: 1_000 }),
    );

    await expect(
      service.proveUpdateClient({ headerBytes: Uint8Array.from([1, 2, 3]), expectedOutput }),
    ).resolves.toEqual({
      proof: '55'.repeat(288),
      publicValues,
    });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.header).toBe('AQID');
    expect(body.clientState.chainId).toBe('injective-1');
    expect(body.time).toBe('3');
    expect(body.requestId).toMatch(/^[0-9a-f]{64}$/);
    expect(init.dispatcher).toBeInstanceOf(Agent);
  });

  it('requests and accepts only the exact two-header misbehaviour proof', async () => {
    const publicValues = encodeEurekaMisbehaviourOutput(expectedMisbehaviourOutput).toString('hex');
    global.fetch = jest.fn().mockImplementation(async (_url, init) => {
      const request = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          requestId: request.requestId,
          programVkey: EUREKA_MISBEHAVIOUR_PROGRAM_VKEY,
          publicValues,
          wrappedProof: '55'.repeat(288),
        }),
        { status: 200 },
      );
    });
    const service = new TendermintProofService(
      config({ sp1TendermintProverEndpoint: 'http://prover:8080/', sp1TendermintProverTimeoutMs: 1_000 }),
    );
    const misbehaviourBytes = Uint8Array.from([4, 5, 6]);

    await expect(
      service.proveMisbehaviour({ misbehaviourBytes, expectedOutput: expectedMisbehaviourOutput }),
    ).resolves.toEqual({
      proof: '55'.repeat(288),
      publicValues,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://prover:8080/v1/tendermint/misbehaviour/proof',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body).toEqual(
      expect.objectContaining({
        program: 'sp1-ics07-tendermint-misbehaviour-v2.0.0',
        misbehaviour: 'BAUG',
        time: '3',
        trustedConsensusState1: {
          timestamp: '1',
          root: '11'.repeat(32),
          nextValidatorsHash: '22'.repeat(32),
        },
        trustedConsensusState2: {
          timestamp: '2',
          root: '33'.repeat(32),
          nextValidatorsHash: '44'.repeat(32),
        },
      }),
    );
  });

  it.each([
    ['a wrong request id', { requestId: '77'.repeat(32) }],
    [
      'the update-client program key',
      { programVkey: '00d38536f65ab10e7eff0895b1b9f7cf12f89691631742bb487fe090027e0e6d' },
    ],
    ['changed public values', { publicValues: '88'.repeat(768) }],
  ])('rejects %s on the misbehaviour endpoint', async (_name, override) => {
    global.fetch = jest.fn().mockImplementation(async (_url, init) => {
      const request = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          requestId: request.requestId,
          programVkey: EUREKA_MISBEHAVIOUR_PROGRAM_VKEY,
          publicValues: encodeEurekaMisbehaviourOutput(expectedMisbehaviourOutput).toString('hex'),
          wrappedProof: '55'.repeat(288),
          ...override,
        }),
        { status: 200 },
      );
    });
    const service = new TendermintProofService(config({ sp1TendermintProverEndpoint: 'http://prover' }));

    await expect(
      service.proveMisbehaviour({
        misbehaviourBytes: Uint8Array.from([1]),
        expectedOutput: expectedMisbehaviourOutput,
      }),
    ).rejects.toThrow();
  });

  it.each([
    ['a wrong request id', { requestId: '77'.repeat(32) }],
    ['a wrong program key', { programVkey: '99'.repeat(32) }],
    ['a changed public output', { publicValues: '88'.repeat(768) }],
    ['a short wrapped proof', { wrappedProof: '55'.repeat(287) }],
  ])('rejects %s', async (_name, override) => {
    global.fetch = jest.fn().mockImplementation(async (_url, init) => {
      const request = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          requestId: request.requestId,
          programVkey: '00d38536f65ab10e7eff0895b1b9f7cf12f89691631742bb487fe090027e0e6d',
          publicValues: encodeEurekaUpdateClientOutput(expectedOutput).toString('hex'),
          wrappedProof: '55'.repeat(288),
          ...override,
        }),
        { status: 200 },
      );
    });
    const service = new TendermintProofService(config({ sp1TendermintProverEndpoint: 'http://prover' }));

    await expect(service.proveUpdateClient({ headerBytes: Uint8Array.from([1]), expectedOutput })).rejects.toThrow();
  });

  it('fails before sending when no prover endpoint is configured', async () => {
    const service = new TendermintProofService(config({}));
    await expect(service.proveUpdateClient({ headerBytes: Uint8Array.from([1]), expectedOutput })).rejects.toThrow(
      'SP1_TENDERMINT_PROVER_ENDPOINT',
    );
  });
});
