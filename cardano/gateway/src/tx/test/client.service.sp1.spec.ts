import { Any } from '@cardano-ibc/proto-types/build/google/protobuf/any';
import {
  Header,
  Misbehaviour as MisbehaviourMsg,
} from '@cardano-ibc/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import * as LucidEvolution from '@lucid-evolution/lucid';
import * as IbcStateRoot from '@shared/helpers/ibc-state-root';
import { ClientDatum } from '@shared/types/client-datum';
import { initializeHeader } from '@shared/types/header';
import { TENDERMINT_HEADER_TYPE_URL, TENDERMINT_MISBEHAVIOUR_TYPE_URL } from '@shared/types/misbehaviour/misbehaviour';
import { decodeTendermintProofRedeemer } from '@shared/types/tendermint-proof-redeemer';
import { MsgCreateClient } from '@cardano-ibc/proto-types/build/ibc/core/client/v1/tx';

import { ClientService } from '../client.service';
import { clientDatumMockBuilder } from './mock/client-datum';
import clientStateTendermintMockBuilder from './mock/client-state-tendermint';
import consensusStateTendermintMockBuilder from './mock/consensus-state-tendermint';
import headerMockBuilder from './mock/header';
import msgUpdateClientMockBuilder from './mock/msg-update-client';

const firstClientUtxo = {
  txHash: '11'.repeat(32),
  outputIndex: 0,
  datum: 'client-datum',
  assets: { client: 1n },
};

function compatibleClientDatum(): ClientDatum {
  const datum = clientDatumMockBuilder
    .withChainId(Buffer.from('localosmosis').toString('hex'))
    .withLatestHeight(0n, 158468n)
    .withMaxClockDrift(15_000_000_000n)
    .build();
  const trustedEntry = Array.from(datum.state.consensusStates.entries()).find(
    ([height]) => height.revisionNumber === 0n && height.revisionHeight === 158468n,
  )!;
  datum.state.consensusStates = new Map([trustedEntry]);
  datum.state.processedTimes = new Map([[trustedEntry[0], 0n]]);
  datum.state.processedHeights = new Map([[trustedEntry[0], 0n]]);
  return datum;
}

function updateMessage(typeUrl = TENDERMINT_HEADER_TYPE_URL) {
  return msgUpdateClientMockBuilder.withTypeUrl(typeUrl).build();
}

function compatibleCreateClientStateBytes(): Uint8Array {
  return clientStateTendermintMockBuilder.with_max_clock_drift(15n, 0).encode();
}

function createClientMessage(args: { clientState?: Uint8Array; consensusState?: Uint8Array } = {}): MsgCreateClient {
  return {
    client_state: {
      type_url: '/ibc.lightclients.tendermint.v1.ClientState',
      value: args.clientState ?? compatibleCreateClientStateBytes(),
    },
    consensus_state: {
      type_url: '/ibc.lightclients.tendermint.v1.ConsensusState',
      value: args.consensusState ?? consensusStateTendermintMockBuilder.encode(),
    },
    signer: 'addr_test1_gateway',
  };
}

function conflictingHeader(trustedHeight: bigint, blockMarker: number, trustedRevision = 0n): Header {
  return headerMockBuilder
    .withHeight(158477n)
    .withCommitHeight(158477n)
    .withTrustedHeight(trustedHeight, trustedRevision)
    .withTime({ seconds: 1711685790n, nanos: 941264372 })
    .withCommitBlockId(Uint8Array.from([blockMarker]), Uint8Array.from([blockMarker]))
    .build();
}

function misbehaviourUpdate(
  args: {
    innerClientId?: string;
    trustedHeight1?: bigint;
    trustedHeight2?: bigint;
    trustedRevision1?: bigint;
    trustedRevision2?: bigint;
    typeUrl?: string;
  } = {},
) {
  const evidence = MisbehaviourMsg.encode({
    client_id: args.innerClientId ?? '07-tendermint-1',
    header1: conflictingHeader(args.trustedHeight1 ?? 158468n, 1, args.trustedRevision1),
    header2: conflictingHeader(args.trustedHeight2 ?? 158468n, 2, args.trustedRevision2),
  }).finish();
  return msgUpdateClientMockBuilder
    .withClientMessage(Buffer.from(evidence))
    .withTypeUrl(args.typeUrl ?? TENDERMINT_MISBEHAVIOUR_TYPE_URL)
    .build();
}

function makeService(clientDatum: ClientDatum = compatibleClientDatum()) {
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const configService = {
    get: jest.fn((name: string) => {
      if (name === 'tendermintUpdateClientMode') return 'sp1';
      if (name === 'cardanoNetwork') return 'Preprod';
      if (name === 'ogmiosEndpoint') return 'ws://ogmios';
      return undefined;
    }),
  };
  const lucidService = {
    getClientTokenUnit: jest.fn().mockReturnValue('client-unit'),
    findUtxoByUnit: jest.fn(),
    decodeDatum: jest.fn().mockResolvedValue(clientDatum),
    tryFindUtxosAt: jest.fn().mockResolvedValue([
      {
        txHash: 'wallet',
        outputIndex: 0,
        assets: { lovelace: 10_000_000n },
      },
    ]),
    selectWalletFromAddress: jest.fn(),
    encode: jest.fn(async (_value: unknown, type: string) => `${type}-encoded`),
    findUtxoAtHostStateNFT: jest.fn(),
    createUnsignedUpdateClientTransaction: jest.fn().mockReturnValue({}),
    LucidImporter: LucidEvolution,
  };
  const txOperationRunnerService = {
    run: jest.fn().mockResolvedValue({ unsignedTxBytes: Uint8Array.from([1, 2, 3]) }),
  };
  const tendermintProofService = {
    proveUpdateClient: jest.fn(),
    proveMisbehaviour: jest.fn(),
  };
  const service = new ClientService(
    logger as any,
    configService as any,
    lucidService as any,
    txOperationRunnerService as any,
    tendermintProofService as any,
  );

  return {
    service,
    lucidService,
    txOperationRunnerService,
    tendermintProofService,
  };
}

function prepareProofUpdateBuild(service: ClientService, lucidService: ReturnType<typeof makeService>['lucidService']) {
  jest.spyOn(service as any, 'ensureTreeAligned').mockResolvedValue(undefined);
  lucidService.findUtxoAtHostStateNFT.mockResolvedValue({
    txHash: '33'.repeat(32),
    outputIndex: 0,
    datum: 'host-datum',
    assets: {},
  });
  lucidService.decodeDatum.mockResolvedValueOnce({
    state: {
      version: 1n,
      ibc_state_root: '00'.repeat(32),
      next_client_sequence: 2n,
      next_connection_sequence: 0n,
      next_channel_sequence: 0n,
      bound_port: [],
      last_update_time: 0n,
    },
    nft_policy: '55'.repeat(28),
    deployer: '66'.repeat(28),
    control: { port_registry: new Map(), shutdown: 'Active' },
  });
}

describe('ClientService SP1 update orchestration', () => {
  it('rejects client creation when the trust level does not fit the Eureka ABI', async () => {
    const { service } = makeService();
    const buildSpy = jest.spyOn(service, 'buildUnsignedCreateClientTx');
    const data = createClientMessage({
      clientState: clientStateTendermintMockBuilder.with_max_clock_drift(15n, 0).with_trust_level(256n, 256n).encode(),
    });

    await expect(service.createClient(data)).rejects.toThrow(
      'SP1 Tendermint client is incompatible with Eureka v2: clientState.trustLevel.numerator',
    );
    expect(buildSpy).not.toHaveBeenCalled();
  });

  it('rejects client creation when the initial consensus root is not 32 bytes', async () => {
    const { service } = makeService();
    const buildSpy = jest.spyOn(service, 'buildUnsignedCreateClientTx');
    const data = createClientMessage({
      consensusState: consensusStateTendermintMockBuilder.with_root(Uint8Array.from([1])).encode(),
    });

    await expect(service.createClient(data)).rejects.toThrow(
      'SP1 Tendermint client is incompatible with Eureka v2: initialConsensusState.root',
    );
    expect(buildSpy).not.toHaveBeenCalled();
  });

  it('rejects a Header payload carried under a different Any type URL', async () => {
    const { service, lucidService, tendermintProofService } = makeService();
    lucidService.findUtxoByUnit.mockResolvedValueOnce(firstClientUtxo);

    await expect(service.updateClient(updateMessage('/example.invalid.Header'))).rejects.toThrow(
      'Invalid client message',
    );

    expect(tendermintProofService.proveUpdateClient).not.toHaveBeenCalled();
  });

  it('rejects clients whose clock drift differs from Eureka v2', async () => {
    const incompatible = compatibleClientDatum();
    incompatible.state.clientState.maxClockDrift = 10_000_000_000n;
    const { service, lucidService, tendermintProofService } = makeService(incompatible);
    lucidService.findUtxoByUnit.mockResolvedValueOnce(firstClientUtxo);

    await expect(service.updateClient(updateMessage())).rejects.toThrow(
      'SP1 Tendermint clients require max_clock_drift=15000000000ns',
    );

    expect(tendermintProofService.proveUpdateClient).not.toHaveBeenCalled();
  });

  it('rejects clients above the proof history limit before starting the prover', async () => {
    const clientDatum = compatibleClientDatum();
    const templateState = Array.from(clientDatum.state.consensusStates.values())[0];
    clientDatum.state.consensusStates = new Map(
      Array.from({ length: 11 }, (_, index) => [
        { revisionNumber: 0n, revisionHeight: 158468n - BigInt(index) },
        { ...templateState, timestamp: templateState.timestamp - BigInt(index) },
      ]),
    );
    const { service, lucidService, tendermintProofService } = makeService(clientDatum);
    lucidService.findUtxoByUnit.mockResolvedValueOnce(firstClientUtxo);

    await expect(service.updateClient(updateMessage())).rejects.toThrow(
      'Proof-based Tendermint client history exceeds the 10-state limit',
    );

    expect(tendermintProofService.proveUpdateClient).not.toHaveBeenCalled();
    expect(tendermintProofService.proveMisbehaviour).not.toHaveBeenCalled();
  });

  it('keeps proof time on the first ledger snapshot and uses a fresh transaction interval', async () => {
    const { service, lucidService, txOperationRunnerService, tendermintProofService } = makeService();
    lucidService.findUtxoByUnit.mockResolvedValueOnce(firstClientUtxo).mockResolvedValueOnce(firstClientUtxo);
    tendermintProofService.proveUpdateClient.mockResolvedValueOnce({
      proof: '55'.repeat(288),
      publicValues: '66'.repeat(768),
    });
    const firstWindow = {
      currentSlot: 100,
      currentLedgerTime: 1_000_000,
      validFromTime: 990_000,
      validToSlot: 200,
      validToTime: 1_060_000,
    };
    const freshWindow = {
      currentSlot: 500,
      currentLedgerTime: 2_000_000,
      validFromTime: 1_990_000,
      validToSlot: 600,
      validToTime: 2_060_000,
    };
    jest
      .spyOn(service as any, 'computeTxValidityWindow')
      .mockResolvedValueOnce(firstWindow)
      .mockResolvedValueOnce(freshWindow);
    const unsignedTx = {} as any;
    const buildSpy = jest.spyOn(service, 'buildUnsignedUpdateClientTx').mockResolvedValueOnce({
      unsignedTx,
      pendingTreeUpdate: { expectedNewRoot: 'root', commit: jest.fn(), treeSnapshot: {} as any },
    });

    await service.updateClient(updateMessage());

    const proofArgs = tendermintProofService.proveUpdateClient.mock.calls[0][0];
    expect(proofArgs.expectedOutput.time).toBe(1_000_000_000_000n);
    expect(buildSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        currentClientUtxo: firstClientUtxo,
        proofTime: 1_000_000_000_000n,
        txValidFrom: 1_990_000_000_000n,
      }),
    );

    const plan = txOperationRunnerService.run.mock.calls[0][0];
    const validityBuilder = {
      validFrom: jest.fn().mockReturnThis(),
      validTo: jest.fn().mockReturnThis(),
    };
    plan.validity.apply(validityBuilder);
    expect(validityBuilder.validFrom).toHaveBeenCalledWith(freshWindow.validFromTime);
    expect(validityBuilder.validTo).toHaveBeenCalledWith(freshWindow.validToTime);
  });

  it('rejects a proof when the client out-ref changes while proving', async () => {
    const { service, lucidService, tendermintProofService } = makeService();
    const advancedClientUtxo = {
      ...firstClientUtxo,
      txHash: '22'.repeat(32),
    };
    lucidService.findUtxoByUnit.mockResolvedValueOnce(firstClientUtxo).mockResolvedValueOnce(advancedClientUtxo);
    jest.spyOn(service as any, 'computeTxValidityWindow').mockResolvedValue({
      currentSlot: 100,
      currentLedgerTime: 1_000_000,
      validFromTime: 990_000,
      validToSlot: 200,
      validToTime: 1_060_000,
    });
    let finishProof!: (proof: { proof: string; publicValues: string }) => void;
    tendermintProofService.proveUpdateClient.mockReturnValueOnce(
      new Promise((resolve) => {
        finishProof = resolve;
      }),
    );
    const buildSpy = jest.spyOn(service, 'buildUnsignedUpdateClientTx');

    const update = service.updateClient(updateMessage());
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(lucidService.findUtxoByUnit).toHaveBeenCalledTimes(1);

    finishProof({ proof: '55'.repeat(288), publicValues: '66'.repeat(768) });
    await expect(update).rejects.toThrow('The Tendermint client advanced while its proof was being created; retry');

    expect(lucidService.findUtxoByUnit).toHaveBeenCalledTimes(2);
    expect(buildSpy).not.toHaveBeenCalled();
  });

  it('routes exact two-header evidence through the misbehaviour prover and preserves its original Any', async () => {
    const { service, lucidService, txOperationRunnerService, tendermintProofService } = makeService();
    const data = misbehaviourUpdate();
    lucidService.findUtxoByUnit.mockResolvedValueOnce(firstClientUtxo).mockResolvedValueOnce(firstClientUtxo);
    tendermintProofService.proveMisbehaviour.mockResolvedValueOnce({
      proof: '77'.repeat(288),
      publicValues: '88'.repeat(768),
    });
    const initialWindow = {
      currentSlot: 100,
      currentLedgerTime: 1_000_000,
      validFromTime: 990_000,
      validToSlot: 200,
      validToTime: 1_060_000,
    };
    const freshWindow = {
      currentSlot: 500,
      currentLedgerTime: 2_000_000,
      validFromTime: 1_990_000,
      validToSlot: 600,
      validToTime: 2_060_000,
    };
    jest
      .spyOn(service as any, 'computeTxValidityWindow')
      .mockResolvedValueOnce(initialWindow)
      .mockResolvedValueOnce(freshWindow);
    const unsignedTx = {} as any;
    const buildSpy = jest.spyOn(service, 'buildUnsignedUpdateOnMisbehaviour').mockResolvedValueOnce({
      unsignedTx,
      pendingTreeUpdate: { expectedNewRoot: 'root', commit: jest.fn(), treeSnapshot: {} as any },
    });

    await service.updateClient(data);

    const proverArgs = tendermintProofService.proveMisbehaviour.mock.calls[0][0];
    expect(Buffer.from(proverArgs.misbehaviourBytes)).toEqual(Buffer.from(data.client_message.value));
    expect(proverArgs.expectedOutput).toEqual(
      expect.objectContaining({
        time: 1_000_000_000_000n,
        trustedHeight1: { revisionNumber: 0n, revisionHeight: 158468n },
        trustedHeight2: { revisionNumber: 0n, revisionHeight: 158468n },
      }),
    );
    expect(proverArgs.expectedOutput.trustedConsensusState1).toEqual(proverArgs.expectedOutput.trustedConsensusState2);
    expect(tendermintProofService.proveUpdateClient).not.toHaveBeenCalled();
    expect(buildSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        clientMessage: data.client_message,
        currentClientUtxo: firstClientUtxo,
        proof: '77'.repeat(288),
        proofTime: 1_000_000_000_000n,
        trustedHeight1: { revisionNumber: 0n, revisionHeight: 158468n },
        trustedHeight2: { revisionNumber: 0n, revisionHeight: 158468n },
      }),
    );

    const plan = txOperationRunnerService.run.mock.calls[0][0];
    const validityBuilder = {
      validFrom: jest.fn().mockReturnThis(),
      validTo: jest.fn().mockReturnThis(),
    };
    plan.validity.apply(validityBuilder);
    expect(validityBuilder.validFrom).toHaveBeenCalledWith(freshWindow.validFromTime);
    expect(validityBuilder.validTo).toHaveBeenCalledWith(freshWindow.validToTime);
    expect(plan.persistSyntheticEvents).toBe(true);
    const originalAnyHex = Buffer.from(Any.encode(data.client_message).finish()).toString('hex');
    expect(plan.syntheticEvents[0].attributes).toEqual(
      expect.arrayContaining([
        { key: 'consensus_height', value: '0-1' },
        { key: 'client_message_any_hex', value: originalAnyHex },
      ]),
    );
  });

  it('does not route two-header bytes carried under the Header type URL to the prover', async () => {
    const { service, lucidService, tendermintProofService } = makeService();
    lucidService.findUtxoByUnit.mockResolvedValueOnce(firstClientUtxo);

    await expect(service.updateClient(misbehaviourUpdate({ typeUrl: TENDERMINT_HEADER_TYPE_URL }))).rejects.toThrow();

    expect(tendermintProofService.proveMisbehaviour).not.toHaveBeenCalled();
    expect(tendermintProofService.proveUpdateClient).not.toHaveBeenCalled();
  });

  it('requires the evidence client id to match the outer update message exactly', async () => {
    const { service, lucidService, tendermintProofService } = makeService();
    lucidService.findUtxoByUnit.mockResolvedValueOnce(firstClientUtxo);

    await expect(service.updateClient(misbehaviourUpdate({ innerClientId: '07-tendermint-2' }))).rejects.toThrow(
      'Tendermint misbehaviour client_id 07-tendermint-2 does not match 07-tendermint-1',
    );

    expect(tendermintProofService.proveMisbehaviour).not.toHaveBeenCalled();
  });

  it('resolves each trusted consensus state by full revision and height', async () => {
    const { service, lucidService, tendermintProofService } = makeService();
    lucidService.findUtxoByUnit.mockResolvedValueOnce(firstClientUtxo);

    await expect(service.updateClient(misbehaviourUpdate({ trustedRevision2: 1n }))).rejects.toThrow(
      'No trusted consensus state exists for misbehaviour header2 at 1-158468',
    );

    expect(tendermintProofService.proveMisbehaviour).not.toHaveBeenCalled();
  });

  it('rejects two-header evidence when the client out-ref changes while proving', async () => {
    const { service, lucidService, tendermintProofService } = makeService();
    const advancedClientUtxo = { ...firstClientUtxo, txHash: '22'.repeat(32) };
    lucidService.findUtxoByUnit.mockResolvedValueOnce(firstClientUtxo).mockResolvedValueOnce(advancedClientUtxo);
    jest.spyOn(service as any, 'computeTxValidityWindow').mockResolvedValue({
      currentSlot: 100,
      currentLedgerTime: 1_000_000,
      validFromTime: 990_000,
      validToSlot: 200,
      validToTime: 1_060_000,
    });
    let finishProof!: (proof: { proof: string; publicValues: string }) => void;
    tendermintProofService.proveMisbehaviour.mockReturnValueOnce(
      new Promise((resolve) => {
        finishProof = resolve;
      }),
    );
    const buildSpy = jest.spyOn(service, 'buildUnsignedUpdateOnMisbehaviour');

    const update = service.updateClient(misbehaviourUpdate());
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(lucidService.findUtxoByUnit).toHaveBeenCalledTimes(1);

    finishProof({ proof: '77'.repeat(288), publicValues: '88'.repeat(768) });
    await expect(update).rejects.toThrow('The Tendermint client advanced while its proof was being created; retry');

    expect(lucidService.findUtxoByUnit).toHaveBeenCalledTimes(2);
    expect(buildSpy).not.toHaveBeenCalled();
  });

  it('retains expired consensus states below capacity in a proof update', async () => {
    const clientDatum = compatibleClientDatum();
    const latestHeight = { revisionNumber: 0n, revisionHeight: 158468n };
    const expiredHeight = { revisionNumber: 0n, revisionHeight: 158467n };
    const latestConsensusState = {
      timestamp: 950n,
      next_validators_hash: '11'.repeat(32),
      root: { hash: '22'.repeat(32) },
    };
    const expiredConsensusState = {
      timestamp: 100n,
      next_validators_hash: '33'.repeat(32),
      root: { hash: '44'.repeat(32) },
    };
    clientDatum.state.clientState.trustingPeriod = 100n;
    clientDatum.state.consensusStates = new Map([
      [latestHeight, latestConsensusState],
      [expiredHeight, expiredConsensusState],
    ]);
    clientDatum.state.processedTimes = new Map([
      [latestHeight, 11n],
      [expiredHeight, 22n],
    ]);
    clientDatum.state.processedHeights = new Map([
      [latestHeight, 33n],
      [expiredHeight, 44n],
    ]);

    const { service, lucidService } = makeService(clientDatum);
    const rootSpy = jest.spyOn(IbcStateRoot, 'computeRootWithUpdateClientUpdate').mockReturnValue({
      newRoot: 'ab'.repeat(32),
      clientStateSiblings: [],
      consensusStateSiblings: [],
      removedConsensusStateSiblings: [],
      treeSnapshot: {} as any,
      commit: jest.fn(),
    });
    jest.spyOn(service as any, 'ensureTreeAligned').mockResolvedValue(undefined);
    lucidService.findUtxoAtHostStateNFT.mockResolvedValue({
      txHash: '33'.repeat(32),
      outputIndex: 0,
      datum: 'host-datum',
      assets: {},
    });
    lucidService.decodeDatum.mockResolvedValueOnce({
      state: {
        version: 1n,
        ibc_state_root: '00'.repeat(32),
        next_client_sequence: 2n,
        next_connection_sequence: 0n,
        next_channel_sequence: 0n,
        bound_port: [],
        last_update_time: 0n,
      },
      nft_policy: '55'.repeat(28),
      deployer: '66'.repeat(28),
      control: { port_registry: new Map(), shutdown: 'Active' },
    });

    try {
      await service.buildUnsignedUpdateClientTx({
        clientId: '1',
        header: initializeHeader(headerMockBuilder.build()),
        constructedAddress: 'addr_test1_gateway',
        clientDatum,
        clientTokenUnit: 'client-unit',
        currentClientUtxo: firstClientUtxo as any,
        txValidFrom: 1_000n,
        proof: '77'.repeat(288),
        proofTime: 900n,
      });

      const clientEncodingCall = lucidService.encode.mock.calls.find((call) => call[1] === 'client');
      const outputClientDatum = clientEncodingCall![0] as ClientDatum;
      expect(Array.from(outputClientDatum.state.consensusStates.keys())).toEqual([
        { revisionNumber: 0n, revisionHeight: 158477n },
        latestHeight,
        expiredHeight,
      ]);
      expect(outputClientDatum.state.consensusStates.get(expiredHeight)).toEqual(expiredConsensusState);
      expect(Array.from(outputClientDatum.state.processedTimes.entries()).slice(1)).toEqual([
        [latestHeight, 11n],
        [expiredHeight, 22n],
      ]);
      expect(Array.from(outputClientDatum.state.processedHeights.entries()).slice(1)).toEqual([
        [latestHeight, 33n],
        [expiredHeight, 44n],
      ]);
      expect(rootSpy).toHaveBeenCalledWith(
        '00'.repeat(32),
        '07-tendermint-1',
        expect.any(Buffer),
        [],
        expect.objectContaining({ height: '158477' }),
      );
    } finally {
      rootSpy.mockRestore();
    }
  });

  it('keeps exactly ten consensus states when a proof update reaches its history limit', async () => {
    const clientDatum = compatibleClientDatum();
    const templateState = Array.from(clientDatum.state.consensusStates.values())[0];
    const entries = Array.from({ length: 10 }, (_, index) => {
      const height = { revisionNumber: 0n, revisionHeight: 158468n - BigInt(index) };
      return [height, { ...templateState, timestamp: templateState.timestamp - BigInt(index) }] as const;
    });
    clientDatum.state.consensusStates = new Map(entries);
    clientDatum.state.processedTimes = new Map(entries.map(([height], index) => [height, BigInt(index + 1)]));
    clientDatum.state.processedHeights = new Map(entries.map(([height], index) => [height, BigInt(index + 11)]));

    const { service, lucidService } = makeService(clientDatum);
    prepareProofUpdateBuild(service, lucidService);
    const rootSpy = jest.spyOn(IbcStateRoot, 'computeRootWithUpdateClientUpdate').mockReturnValue({
      newRoot: 'ab'.repeat(32),
      clientStateSiblings: [],
      consensusStateSiblings: [],
      removedConsensusStateSiblings: [],
      treeSnapshot: {} as any,
      commit: jest.fn(),
    });

    try {
      await service.buildUnsignedUpdateClientTx({
        clientId: '1',
        header: initializeHeader(headerMockBuilder.build()),
        constructedAddress: 'addr_test1_gateway',
        clientDatum,
        clientTokenUnit: 'client-unit',
        currentClientUtxo: firstClientUtxo as any,
        txValidFrom: 1_000n,
        proof: '77'.repeat(288),
        proofTime: 900n,
      });

      const clientEncodingCall = lucidService.encode.mock.calls.find((call) => call[1] === 'client');
      const outputClientDatum = clientEncodingCall![0] as ClientDatum;
      expect(Array.from(outputClientDatum.state.consensusStates.keys())).toEqual([
        { revisionNumber: 0n, revisionHeight: 158477n },
        ...entries.slice(0, 9).map(([height]) => height),
      ]);
      expect(rootSpy).toHaveBeenCalledWith(
        '00'.repeat(32),
        '07-tendermint-1',
        expect.any(Buffer),
        ['158459'],
        expect.objectContaining({ height: '158477' }),
      );
    } finally {
      rootSpy.mockRestore();
    }
  });

  it('rejects proof updates whose input already exceeds ten consensus states', async () => {
    const clientDatum = compatibleClientDatum();
    const templateState = Array.from(clientDatum.state.consensusStates.values())[0];
    const entries = Array.from({ length: 11 }, (_, index) => {
      const height = { revisionNumber: 0n, revisionHeight: 158468n - BigInt(index) };
      return [height, { ...templateState, timestamp: templateState.timestamp - BigInt(index) }] as const;
    });
    clientDatum.state.consensusStates = new Map(entries);

    const { service, lucidService } = makeService(clientDatum);
    await expect(
      service.buildUnsignedUpdateClientTx({
        clientId: '1',
        header: initializeHeader(headerMockBuilder.build()),
        constructedAddress: 'addr_test1_gateway',
        clientDatum,
        clientTokenUnit: 'client-unit',
        currentClientUtxo: firstClientUtxo as any,
        txValidFrom: 1_000n,
        proof: '77'.repeat(288),
        proofTime: 900n,
      }),
    ).rejects.toThrow('Proof-based Tendermint client history exceeds the 10-state limit');
    expect(lucidService.findUtxoAtHostStateNFT).not.toHaveBeenCalled();
    expect(lucidService.createUnsignedUpdateClientTransaction).not.toHaveBeenCalled();
  });

  it('builds proof misbehaviour as a freeze-only client update with the Misbehaviour redeemer', async () => {
    const clientDatum = compatibleClientDatum();
    const { service, lucidService } = makeService(clientDatum);
    const commit = jest.fn();
    const rootSpy = jest.spyOn(IbcStateRoot, 'computeRootWithUpdateClientUpdate').mockReturnValue({
      newRoot: 'ab'.repeat(32),
      clientStateSiblings: [],
      consensusStateSiblings: [],
      removedConsensusStateSiblings: [],
      treeSnapshot: {} as any,
      commit,
    });
    jest.spyOn(service as any, 'ensureTreeAligned').mockResolvedValue(undefined);
    lucidService.findUtxoAtHostStateNFT.mockResolvedValue({
      txHash: '33'.repeat(32),
      outputIndex: 0,
      datum: 'host-datum',
      assets: {},
    });
    lucidService.decodeDatum.mockResolvedValueOnce({
      state: {
        version: 1n,
        ibc_state_root: '00'.repeat(32),
        next_client_sequence: 2n,
        next_connection_sequence: 0n,
        next_channel_sequence: 0n,
        bound_port: [],
        last_update_time: 0n,
      },
      nft_policy: '44'.repeat(28),
      deployer: '55'.repeat(28),
      control: { port_registry: new Map(), shutdown: 'Active' },
    });
    const data = misbehaviourUpdate();

    await service.buildUnsignedUpdateOnMisbehaviour({
      clientId: '1',
      clientMessage: data.client_message,
      constructedAddress: data.signer,
      clientDatum,
      clientTokenUnit: 'client-unit',
      currentClientUtxo: firstClientUtxo as any,
      proof: '77'.repeat(288),
      proofTime: 1_000_000_000_000n,
      trustedHeight1: { revisionNumber: 0n, revisionHeight: 158468n },
      trustedHeight2: { revisionNumber: 0n, revisionHeight: 158468n },
    });

    const clientEncodingCall = lucidService.encode.mock.calls.find((call) => call[1] === 'client');
    const outputClientDatum = clientEncodingCall![0] as ClientDatum;
    expect(outputClientDatum.state.clientState).toEqual({
      ...clientDatum.state.clientState,
      frozenHeight: { revisionNumber: 0n, revisionHeight: 1n },
    });
    expect(outputClientDatum.state.consensusStates).toEqual(clientDatum.state.consensusStates);
    expect(outputClientDatum.state.processedTimes).toEqual(clientDatum.state.processedTimes);
    expect(outputClientDatum.state.processedHeights).toEqual(clientDatum.state.processedHeights);
    expect(rootSpy).toHaveBeenCalledWith('00'.repeat(32), '07-tendermint-1', expect.any(Buffer), [], undefined);
    expect(lucidService.encode).toHaveBeenCalledWith('UpdateClientProof', 'spendClientRedeemer');

    const transactionArgs = lucidService.createUnsignedUpdateClientTransaction.mock.calls[0];
    const proofRedeemer = decodeTendermintProofRedeemer(transactionArgs[8], LucidEvolution);
    expect(proofRedeemer).toEqual({
      Misbehaviour: {
        client_input_ref: {
          transaction_id: firstClientUtxo.txHash,
          output_index: 0n,
        },
        trusted_height_1: { revisionNumber: 0n, revisionHeight: 158468n },
        trusted_height_2: { revisionNumber: 0n, revisionHeight: 158468n },
        proof_time: 1_000_000_000_000n,
        proof: '77'.repeat(288),
      },
    });
  });
});
