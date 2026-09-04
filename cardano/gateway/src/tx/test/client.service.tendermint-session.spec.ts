import * as Lucid from '@lucid-evolution/lucid';
import { BinaryReader } from '@cardano-ibc/proto-types/build/binary';

import { EVENT_TYPE_CLIENT } from '../../constant';
import { IbcTreePendingUpdatesService } from '../../shared/services/ibc-tree-pending-updates.service';
import {
  decodeSessionDatum,
  encodeSessionDatum,
  type SessionDatum,
  type TargetEntry,
  type UpdatePlan,
} from '../../shared/types/tendermint-update-session';
import * as HeaderCodec from '../../shared/types/header';
import * as ClientMessageCodec from '../../shared/types/msgs/client-message';
import * as MisbehaviourCodec from '../../shared/types/misbehaviour/misbehaviour';
import {
  ClientService,
  TENDERMINT_FINALIZATION_TIME_TO_LIVE,
  TENDERMINT_HEADER_TYPE_URL,
  TENDERMINT_UPDATE_CHAIN_TIME_TO_LIVE,
} from '../client.service';
import {
  MAX_TENDERMINT_UPDATE_TX_CHAIN_LENGTH,
  TENDERMINT_UPDATE_TX_CHAIN_TYPE_URL,
} from '../tendermint-update-tx-chain';
import { TxEventsService } from '../tx-events.service';
import { TxOperationRunnerService } from '../tx-operation-runner.service';
import * as SessionState from '../update-client-session-state';
import * as StagedPayload from '../update-client-staged-payload';
import headerMockBuilder from './mock/header';

const OWNER = 'ab'.repeat(28);
const POLICY_ID = 'cd'.repeat(28);
const SESSION_ADDRESS = 'addr_test1_session';
const CLIENT_ADDRESS = 'addr_test1_client';
const DIGEST = '11'.repeat(32);
const TEST_CURRENT_LEDGER_TIME_MS = 1_000;
const TEST_VALID_FROM_TIME_MS = 1_000;
const TEST_VALID_TO_TIME_MS = 1_801_000;
const TEST_FINAL_VALID_TO_TIME_MS = TEST_CURRENT_LEDGER_TIME_MS + TENDERMINT_FINALIZATION_TIME_TO_LIVE;
const TEST_SLOT_CONFIG = { zeroTime: 0, zeroSlot: 0, slotLength: 1_000 };

const PLAN: UpdatePlan = {
  clientToken: { policyId: '01', name: '02' },
  trustedHeight: { revisionNumber: 0n, revisionHeight: 10n },
  trustedConsensusState: {
    timestamp: 1_000n,
    next_validators_hash: DIGEST,
    root: { hash: '22'.repeat(32) },
  },
  trustLevel: { numerator: 1n, denominator: 3n },
  trustingPeriod: 10_000n,
  maxClockDrift: 1_000n,
  header: {
    version: { block: 1n, app: 1n },
    chainId: Buffer.from('chain-0').toString('hex'),
    height: 11n,
    time: 2_000n,
    lastBlockId: {
      hash: '23'.repeat(32),
      partSetHeader: { total: 1n, hash: '24'.repeat(32) },
    },
    lastCommitHash: '25'.repeat(32),
    dataHash: '26'.repeat(32),
    validatorsHash: '27'.repeat(32),
    nextValidatorsHash: '28'.repeat(32),
    consensusHash: '29'.repeat(32),
    appHash: '2a'.repeat(32),
    lastResultsHash: '2b'.repeat(32),
    evidenceHash: '2c'.repeat(32),
    proposerAddress: '2d'.repeat(20),
  },
  commit: {
    height: 11n,
    round: 0n,
    blockId: {
      hash: '2e'.repeat(32),
      partSetHeader: { total: 1n, hash: '2f'.repeat(32) },
    },
  },
  targetValidatorCount: 10n,
  trustedValidatorCount: 0n,
};

const TARGET_ENTRY: TargetEntry = {
  targetValidator: {
    address: '31'.repeat(20),
    pubkey: '32'.repeat(32),
    votingPower: 10n,
    proposerPriority: 0n,
  },
  commitSig: {
    block_id_flag: 2n,
    validator_address: '31'.repeat(20),
    timestamp: 2_000n,
    signature: '33'.repeat(64),
  },
  trustedMembership: null,
};

const PAYLOADS: StagedPayload.TendermintStagedPayloads = {
  targetValidatorRoot: PLAN.header.validatorsHash,
  trustedValidatorRoot: null,
  trustedBatches: [],
  targetBatches: [],
};

const HEADER = {
  signedHeader: {
    header: PLAN.header,
    commit: { ...PLAN.commit, signatures: [] },
  },
  validatorSet: { validators: Array.from({ length: 10 }, () => TARGET_ENTRY.targetValidator) },
  trustedHeight: PLAN.trustedHeight,
  trustedValidators: { validators: [] },
} as any;

const CLIENT_DATUM = {
  token: PLAN.clientToken,
  state: {
    clientState: {
      chainId: PLAN.header.chainId,
      trustLevel: PLAN.trustLevel,
      trustingPeriod: 3_600_000_000_000n,
      unbondingPeriod: 7_200_000_000_000n,
      maxClockDrift: 30_000_000_000n,
      frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
      latestHeight: { revisionNumber: 0n, revisionHeight: 10n },
      proofSpecs: [],
    },
    consensusStates: new Map([
      [
        { revisionNumber: 0n, revisionHeight: 10n },
        {
          timestamp: PLAN.trustedConsensusState.timestamp,
          next_validators_hash: PLAN.trustedConsensusState.next_validators_hash,
          root: { ...PLAN.trustedConsensusState.root },
        },
      ],
    ]),
    processedTimes: new Map(),
    processedHeights: new Map(),
  },
} as any;

const UPDATE_MESSAGE = {
  client_id: '07-tendermint-7',
  signer: 'addr_test1_operator',
  client_message: {
    type_url: '/ibc.lightclients.tendermint.v1.Header',
    value: Uint8Array.from([1, 2, 3]),
  },
} as any;

function createTxBuilder(hash: string, cbor = `cbor-${hash}`, derivedOutputs: any[] = []): any {
  const builder: any = {};
  builder.validFrom = jest.fn().mockReturnValue(builder);
  builder.validTo = jest.fn().mockReturnValue(builder);
  const completed = {
    toCBOR: () => cbor,
    toHash: () => hash,
  };
  builder.complete = jest.fn().mockResolvedValue(completed);
  builder.chain = jest.fn().mockResolvedValue([
    [utxo(`${hash}-wallet-change`)],
    derivedOutputs,
    {
      toCBOR: () => Buffer.from(cbor, 'utf8').toString('hex'),
      toHash: () => hash,
    },
  ]);
  return builder;
}

function utxo(txHash: string, outputIndex = 0): any {
  return {
    txHash,
    outputIndex,
    address: UPDATE_MESSAGE.signer,
    assets: { lovelace: 5_000_000n },
  };
}

function clientUtxo(txHash = 'client-input'): any {
  return {
    ...utxo(txHash),
    address: CLIENT_ADDRESS,
    assets: { lovelace: 3_000_000n, 'client-unit': 1n },
    datum: 'client-datum',
  };
}

function sessionUtxo(datum: SessionDatum, txHash = 'session-input'): any {
  const tokenUnit = datum.sessionToken.policyId + datum.sessionToken.name;
  return {
    txHash,
    outputIndex: 0,
    address: SESSION_ADDRESS,
    assets: { lovelace: 3_000_000n, [tokenUnit]: 1n },
    datum: encodeSessionDatum(datum, Lucid),
  };
}

function derivedSessionOutput(encodedDatum: string, tokenUnit: string, txHash: string): any {
  return {
    ...utxo(txHash),
    address: SESSION_ADDRESS,
    assets: { lovelace: 3_000_000n, [tokenUnit]: 1n },
    datum: encodedDatum,
  };
}

function decodeChainEnvelope(value: Uint8Array): {
  unsignedTxCbor: string[];
  rebuildAfterSubmission: boolean;
} {
  const reader = new BinaryReader(value);
  expect(reader.uint32()).toBe(8);
  expect(reader.uint32()).toBe(1);
  const unsignedTxCbor: string[] = [];
  let rebuildAfterSubmission = false;
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    if (tag === 18) {
      unsignedTxCbor.push(reader.string());
    } else {
      expect(tag).toBe(24);
      rebuildAfterSubmission = reader.bool();
    }
  }
  return { unsignedTxCbor, rebuildAfterSubmission };
}

function decodeChainCbor(value: Uint8Array): string[] {
  return decodeChainEnvelope(value).unsignedTxCbor;
}

function makeHarness() {
  const pendingUpdates = new IbcTreePendingUpdatesService();
  const txEvents = new TxEventsService();
  let stagedOutputIndex = 0;
  const lucidService: any = {
    LucidImporter: Lucid,
    beginWalletSelectionScope: jest.fn().mockReturnValue(1),
    assertWalletSelectionScopeSatisfied: jest.fn(),
    endWalletSelectionScope: jest.fn(),
    getPaymentCredential: jest.fn().mockReturnValue({ type: 'Key', hash: OWNER }),
    credentialToAddress: jest.fn((address: string) => address),
    getTendermintUpdateSessionPolicyId: jest.fn().mockReturnValue(POLICY_ID),
    getTendermintUpdateSessionAddress: jest.fn().mockReturnValue(SESSION_ADDRESS),
    hasStagedTendermintClient: jest.fn().mockReturnValue(true),
    getClientTokenUnit: jest.fn().mockReturnValue('client-unit'),
    findUtxoByUnit: jest.fn().mockResolvedValue(clientUtxo()),
    decodeDatum: jest.fn().mockResolvedValue(CLIENT_DATUM),
    tryFindUtxosAt: jest.fn(),
    queryLedgerStateUtxosAtAddresses: jest.fn(),
    createUnsignedTendermintSessionTransaction: jest.fn((_seed, _redeemer, encodedDatum: string, tokenUnit: string) => {
      stagedOutputIndex += 1;
      return createTxBuilder(`initialize-${stagedOutputIndex}`, undefined, [
        derivedSessionOutput(encodedDatum, tokenUnit, `initialize-output-${stagedOutputIndex}`),
      ]);
    }),
    createUnsignedAdvanceTendermintSessionTransaction: jest.fn(
      (_session, _redeemer, encodedDatum: string, tokenUnit: string) => {
        stagedOutputIndex += 1;
        return createTxBuilder(`advance-${stagedOutputIndex}`, undefined, [
          derivedSessionOutput(encodedDatum, tokenUnit, `advance-output-${stagedOutputIndex}`),
        ]);
      },
    ),
    createUnsignedCancelTendermintSessionTransaction: jest.fn(() => createTxBuilder('cancel-session')),
    createUnsignedFinalizeTendermintSessionTransaction: jest.fn(),
    selectWalletFromAddress: jest.fn(),
  };
  const walletContext = {
    selectWalletFromAddressWithRetry: jest.fn().mockResolvedValue(undefined),
  };
  const runner = new TxOperationRunnerService(lucidService, walletContext as any, txEvents, pendingUpdates);
  const runnerSpy = jest.spyOn(runner, 'run');
  const runnerChainSpy = jest.spyOn(runner, 'runChain');
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const configService = { get: jest.fn() };
  const service = new ClientService(logger as any, configService as any, lucidService, runner);
  const computeValidityWindow = jest.spyOn(service as any, 'computeTxValidityWindow').mockResolvedValue({
    currentSlot: 1,
    currentLedgerTime: TEST_CURRENT_LEDGER_TIME_MS,
    validFromTime: TEST_VALID_FROM_TIME_MS,
    validToSlot: TEST_FINAL_VALID_TO_TIME_MS / TEST_SLOT_CONFIG.slotLength,
    validToTime: TEST_FINAL_VALID_TO_TIME_MS,
    slotConfig: TEST_SLOT_CONFIG,
  });
  const buildFinal = jest.spyOn(service, 'buildUnsignedUpdateClientTx').mockResolvedValue({
    unsignedTx: createTxBuilder('default-final'),
    pendingTreeUpdate: { expectedNewRoot: 'ff'.repeat(32), commit: jest.fn() },
  });

  return {
    service,
    lucidService,
    pendingUpdates,
    txEvents,
    runnerSpy,
    runnerChainSpy,
    computeValidityWindow,
    buildFinal,
  };
}

function updateOperator(): any {
  return {
    clientId: '7',
    header: HEADER,
    constructedAddress: UPDATE_MESSAGE.signer,
    clientDatum: CLIENT_DATUM,
    clientTokenUnit: 'client-unit',
    currentClientUtxo: clientUtxo(),
    txValidFrom: 1_000_000n,
  };
}

let verifyClientMessage: jest.SpiedFunction<typeof ClientMessageCodec.verifyClientMessage>;
let checkForMisbehaviour: jest.SpiedFunction<typeof MisbehaviourCodec.checkForMisbehaviour>;

function installStagedTendermintTestSpies(): void {
  beforeEach(() => {
    verifyClientMessage = jest.spyOn(ClientMessageCodec, 'verifyClientMessage');
    checkForMisbehaviour = jest.spyOn(MisbehaviourCodec, 'checkForMisbehaviour');
    jest.spyOn(SessionState, 'deriveTendermintSessionUpdatePlan').mockReturnValue(PLAN);
    jest.spyOn(StagedPayload, 'buildTendermintStagedPayloads').mockReturnValue(PAYLOADS);
    jest.spyOn(SessionState, 'nextTendermintSessionAdvance').mockReturnValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
}

function completeSessionAfterOneAdvance(): SessionDatum['phase'] {
  const completePhase: SessionDatum['phase'] = {
    Complete: {
      targetRoot: PLAN.header.validatorsHash,
      targetTotalPower: 100n,
      targetSignedPower: 80n,
      trustedRoot: null,
      trustedTotalPower: 0n,
      trustedSignedPower: 0n,
    },
  };
  jest.mocked(SessionState.nextTendermintSessionAdvance).mockImplementation((datum) =>
    'Complete' in datum.phase
      ? null
      : {
          VerifyTarget: { entries: [TARGET_ENTRY] },
        },
  );
  jest.spyOn(SessionState, 'advanceTendermintSession').mockImplementation((datum) => ({
    ...datum,
    phase: completePhase,
  }));
  return completePhase;
}

describe('ClientService staged Tendermint update chain integration', () => {
  installStagedTendermintTestSpies();

  it('routes a real adjacent Header type to staged initialization without the legacy JS verifier', async () => {
    const { service, lucidService, computeValidityWindow, buildFinal } = makeHarness();
    completeSessionAfterOneAdvance();
    const seed = utxo('00'.repeat(32), 1);
    const adjacentHeader = headerMockBuilder.withTrustedHeight(158476n, 0n).encode();
    const initializedAdjacentHeader = HeaderCodec.initializeHeader(HeaderCodec.decodeHeader(adjacentHeader));
    const headerTimeMs = Number(initializedAdjacentHeader.signedHeader.header.time / 1_000_000n);
    const realClientDatum = {
      ...CLIENT_DATUM,
      state: {
        ...CLIENT_DATUM.state,
        clientState: {
          ...CLIENT_DATUM.state.clientState,
          chainId: initializedAdjacentHeader.signedHeader.header.chainId,
          trustingPeriod: 1_209_600_000_000_000n,
          latestHeight: { ...initializedAdjacentHeader.trustedHeight },
        },
        consensusStates: new Map([
          [
            { ...initializedAdjacentHeader.trustedHeight },
            {
              timestamp: initializedAdjacentHeader.signedHeader.header.time - 1_000_000_000n,
              next_validators_hash: DIGEST,
              root: { hash: '22'.repeat(32) },
            },
          ],
        ]),
      },
    };
    const message = {
      ...UPDATE_MESSAGE,
      client_message: {
        type_url: TENDERMINT_HEADER_TYPE_URL,
        value: adjacentHeader,
      },
    };
    const decodeHeader = jest.spyOn(HeaderCodec, 'decodeHeader');
    jest.spyOn(service as any, 'refreshWalletContext').mockResolvedValue(undefined);
    computeValidityWindow.mockResolvedValue({
      currentSlot: 1,
      currentLedgerTime: headerTimeMs,
      validFromTime: headerTimeMs - 29_000,
      validToSlot: 2,
      validToTime: headerTimeMs + TENDERMINT_UPDATE_CHAIN_TIME_TO_LIVE,
      slotConfig: TEST_SLOT_CONFIG,
    });
    lucidService.decodeDatum.mockResolvedValue(realClientDatum);
    lucidService.tryFindUtxosAt.mockImplementation(async (address: string) =>
      address === SESSION_ADDRESS ? [] : [seed],
    );
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo(), seed]);

    const response = await service.updateClient(message);

    expect(response.unsigned_tx.type_url).toBe(TENDERMINT_UPDATE_TX_CHAIN_TYPE_URL);
    expect(decodeChainCbor(response.unsigned_tx.value)).toHaveLength(2);
    expect(decodeChainEnvelope(response.unsigned_tx.value).rebuildAfterSubmission).toBe(true);
    expect(decodeHeader).toHaveBeenCalledWith(adjacentHeader);
    expect(SessionState.deriveTendermintSessionUpdatePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        header: expect.objectContaining({
          trustedHeight: { revisionNumber: 0n, revisionHeight: 158476n },
          signedHeader: expect.objectContaining({
            header: expect.objectContaining({ height: 158477n }),
          }),
        }),
      }),
    );
    expect(verifyClientMessage).not.toHaveBeenCalled();
    expect(checkForMisbehaviour).not.toHaveBeenCalled();
    expect((service as any).computeTxValidityWindow).toHaveBeenCalledWith(29_000, TENDERMINT_UPDATE_CHAIN_TIME_TO_LIVE);
    expect((service as any).refreshWalletContext).not.toHaveBeenCalled();
    expect(lucidService.createUnsignedTendermintSessionTransaction).toHaveBeenCalled();
    expect(buildFinal).not.toHaveBeenCalled();
  });

  it('returns tree-neutral initialization as a confirmed boundary before finalization', async () => {
    const { service, lucidService, pendingUpdates, txEvents, runnerChainSpy, buildFinal } = makeHarness();
    const completePhase = completeSessionAfterOneAdvance();
    const seed = utxo('01'.repeat(32), 2);
    lucidService.tryFindUtxosAt.mockImplementation(async (address: string) =>
      address === SESSION_ADDRESS ? [] : [seed],
    );
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo(), seed]);
    lucidService.createUnsignedTendermintSessionTransaction.mockImplementation(
      (_seed, _redeemer, encodedDatum: string, tokenUnit: string) =>
        createTxBuilder('initialize-hash', undefined, [
          derivedSessionOutput(encodedDatum, tokenUnit, 'initialize-derived'),
        ]),
    );

    const response = await (service as any).updateClientWithStagedSession(
      UPDATE_MESSAGE,
      updateOperator(),
      1_000,
      TEST_VALID_TO_TIME_MS,
      { revisionNumber: 0n, revisionHeight: 11n },
    );

    expect(response.unsigned_tx.type_url).toBe(TENDERMINT_UPDATE_TX_CHAIN_TYPE_URL);
    expect(decodeChainCbor(response.unsigned_tx.value)).toEqual([
      Buffer.from('cbor-initialize-hash', 'utf8').toString('hex'),
      Buffer.from('cbor-advance-1', 'utf8').toString('hex'),
    ]);
    expect(decodeChainEnvelope(response.unsigned_tx.value).rebuildAfterSubmission).toBe(true);
    expect(lucidService.createUnsignedTendermintSessionTransaction).toHaveBeenCalledWith(
      seed,
      expect.any(String),
      expect.any(String),
      expect.stringMatching(new RegExp(`^${POLICY_ID}[0-9a-f]{64}$`)),
      OWNER,
    );
    expect(runnerChainSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operationName: 'buildTendermintUpdateTransactionChain',
      }),
    );
    expect(pendingUpdates.take('initialize-hash')).toEqual(
      expect.objectContaining({ kind: 'tree_neutral', expectedNewRoot: '' }),
    );
    expect(pendingUpdates.take('advance-1')).toEqual(
      expect.objectContaining({ kind: 'tree_neutral', expectedNewRoot: '' }),
    );
    const encodedCompleteDatum = lucidService.createUnsignedAdvanceTendermintSessionTransaction.mock.calls[0][2];
    expect(decodeSessionDatum(encodedCompleteDatum, Lucid).phase).toEqual(completePhase);
    expect(pendingUpdates.take('default-final')).toBeUndefined();
    expect(txEvents.take('initialize-hash')).toBeUndefined();
    expect(buildFinal).not.toHaveBeenCalled();
  });

  it('emits every remaining batch through Complete without building the HostState finalization', async () => {
    const { service, lucidService, buildFinal } = makeHarness();
    const seed = utxo('02'.repeat(32), 0);
    const firstAdvance: SessionState.TendermintSessionAdvanceRedeemer = {
      VerifyTarget: { entries: [TARGET_ENTRY] },
    };
    const secondAdvance: SessionState.TendermintSessionAdvanceRedeemer = {
      VerifyTarget: { entries: [{ ...TARGET_ENTRY, trustedMembership: null }] },
    };
    const partiallyVerifiedPhase: SessionDatum['phase'] = {
      AdjacentTarget: {
        targetAccumulator: { count: 6n, peaks: [{ size: 2n, root: DIGEST }] },
        targetTotalPower: 60n,
        targetSignedPower: 50n,
        lastTarget: { votingPower: 5n, address: '34'.repeat(20) },
      },
    };
    const completePhase: SessionDatum['phase'] = {
      Complete: {
        targetRoot: PLAN.header.validatorsHash,
        targetTotalPower: 100n,
        targetSignedPower: 80n,
        trustedRoot: null,
        trustedTotalPower: 0n,
        trustedSignedPower: 0n,
      },
    };
    jest
      .spyOn(SessionState, 'nextTendermintSessionAdvance')
      .mockReturnValueOnce(firstAdvance)
      .mockReturnValueOnce(secondAdvance)
      .mockReturnValueOnce(null);
    jest
      .spyOn(SessionState, 'advanceTendermintSession')
      .mockImplementationOnce((current) => ({ ...current, phase: partiallyVerifiedPhase }))
      .mockImplementationOnce((current) => ({ ...current, phase: completePhase }));
    lucidService.tryFindUtxosAt.mockImplementation(async (address: string) =>
      address === SESSION_ADDRESS ? [] : [seed],
    );
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo(), seed]);

    const response = await (service as any).updateClientWithStagedSession(
      UPDATE_MESSAGE,
      updateOperator(),
      1_000,
      TEST_VALID_TO_TIME_MS,
      { revisionNumber: 0n, revisionHeight: 11n },
    );

    expect(decodeChainCbor(response.unsigned_tx.value)).toEqual([
      Buffer.from('cbor-initialize-1', 'utf8').toString('hex'),
      Buffer.from('cbor-advance-2', 'utf8').toString('hex'),
      Buffer.from('cbor-advance-3', 'utf8').toString('hex'),
    ]);
    expect(decodeChainEnvelope(response.unsigned_tx.value).rebuildAfterSubmission).toBe(true);
    const initializeOutput = lucidService.createUnsignedTendermintSessionTransaction.mock.results[0].value;
    const firstAdvanceInput = lucidService.createUnsignedAdvanceTendermintSessionTransaction.mock.calls[0][0];
    const secondAdvanceInput = lucidService.createUnsignedAdvanceTendermintSessionTransaction.mock.calls[1][0];
    expect(firstAdvanceInput.txHash).toBe('initialize-output-1');
    expect(secondAdvanceInput.txHash).toBe('advance-output-2');
    expect(initializeOutput.chain).toHaveBeenCalledTimes(1);
    const encodedCompleteDatum = lucidService.createUnsignedAdvanceTendermintSessionTransaction.mock.calls[1][2];
    expect(decodeSessionDatum(encodedCompleteDatum, Lucid).phase).toEqual(completePhase);
    expect(buildFinal).not.toHaveBeenCalled();
  });

  it('does not emit a rebuild boundary when verification stops before Complete', async () => {
    const { service, lucidService, pendingUpdates, buildFinal } = makeHarness();
    const seed = utxo('03'.repeat(32), 0);
    lucidService.tryFindUtxosAt.mockImplementation(async (address: string) =>
      address === SESSION_ADDRESS ? [] : [seed],
    );
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo(), seed]);

    await expect(
      (service as any).updateClientWithStagedSession(UPDATE_MESSAGE, updateOperator(), 1_000, TEST_VALID_TO_TIME_MS, {
        revisionNumber: 0n,
        revisionHeight: 11n,
      }),
    ).rejects.toThrow('verification stopped before the session reached Complete');

    expect(buildFinal).not.toHaveBeenCalled();
    expect(pendingUpdates.take('initialize-1')).toBeUndefined();
  });

  it('resumes from the accumulator count encoded on-chain and builds one advance', async () => {
    const { service, lucidService, pendingUpdates, buildFinal } = makeHarness();
    const currentDatum: SessionDatum = {
      sessionToken: { policyId: POLICY_ID, name: '44'.repeat(32) },
      owner: OWNER,
      plan: PLAN,
      phase: {
        AdjacentTarget: {
          targetAccumulator: { count: 3n, peaks: [{ size: 1n, root: DIGEST }] },
          targetTotalPower: 30n,
          targetSignedPower: 20n,
          lastTarget: { votingPower: 10n, address: '41'.repeat(20) },
        },
      },
    };
    const nextDatum: SessionDatum = {
      ...currentDatum,
      phase: {
        Complete: {
          targetRoot: PLAN.header.validatorsHash,
          targetTotalPower: 100n,
          targetSignedPower: 80n,
          trustedRoot: null,
          trustedTotalPower: 0n,
          trustedSignedPower: 0n,
        },
      },
    };
    const session = sessionUtxo(currentDatum);
    const advance: SessionState.TendermintSessionAdvanceRedeemer = {
      VerifyTarget: { entries: [TARGET_ENTRY] },
    };
    const nextAdvance = jest
      .spyOn(SessionState, 'nextTendermintSessionAdvance')
      .mockReturnValueOnce(advance)
      .mockReturnValueOnce(null);
    jest.spyOn(SessionState, 'advanceTendermintSession').mockReturnValue(nextDatum);
    lucidService.tryFindUtxosAt.mockResolvedValue([session]);
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo(), session]);
    lucidService.createUnsignedAdvanceTendermintSessionTransaction.mockImplementation(
      (_session, _redeemer, encodedDatum: string, tokenUnit: string) =>
        createTxBuilder('advance-hash', undefined, [derivedSessionOutput(encodedDatum, tokenUnit, 'advance-derived')]),
    );

    const response = await (service as any).updateClientWithStagedSession(
      UPDATE_MESSAGE,
      updateOperator(),
      1_000,
      TEST_VALID_TO_TIME_MS,
      { revisionNumber: 0n, revisionHeight: 11n },
    );

    expect(nextAdvance).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: expect.objectContaining({
          AdjacentTarget: expect.objectContaining({
            targetAccumulator: expect.objectContaining({ count: 3n }),
          }),
        }),
      }),
      PAYLOADS,
    );
    expect(lucidService.createUnsignedAdvanceTendermintSessionTransaction).toHaveBeenCalledWith(
      session,
      expect.any(String),
      expect.any(String),
      POLICY_ID + currentDatum.sessionToken.name,
      OWNER,
    );
    const encodedNextDatum = lucidService.createUnsignedAdvanceTendermintSessionTransaction.mock.calls[0][2];
    expect(decodeSessionDatum(encodedNextDatum, Lucid)).toEqual(nextDatum);
    expect(response.unsigned_tx.type_url).toBe(TENDERMINT_UPDATE_TX_CHAIN_TYPE_URL);
    expect(decodeChainCbor(response.unsigned_tx.value)).toHaveLength(1);
    expect(decodeChainEnvelope(response.unsigned_tx.value).rebuildAfterSubmission).toBe(true);
    expect(pendingUpdates.take('advance-hash')?.kind).toBe('tree_neutral');
    expect(buildFinal).not.toHaveBeenCalled();
  });

  it('rebuilds Complete as a fresh narrow-window final-only chain with the atomic update event', async () => {
    const { service, lucidService, pendingUpdates, txEvents, runnerChainSpy, computeValidityWindow } = makeHarness();
    const completeDatum: SessionDatum = {
      sessionToken: { policyId: POLICY_ID, name: '51'.repeat(32) },
      owner: OWNER,
      plan: PLAN,
      phase: {
        Complete: {
          targetRoot: PLAN.header.validatorsHash,
          targetTotalPower: 100n,
          targetSignedPower: 80n,
          trustedRoot: null,
          trustedTotalPower: 0n,
          trustedSignedPower: 0n,
        },
      },
    };
    const session = sessionUtxo(completeDatum);
    const finalBuilder = createTxBuilder('finalize-hash');
    const pending = { expectedNewRoot: '61'.repeat(32), commit: jest.fn() };
    lucidService.tryFindUtxosAt.mockResolvedValue([session]);
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo(), session]);
    const buildFinal = jest
      .spyOn(service, 'buildUnsignedUpdateClientTx')
      .mockResolvedValue({ unsignedTx: finalBuilder, pendingTreeUpdate: pending });

    const response = await (service as any).updateClientWithStagedSession(
      UPDATE_MESSAGE,
      updateOperator(),
      1_000,
      TEST_VALID_TO_TIME_MS,
      { revisionNumber: 0n, revisionHeight: 11n },
    );

    expect(buildFinal).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: '7' }),
      expect.objectContaining({
        utxo: session,
        datum: completeDatum,
        tokenUnit: POLICY_ID + completeDatum.sessionToken.name,
        signerKeyHash: OWNER,
        processedTimeNs: BigInt(TEST_FINAL_VALID_TO_TIME_MS) * 1_000_000n,
      }),
    );
    expect(response.unsigned_tx.type_url).toBe(TENDERMINT_UPDATE_TX_CHAIN_TYPE_URL);
    expect(decodeChainCbor(response.unsigned_tx.value)).toEqual([
      Buffer.from('cbor-finalize-hash', 'utf8').toString('hex'),
    ]);
    expect(decodeChainEnvelope(response.unsigned_tx.value).rebuildAfterSubmission).toBe(false);
    expect(finalBuilder.validFrom).toHaveBeenCalledWith(TEST_VALID_FROM_TIME_MS);
    expect(finalBuilder.validTo).toHaveBeenCalledWith(TEST_FINAL_VALID_TO_TIME_MS);
    expect(computeValidityWindow).toHaveBeenCalledWith(29_000, TENDERMINT_FINALIZATION_TIME_TO_LIVE);
    expect(pendingUpdates.take('finalize-hash')).toBe(pending);
    expect(runnerChainSpy).toHaveBeenCalledWith(
      expect.objectContaining({ operationName: 'buildTendermintUpdateFinalization' }),
    );
    expect(txEvents.take('finalize-hash')).toEqual([
      expect.objectContaining({
        type: EVENT_TYPE_CLIENT.UPDATE_CLIENT,
        attributes: expect.arrayContaining([
          { key: 'client_id', value: '07-tendermint-7' },
          { key: 'consensus_height', value: '0-11' },
          expect.objectContaining({ key: 'client_message_any_hex' }),
        ]),
      }),
    ]);
  });

  it('rebuilds a final-only chain for a recovered Complete session with the latest indexed client input', async () => {
    const { service, lucidService, buildFinal } = makeHarness();
    const completeDatum: SessionDatum = {
      sessionToken: { policyId: POLICY_ID, name: '52'.repeat(32) },
      owner: OWNER,
      plan: PLAN,
      phase: {
        Complete: {
          targetRoot: PLAN.header.validatorsHash,
          targetTotalPower: 100n,
          targetSignedPower: 80n,
          trustedRoot: null,
          trustedTotalPower: 0n,
          trustedSignedPower: 0n,
        },
      },
    };
    const session = sessionUtxo(completeDatum, '53'.repeat(32));
    const firstClient = clientUtxo('54'.repeat(32));
    const refreshedClient = clientUtxo('55'.repeat(32));
    const firstOperator = { ...updateOperator(), currentClientUtxo: firstClient };
    const refreshedOperator = { ...updateOperator(), currentClientUtxo: refreshedClient };
    lucidService.tryFindUtxosAt.mockResolvedValue([session]);
    lucidService.queryLedgerStateUtxosAtAddresses
      .mockResolvedValueOnce([firstClient, session])
      .mockResolvedValueOnce([refreshedClient, session]);
    buildFinal
      .mockResolvedValueOnce({
        unsignedTx: createTxBuilder('first-final'),
        pendingTreeUpdate: { expectedNewRoot: '56'.repeat(32), commit: jest.fn() },
      })
      .mockResolvedValueOnce({
        unsignedTx: createTxBuilder('refreshed-final'),
        pendingTreeUpdate: { expectedNewRoot: '57'.repeat(32), commit: jest.fn() },
      });

    const first = await (service as any).updateClientWithStagedSession(
      UPDATE_MESSAGE,
      firstOperator,
      1_000,
      TEST_VALID_TO_TIME_MS,
      { revisionNumber: 0n, revisionHeight: 11n },
    );
    const refreshed = await (service as any).updateClientWithStagedSession(
      UPDATE_MESSAGE,
      refreshedOperator,
      1_000,
      TEST_VALID_TO_TIME_MS,
      { revisionNumber: 0n, revisionHeight: 11n },
    );

    expect(decodeChainCbor(first.unsigned_tx.value)).toEqual([Buffer.from('cbor-first-final', 'utf8').toString('hex')]);
    expect(decodeChainCbor(refreshed.unsigned_tx.value)).toEqual([
      Buffer.from('cbor-refreshed-final', 'utf8').toString('hex'),
    ]);
    expect(buildFinal.mock.calls[0][0].currentClientUtxo).toBe(firstClient);
    expect(buildFinal.mock.calls[1][0].currentClientUtxo).toBe(refreshedClient);
    expect(lucidService.createUnsignedTendermintSessionTransaction).not.toHaveBeenCalled();
    expect(lucidService.createUnsignedAdvanceTendermintSessionTransaction).not.toHaveBeenCalled();
  });

  it('fails retryably when a Kupo-selected HostState input is already spent at the node', async () => {
    const { service, lucidService } = makeHarness();
    const hostState = {
      ...utxo('5c'.repeat(32)),
      address: 'addr_test1_host_state',
      datum: 'host-state-datum',
    };
    const currentClient = clientUtxo('5d'.repeat(32));
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([currentClient]);

    await expect((service as any).requireLiveTendermintFinalizationInputs(hostState, currentClient)).rejects.toThrow(
      `HostState UTxO ${hostState.txHash}#0 is no longer live`,
    );
  });

  it('returns owner-authorized cleanup when a Complete session target is now stale', async () => {
    const { service, lucidService, buildFinal, pendingUpdates, txEvents } = makeHarness();
    const staleDatum: SessionDatum = {
      sessionToken: { policyId: POLICY_ID, name: '58'.repeat(32) },
      owner: OWNER,
      plan: PLAN,
      phase: {
        Complete: {
          targetRoot: PLAN.header.validatorsHash,
          targetTotalPower: 100n,
          targetSignedPower: 80n,
          trustedRoot: null,
          trustedTotalPower: 0n,
          trustedSignedPower: 0n,
        },
      },
    };
    const session = sessionUtxo(staleDatum, '59'.repeat(32));
    const staleClientDatum = {
      ...CLIENT_DATUM,
      state: {
        ...CLIENT_DATUM.state,
        clientState: {
          ...CLIENT_DATUM.state.clientState,
          latestHeight: { revisionNumber: 0n, revisionHeight: PLAN.header.height },
        },
      },
    };
    const operator = { ...updateOperator(), clientDatum: staleClientDatum };
    lucidService.tryFindUtxosAt.mockResolvedValue([session]);
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo(), session]);
    lucidService.createUnsignedCancelTendermintSessionTransaction.mockReturnValue(createTxBuilder('stale-cancel'));

    const response = await (service as any).updateClientWithStagedSession(
      UPDATE_MESSAGE,
      operator,
      1_000,
      TEST_VALID_TO_TIME_MS,
      { revisionNumber: 0n, revisionHeight: 11n },
    );

    expect(response.unsigned_tx.type_url).toBe(TENDERMINT_UPDATE_TX_CHAIN_TYPE_URL);
    expect(decodeChainCbor(response.unsigned_tx.value)).toEqual([
      Buffer.from('cbor-stale-cancel', 'utf8').toString('hex'),
    ]);
    expect(decodeChainEnvelope(response.unsigned_tx.value).rebuildAfterSubmission).toBe(true);
    expect(buildFinal).not.toHaveBeenCalled();
    expect(pendingUpdates.take('stale-cancel')?.kind).toBe('tree_neutral');
    expect(txEvents.take('stale-cancel')).toBeUndefined();
  });

  it('cleans up a matching Complete session when its trusted state is no longer derivable', async () => {
    const { service, lucidService, buildFinal } = makeHarness();
    const completeDatum: SessionDatum = {
      sessionToken: { policyId: POLICY_ID, name: '5a'.repeat(32) },
      owner: OWNER,
      plan: PLAN,
      phase: {
        Complete: {
          targetRoot: PLAN.header.validatorsHash,
          targetTotalPower: 100n,
          targetSignedPower: 80n,
          trustedRoot: null,
          trustedTotalPower: 0n,
          trustedSignedPower: 0n,
        },
      },
    };
    const session = sessionUtxo(completeDatum, '5b'.repeat(32));
    jest.spyOn(SessionState, 'deriveTendermintSessionUpdatePlan').mockImplementation(() => {
      throw new Error('trusted consensus state is no longer retained');
    });
    lucidService.tryFindUtxosAt.mockResolvedValue([session]);
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo(), session]);
    lucidService.createUnsignedCancelTendermintSessionTransaction.mockReturnValue(
      createTxBuilder('expired-trust-cancel'),
    );

    const response = await (service as any).updateClientWithStagedSession(
      UPDATE_MESSAGE,
      updateOperator(),
      1_000,
      TEST_VALID_TO_TIME_MS,
      { revisionNumber: 0n, revisionHeight: 11n },
    );

    expect(decodeChainCbor(response.unsigned_tx.value)).toEqual([
      Buffer.from('cbor-expired-trust-cancel', 'utf8').toString('hex'),
    ]);
    expect(decodeChainEnvelope(response.unsigned_tx.value).rebuildAfterSubmission).toBe(true);
    expect(buildFinal).not.toHaveBeenCalled();
  });

  it('rejects a stale header when there is no matching live session to clean up', async () => {
    const { service, lucidService, runnerChainSpy } = makeHarness();
    const staleClientDatum = {
      ...CLIENT_DATUM,
      state: {
        ...CLIENT_DATUM.state,
        clientState: {
          ...CLIENT_DATUM.state.clientState,
          latestHeight: { revisionNumber: 0n, revisionHeight: PLAN.header.height },
        },
      },
    };
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo()]);

    await expect(
      (service as any).updateClientWithStagedSession(
        UPDATE_MESSAGE,
        { ...updateOperator(), clientDatum: staleClientDatum },
        1_000,
        TEST_VALID_TO_TIME_MS,
        { revisionNumber: 0n, revisionHeight: 11n },
      ),
    ).rejects.toThrow('must be greater than client latest height');

    expect(runnerChainSpy).not.toHaveBeenCalled();
  });
});

describe('ClientService staged Tendermint update validation and recovery', () => {
  installStagedTendermintTestSpies();

  it('caps the validity upper bound applied to staged chain links', async () => {
    const { service, lucidService, buildFinal } = makeHarness();
    completeSessionAfterOneAdvance();
    const seed = utxo('70'.repeat(32), 0);
    const trustedTimestamp = BigInt(TEST_CURRENT_LEDGER_TIME_MS) * 1_000_000n;
    const clientDatum = {
      ...CLIENT_DATUM,
      state: {
        ...CLIENT_DATUM.state,
        clientState: {
          ...CLIENT_DATUM.state.clientState,
          trustingPeriod: 10n * 60n * 1_000_000_000n,
        },
        consensusStates: new Map([
          [
            { ...PLAN.trustedHeight },
            {
              ...PLAN.trustedConsensusState,
              timestamp: trustedTimestamp,
              root: { ...PLAN.trustedConsensusState.root },
            },
          ],
        ]),
      },
    };
    const operator = {
      ...updateOperator(),
      clientDatum,
      header: {
        ...HEADER,
        signedHeader: {
          ...HEADER.signedHeader,
          header: {
            ...HEADER.signedHeader.header,
            time: trustedTimestamp + 1n,
          },
        },
      },
    };
    lucidService.tryFindUtxosAt.mockImplementation(async (address: string) =>
      address === SESSION_ADDRESS ? [] : [seed],
    );
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo(), seed]);

    const response = await (service as any).updateClientWithStagedSession(
      UPDATE_MESSAGE,
      operator,
      TEST_VALID_FROM_TIME_MS,
      TEST_VALID_TO_TIME_MS,
      { revisionNumber: 0n, revisionHeight: 11n },
      TEST_CURRENT_LEDGER_TIME_MS,
      TEST_SLOT_CONFIG,
    );

    const initializationBuilder = lucidService.createUnsignedTendermintSessionTransaction.mock.results[0].value;
    const cappedValidToTimeMs = 595_000;
    expect(initializationBuilder.validTo).toHaveBeenCalledWith(cappedValidToTimeMs);
    expect(decodeChainEnvelope(response.unsigned_tx.value).rebuildAfterSubmission).toBe(true);
    expect(buildFinal).not.toHaveBeenCalled();
  });

  it('rejects a frozen client before initializing a new staged session', async () => {
    const { service, lucidService, runnerChainSpy } = makeHarness();
    const frozenClientDatum = {
      ...CLIENT_DATUM,
      state: {
        ...CLIENT_DATUM.state,
        clientState: {
          ...CLIENT_DATUM.state.clientState,
          frozenHeight: { revisionNumber: 0n, revisionHeight: 9n },
        },
      },
    };
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo()]);

    await expect(
      (service as any).updateClientWithStagedSession(
        UPDATE_MESSAGE,
        { ...updateOperator(), clientDatum: frozenClientDatum },
        TEST_VALID_FROM_TIME_MS,
        TEST_VALID_TO_TIME_MS,
        { revisionNumber: 0n, revisionHeight: 11n },
        TEST_CURRENT_LEDGER_TIME_MS,
      ),
    ).rejects.toThrow('Tendermint client is frozen');

    expect(runnerChainSpy).not.toHaveBeenCalled();
    expect(lucidService.createUnsignedTendermintSessionTransaction).not.toHaveBeenCalled();
  });

  it('rejects a near-expiry client before initializing a new staged session', async () => {
    const { service, lucidService, runnerChainSpy } = makeHarness();
    const trustedTimestamp = BigInt(TEST_CURRENT_LEDGER_TIME_MS) * 1_000_000n;
    const nearExpiryClientDatum = {
      ...CLIENT_DATUM,
      state: {
        ...CLIENT_DATUM.state,
        clientState: {
          ...CLIENT_DATUM.state.clientState,
          trustingPeriod:
            BigInt(
              SessionState.TENDERMINT_UPDATE_EXPIRY_SAFETY_MARGIN_MS +
                SessionState.TENDERMINT_UPDATE_MIN_REMAINING_VALIDITY_MS,
            ) * 1_000_000n,
        },
        consensusStates: new Map([
          [
            { ...PLAN.trustedHeight },
            {
              ...PLAN.trustedConsensusState,
              timestamp: trustedTimestamp,
              root: { ...PLAN.trustedConsensusState.root },
            },
          ],
        ]),
      },
    };
    const operator = {
      ...updateOperator(),
      clientDatum: nearExpiryClientDatum,
      header: {
        ...HEADER,
        signedHeader: {
          ...HEADER.signedHeader,
          header: { ...HEADER.signedHeader.header, time: trustedTimestamp + 1n },
        },
      },
    };
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo()]);

    await expect(
      (service as any).updateClientWithStagedSession(
        UPDATE_MESSAGE,
        operator,
        TEST_VALID_FROM_TIME_MS,
        TEST_VALID_TO_TIME_MS,
        { revisionNumber: 0n, revisionHeight: 11n },
        TEST_CURRENT_LEDGER_TIME_MS,
      ),
    ).rejects.toThrow('before the safe trust deadline');

    expect(runnerChainSpy).not.toHaveBeenCalled();
    expect(lucidService.createUnsignedTendermintSessionTransaction).not.toHaveBeenCalled();
  });

  it('rejects a header at or before the live latest consensus timestamp before initialization', async () => {
    const { service, lucidService, runnerChainSpy } = makeHarness();
    const olderTrustedHeight = { revisionNumber: 0n, revisionHeight: 8n };
    const clientDatum = {
      ...CLIENT_DATUM,
      state: {
        ...CLIENT_DATUM.state,
        consensusStates: new Map([
          [olderTrustedHeight, { ...PLAN.trustedConsensusState, timestamp: 1_000n }],
          [
            { ...CLIENT_DATUM.state.clientState.latestHeight },
            { ...PLAN.trustedConsensusState, timestamp: PLAN.header.time },
          ],
        ]),
      },
    };
    const operator = {
      ...updateOperator(),
      clientDatum,
      header: { ...HEADER, trustedHeight: olderTrustedHeight },
    };
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo()]);

    await expect(
      (service as any).updateClientWithStagedSession(
        UPDATE_MESSAGE,
        operator,
        TEST_VALID_FROM_TIME_MS,
        TEST_VALID_TO_TIME_MS,
        { revisionNumber: 0n, revisionHeight: 11n },
        TEST_CURRENT_LEDGER_TIME_MS,
      ),
    ).rejects.toThrow('header time must be after the current latest consensus state timestamp');

    expect(runnerChainSpy).not.toHaveBeenCalled();
    expect(lucidService.createUnsignedTendermintSessionTransaction).not.toHaveBeenCalled();
  });

  it('returns owner-authorized cleanup when finalization preflight fails for a live session', async () => {
    const { service, lucidService, buildFinal } = makeHarness();
    const datum: SessionDatum = {
      sessionToken: { policyId: POLICY_ID, name: '72'.repeat(32) },
      owner: OWNER,
      plan: PLAN,
      phase: SessionState.initialTendermintSessionPhase(PLAN),
    };
    const session = sessionUtxo(datum, '73'.repeat(32));
    const frozenClientDatum = {
      ...CLIENT_DATUM,
      state: {
        ...CLIENT_DATUM.state,
        clientState: {
          ...CLIENT_DATUM.state.clientState,
          frozenHeight: { revisionNumber: 0n, revisionHeight: 9n },
        },
      },
    };
    lucidService.tryFindUtxosAt.mockResolvedValue([session]);
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo(), session]);
    lucidService.createUnsignedCancelTendermintSessionTransaction.mockReturnValue(
      createTxBuilder('preflight-failure-cancel'),
    );

    const response = await (service as any).updateClientWithStagedSession(
      UPDATE_MESSAGE,
      { ...updateOperator(), clientDatum: frozenClientDatum },
      TEST_VALID_FROM_TIME_MS,
      TEST_VALID_TO_TIME_MS,
      { revisionNumber: 0n, revisionHeight: 11n },
      TEST_CURRENT_LEDGER_TIME_MS,
    );

    expect(decodeChainCbor(response.unsigned_tx.value)).toEqual([
      Buffer.from('cbor-preflight-failure-cancel', 'utf8').toString('hex'),
    ]);
    expect(decodeChainEnvelope(response.unsigned_tx.value).rebuildAfterSubmission).toBe(true);
    expect(lucidService.createUnsignedTendermintSessionTransaction).not.toHaveBeenCalled();
    expect(buildFinal).not.toHaveBeenCalled();
  });

  it('keeps legacy deployments on the direct single-transaction behavior', async () => {
    const { service, lucidService, runnerSpy, computeValidityWindow } = makeHarness();
    const directBuilder = createTxBuilder('direct-hash');
    const pending = { expectedNewRoot: '71'.repeat(32), commit: jest.fn() };
    lucidService.hasStagedTendermintClient.mockReturnValue(false);
    verifyClientMessage.mockReturnValue(true);
    checkForMisbehaviour.mockReturnValue(false);
    jest.spyOn(HeaderCodec, 'decodeHeader').mockReturnValue({} as any);
    jest.spyOn(HeaderCodec, 'initializeHeader').mockReturnValue(HEADER);
    jest.spyOn(service as any, 'refreshWalletContext').mockResolvedValue(undefined);
    computeValidityWindow.mockResolvedValue({
      currentSlot: 1,
      currentLedgerTime: 1_000,
      validFromTime: 1_000,
      validToSlot: 2,
      validToTime: 2_000,
      slotConfig: TEST_SLOT_CONFIG,
    });
    const buildDirect = jest
      .spyOn(service, 'buildUnsignedUpdateClientTx')
      .mockResolvedValue({ unsignedTx: directBuilder, pendingTreeUpdate: pending });

    const response = await service.updateClient(UPDATE_MESSAGE);

    expect(verifyClientMessage).toHaveBeenCalled();
    expect(buildDirect).toHaveBeenCalledTimes(1);
    expect(buildDirect.mock.calls[0]).toHaveLength(1);
    expect(lucidService.createUnsignedTendermintSessionTransaction).not.toHaveBeenCalled();
    expect(response.unsigned_tx.type_url).toBe('');
    expect(runnerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ operationName: 'updateClient', pendingTreeUpdate: pending }),
    );
  });

  it('keeps legacy deployments gated by the existing JS verifier', async () => {
    const { service, lucidService } = makeHarness();
    lucidService.hasStagedTendermintClient.mockReturnValue(false);
    verifyClientMessage.mockReturnValue(false);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.updateClient(UPDATE_MESSAGE)).rejects.toThrow('Invalid client message');

    expect(verifyClientMessage).toHaveBeenCalledWith(UPDATE_MESSAGE.client_message, CLIENT_DATUM);
    expect(checkForMisbehaviour).not.toHaveBeenCalled();
    expect(lucidService.createUnsignedTendermintSessionTransaction).not.toHaveBeenCalled();
  });

  it('rejects staged Tendermint misbehaviour before building any transaction', async () => {
    const { service, lucidService } = makeHarness();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const message = {
      ...UPDATE_MESSAGE,
      client_message: {
        type_url: MisbehaviourCodec.TENDERMINT_MISBEHAVIOUR_TYPE_URL,
        value: Uint8Array.from([1, 2, 3]),
      },
    };

    await expect(service.updateClient(message)).rejects.toThrow(
      'Tendermint misbehaviour is not yet supported by the staged client protocol',
    );

    expect(verifyClientMessage).not.toHaveBeenCalled();
    expect(checkForMisbehaviour).not.toHaveBeenCalled();
    expect(lucidService.createUnsignedTendermintSessionTransaction).not.toHaveBeenCalled();
    expect(lucidService.createUnsignedFinalizeTendermintSessionTransaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown staged client message type before decoding or verification', async () => {
    const { service, lucidService } = makeHarness();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const decodeHeader = jest.spyOn(HeaderCodec, 'decodeHeader');
    const message = {
      ...UPDATE_MESSAGE,
      client_message: {
        type_url: '/ibc.lightclients.unknown.v1.ClientMessage',
        value: Uint8Array.from([1, 2, 3]),
      },
    };

    await expect(service.updateClient(message)).rejects.toThrow(
      'Unsupported staged Tendermint client message type: /ibc.lightclients.unknown.v1.ClientMessage',
    );

    expect(decodeHeader).not.toHaveBeenCalled();
    expect(verifyClientMessage).not.toHaveBeenCalled();
    expect(checkForMisbehaviour).not.toHaveBeenCalled();
    expect(lucidService.createUnsignedTendermintSessionTransaction).not.toHaveBeenCalled();
  });

  it('rejects malformed bytes carrying the staged Header type', async () => {
    const { service, lucidService } = makeHarness();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const message = {
      ...UPDATE_MESSAGE,
      client_message: {
        type_url: TENDERMINT_HEADER_TYPE_URL,
        value: Uint8Array.from([0xff]),
      },
    };

    await expect(service.updateClient(message)).rejects.toThrow('Error decoding header');

    expect(verifyClientMessage).not.toHaveBeenCalled();
    expect(checkForMisbehaviour).not.toHaveBeenCalled();
    expect(lucidService.createUnsignedTendermintSessionTransaction).not.toHaveBeenCalled();
  });
});

describe('ClientService staged Tendermint session recovery and seed reservations', () => {
  installStagedTendermintTestSpies();

  it('matches node-confirmed wallet UTxOs when Hermes supplies hex enterprise-address bytes', async () => {
    const { service, lucidService } = makeHarness();
    completeSessionAfterOneAdvance();
    const hexSigner = `60${'8f'.repeat(28)}`;
    const canonicalWalletAddress = 'addr_test1vcanonical';
    const seed = { ...utxo('90'.repeat(32), 0), address: canonicalWalletAddress };
    lucidService.credentialToAddress.mockImplementation((address: string) =>
      address === hexSigner ? canonicalWalletAddress : address,
    );
    lucidService.tryFindUtxosAt.mockImplementation(async (address: string) =>
      address === SESSION_ADDRESS ? [] : [seed],
    );
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo(), seed]);

    await expect(
      (service as any).updateClientWithStagedSession(
        UPDATE_MESSAGE,
        { ...updateOperator(), constructedAddress: hexSigner },
        1_000,
        TEST_VALID_TO_TIME_MS,
        { revisionNumber: 0n, revisionHeight: 11n },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        unsigned_tx: expect.objectContaining({ type_url: TENDERMINT_UPDATE_TX_CHAIN_TYPE_URL }),
      }),
    );

    expect(lucidService.queryLedgerStateUtxosAtAddresses).toHaveBeenCalledWith([
      SESSION_ADDRESS,
      canonicalWalletAddress,
      CLIENT_ADDRESS,
    ]);
    expect(lucidService.createUnsignedTendermintSessionTransaction).toHaveBeenCalledWith(
      seed,
      expect.any(String),
      expect.any(String),
      expect.any(String),
      OWNER,
    );
  });

  it('ignores malformed and unowned outputs while returning every authenticated match', async () => {
    const { service, lucidService } = makeHarness();
    const datum: SessionDatum = {
      sessionToken: { policyId: POLICY_ID, name: '81'.repeat(32) },
      owner: OWNER,
      plan: PLAN,
      phase: SessionState.initialTendermintSessionPhase(PLAN),
    };
    const valid = sessionUtxo(datum, 'valid-session');
    const wrongQuantity = {
      ...sessionUtxo(datum, 'wrong-quantity'),
      assets: { [POLICY_ID + datum.sessionToken.name]: 2n },
    };
    const malformed = { ...utxo('malformed'), address: SESSION_ADDRESS, datum: 'not-cbor' };
    const otherOwner = sessionUtxo({ ...datum, owner: '82'.repeat(28) }, 'other-owner');
    lucidService.tryFindUtxosAt.mockResolvedValue([malformed, wrongQuantity, otherOwner, valid]);

    await expect((service as any).findStagedTendermintSessions(PLAN, OWNER)).resolves.toEqual([
      {
        utxo: valid,
        datum,
        tokenUnit: POLICY_ID + datum.sessionToken.name,
      },
    ]);

    lucidService.tryFindUtxosAt.mockResolvedValue([
      valid,
      sessionUtxo({ ...datum, sessionToken: { ...datum.sessionToken, name: '83'.repeat(32) } }, 'duplicate'),
    ]);
    await expect((service as any).findStagedTendermintSessions(PLAN, OWNER)).resolves.toHaveLength(2);
  });

  it('reuses the reserved seed while a just-created session is invisible to the indexer', async () => {
    const { service, lucidService } = makeHarness();
    completeSessionAfterOneAdvance();
    const firstSeed = utxo('91'.repeat(32), 0);
    const laterWalletSeed = utxo('92'.repeat(32), 0);
    const retryWait = jest.spyOn(service as any, 'waitForTendermintSessionMatchRetry').mockResolvedValue(undefined);
    let walletQueries = 0;
    lucidService.tryFindUtxosAt.mockImplementation(async (address: string) => {
      if (address === SESSION_ADDRESS) return [];
      walletQueries += 1;
      return walletQueries === 1 ? [firstSeed] : [laterWalletSeed];
    });
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo(), firstSeed]);
    await (service as any).updateClientWithStagedSession(
      UPDATE_MESSAGE,
      updateOperator(),
      1_000,
      TEST_VALID_TO_TIME_MS,
      {
        revisionNumber: 0n,
        revisionHeight: 11n,
      },
    );
    await (service as any).updateClientWithStagedSession(
      UPDATE_MESSAGE,
      updateOperator(),
      1_000,
      TEST_VALID_TO_TIME_MS,
      {
        revisionNumber: 0n,
        revisionHeight: 11n,
      },
    );

    expect(walletQueries).toBe(1);
    expect(retryWait).not.toHaveBeenCalled();
    expect(lucidService.createUnsignedTendermintSessionTransaction).toHaveBeenCalledTimes(2);
    expect(lucidService.createUnsignedTendermintSessionTransaction.mock.calls[0][0]).toBe(firstSeed);
    expect(lucidService.createUnsignedTendermintSessionTransaction.mock.calls[1][0]).toBe(firstSeed);
    expect(lucidService.createUnsignedTendermintSessionTransaction.mock.calls[1][3]).toBe(
      lucidService.createUnsignedTendermintSessionTransaction.mock.calls[0][3],
    );
  });

  it('polls past unrelated outputs and never reinitializes during post-advance Kupo lag', async () => {
    const { service, lucidService } = makeHarness();
    const currentDatum: SessionDatum = {
      sessionToken: { policyId: POLICY_ID, name: 'a2'.repeat(32) },
      owner: OWNER,
      plan: PLAN,
      phase: {
        AdjacentTarget: {
          targetAccumulator: { count: 3n, peaks: [{ size: 1n, root: DIGEST }] },
          targetTotalPower: 30n,
          targetSignedPower: 20n,
          lastTarget: { votingPower: 10n, address: 'a3'.repeat(20) },
        },
      },
    };
    const liveSession = sessionUtxo(currentDatum, 'advanced-session');
    const unrelatedSession = sessionUtxo({ ...currentDatum, owner: 'a6'.repeat(28) }, 'unrelated-session');
    const retryWait = jest.spyOn(service as any, 'waitForTendermintSessionMatchRetry').mockResolvedValue(undefined);
    let sessionQueries = 0;
    lucidService.tryFindUtxosAt.mockImplementation(async (address: string) => {
      if (address === SESSION_ADDRESS) {
        sessionQueries += 1;
        return [unrelatedSession];
      }
      return [];
    });
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo(), liveSession]);

    await expect(
      (service as any).updateClientWithStagedSession(UPDATE_MESSAGE, updateOperator(), 1_000, TEST_VALID_TO_TIME_MS, {
        revisionNumber: 0n,
        revisionHeight: 11n,
      }),
    ).rejects.toThrow('temporarily unavailable from the indexer');

    expect(sessionQueries).toBe(10);
    expect(retryWait).toHaveBeenCalledTimes(8);
    expect(lucidService.createUnsignedTendermintSessionTransaction).not.toHaveBeenCalled();
    expect(lucidService.createUnsignedAdvanceTendermintSessionTransaction).not.toHaveBeenCalled();
  });

  it('cancels a duplicate in normal orchestration and retains the deterministic progress winner', async () => {
    const { service, lucidService, runnerChainSpy, buildFinal } = makeHarness();
    completeSessionAfterOneAdvance();
    const phase = {
      AdjacentTarget: {
        targetAccumulator: { count: 3n, peaks: [{ size: 1n, root: DIGEST }] },
        targetTotalPower: 30n,
        targetSignedPower: 20n,
        lastTarget: { votingPower: 10n, address: 'b0'.repeat(20) },
      },
    } as SessionDatum['phase'];
    const retainedDatum: SessionDatum = {
      sessionToken: { policyId: POLICY_ID, name: '01'.repeat(32) },
      owner: OWNER,
      plan: PLAN,
      phase,
    };
    const duplicateDatum: SessionDatum = {
      ...retainedDatum,
      sessionToken: { policyId: POLICY_ID, name: '02'.repeat(32) },
    };
    const retained = sessionUtxo(retainedDatum, 'b1'.repeat(32));
    const duplicate = sessionUtxo(duplicateDatum, 'b2'.repeat(32));
    lucidService.tryFindUtxosAt.mockResolvedValue([duplicate, retained]);
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo(), duplicate, retained]);
    lucidService.createUnsignedCancelTendermintSessionTransaction.mockReturnValue(createTxBuilder('cancel-duplicate'));
    const nextAdvance = jest.spyOn(SessionState, 'nextTendermintSessionAdvance');

    const response = await (service as any).updateClientWithStagedSession(
      UPDATE_MESSAGE,
      updateOperator(),
      1_000,
      TEST_VALID_TO_TIME_MS,
      { revisionNumber: 0n, revisionHeight: 11n },
    );

    expect(response.unsigned_tx.type_url).toBe(TENDERMINT_UPDATE_TX_CHAIN_TYPE_URL);
    expect(decodeChainCbor(response.unsigned_tx.value)).toEqual([
      Buffer.from('cbor-cancel-duplicate', 'utf8').toString('hex'),
      Buffer.from('cbor-advance-1', 'utf8').toString('hex'),
    ]);
    expect(decodeChainEnvelope(response.unsigned_tx.value).rebuildAfterSubmission).toBe(true);
    expect(lucidService.createUnsignedCancelTendermintSessionTransaction).toHaveBeenCalledWith(
      duplicate,
      expect.any(String),
      expect.any(String),
      POLICY_ID + duplicateDatum.sessionToken.name,
      OWNER,
    );
    expect(runnerChainSpy).toHaveBeenCalledWith(
      expect.objectContaining({ operationName: 'buildTendermintUpdateTransactionChain' }),
    );
    expect(nextAdvance).toHaveBeenCalledWith(retainedDatum, PAYLOADS);
    expect(buildFinal).not.toHaveBeenCalled();
  });

  it('fails before emitting a chain longer than the transport cap', async () => {
    const { service, lucidService, pendingUpdates, buildFinal } = makeHarness();
    const datum: SessionDatum = {
      sessionToken: { policyId: POLICY_ID, name: '09'.repeat(32) },
      owner: OWNER,
      plan: PLAN,
      phase: SessionState.initialTendermintSessionPhase(PLAN),
    };
    const session = sessionUtxo(datum, '0a'.repeat(32));
    const advance: SessionState.TendermintSessionAdvanceRedeemer = {
      VerifyTarget: { entries: [TARGET_ENTRY] },
    };
    jest.spyOn(SessionState, 'nextTendermintSessionAdvance').mockReturnValue(advance);
    jest.spyOn(SessionState, 'advanceTendermintSession').mockImplementation((current) => current);
    lucidService.tryFindUtxosAt.mockResolvedValue([session]);
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo(), session]);

    await expect(
      (service as any).updateClientWithStagedSession(UPDATE_MESSAGE, updateOperator(), 1_000, TEST_VALID_TO_TIME_MS, {
        revisionNumber: 0n,
        revisionHeight: 11n,
      }),
    ).rejects.toThrow(`more than ${MAX_TENDERMINT_UPDATE_TX_CHAIN_LENGTH} transactions`);

    expect(lucidService.createUnsignedAdvanceTendermintSessionTransaction).toHaveBeenCalledTimes(
      MAX_TENDERMINT_UPDATE_TX_CHAIN_LENGTH - 1,
    );
    expect(buildFinal).not.toHaveBeenCalled();
    expect(pendingUpdates.take('advance-1')).toBeUndefined();
  });

  it('recovers after a Gateway restart from node state without minting a duplicate session', async () => {
    const { service, lucidService } = makeHarness();
    const datum: SessionDatum = {
      sessionToken: { policyId: POLICY_ID, name: 'b1'.repeat(32) },
      owner: OWNER,
      plan: PLAN,
      phase: SessionState.initialTendermintSessionPhase(PLAN),
    };
    const nodeSession = sessionUtxo(datum, 'b2'.repeat(32));
    const unrelated = sessionUtxo({ ...datum, owner: 'b3'.repeat(28) }, 'b4'.repeat(32));
    lucidService.tryFindUtxosAt.mockResolvedValue([unrelated]);
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([clientUtxo(), unrelated, nodeSession]);
    const retryWait = jest.spyOn(service as any, 'waitForTendermintSessionMatchRetry').mockResolvedValue(undefined);

    await expect(
      (service as any).updateClientWithStagedSession(UPDATE_MESSAGE, updateOperator(), 1_000, TEST_VALID_TO_TIME_MS, {
        revisionNumber: 0n,
        revisionHeight: 11n,
      }),
    ).rejects.toThrow('confirmed by the Cardano node but temporarily unavailable from the indexer');

    expect(lucidService.queryLedgerStateUtxosAtAddresses).toHaveBeenCalledWith([
      SESSION_ADDRESS,
      UPDATE_MESSAGE.signer,
      CLIENT_ADDRESS,
    ]);
    expect(retryWait).toHaveBeenCalledTimes(8);
    expect(lucidService.createUnsignedTendermintSessionTransaction).not.toHaveBeenCalled();
  });

  it('does not restart initialization when the indexed client input is already spent at the node', async () => {
    const { service, lucidService, runnerChainSpy } = makeHarness();
    const replacementWalletOutput = utxo('bd'.repeat(32), 0);
    lucidService.queryLedgerStateUtxosAtAddresses.mockResolvedValue([replacementWalletOutput]);

    await expect(
      (service as any).updateClientWithStagedSession(UPDATE_MESSAGE, updateOperator(), 1_000, TEST_VALID_TO_TIME_MS, {
        revisionNumber: 0n,
        revisionHeight: 11n,
      }),
    ).rejects.toThrow('indexed client UTxO client-input#0 is no longer live');

    expect(lucidService.createUnsignedTendermintSessionTransaction).not.toHaveBeenCalled();
    expect(runnerChainSpy).not.toHaveBeenCalled();
  });

  it('does not let concurrent plans reserve the same one-shot seed', async () => {
    const { service, lucidService } = makeHarness();
    const seed = utxo('c1'.repeat(32), 0);
    lucidService.tryFindUtxosAt.mockResolvedValue([seed]);

    await expect(
      (service as any).reserveTendermintSessionSeed(
        'plan-a',
        '01'.repeat(32),
        UPDATE_MESSAGE.signer,
        [seed],
        3_000,
        1_000,
      ),
    ).resolves.toBe(seed);
    await expect(
      Promise.resolve().then(() =>
        (service as any).reserveTendermintSessionSeed(
          'plan-b',
          '02'.repeat(32),
          UPDATE_MESSAGE.signer,
          [seed],
          3_000,
          1_000,
        ),
      ),
    ).rejects.toThrow(`seed ${seed.txHash}#0 is reserved by another update`);

    expect(lucidService.tryFindUtxosAt).toHaveBeenCalledTimes(1);
  });

  it('extends a reused seed reservation and releases it at its latest phase-one validity deadline', async () => {
    const { service, lucidService } = makeHarness();
    const seed = utxo('c2'.repeat(32), 0);
    lucidService.tryFindUtxosAt.mockResolvedValue([seed]);

    await expect(
      (service as any).reserveTendermintSessionSeed(
        'plan-a',
        '01'.repeat(32),
        UPDATE_MESSAGE.signer,
        [seed],
        2_000,
        1_000,
      ),
    ).resolves.toBe(seed);
    await expect(
      (service as any).reserveTendermintSessionSeed(
        'plan-a',
        '01'.repeat(32),
        UPDATE_MESSAGE.signer,
        [seed],
        3_000,
        1_500,
      ),
    ).resolves.toBe(seed);
    await expect(
      Promise.resolve().then(() =>
        (service as any).reserveTendermintSessionSeed(
          'plan-b',
          '02'.repeat(32),
          UPDATE_MESSAGE.signer,
          [seed],
          4_000,
          2_500,
        ),
      ),
    ).rejects.toThrow(`seed ${seed.txHash}#0 is reserved by another update`);
    await expect(
      (service as any).reserveTendermintSessionSeed(
        'plan-b',
        '02'.repeat(32),
        UPDATE_MESSAGE.signer,
        [seed],
        4_000,
        3_000,
      ),
    ).resolves.toBe(seed);

    expect(lucidService.tryFindUtxosAt).toHaveBeenCalledTimes(2);
    expect((service as any).stagedTendermintInitializationSeeds.get('plan-b').expiresAtMs).toBe(4_000);
    expect((service as any).stagedTendermintSeedReservations.get(`${seed.txHash}#0`)).toBe('plan-b');
  });

  it('releases a spent seed after a build failure and retries with the node-confirmed replacement', async () => {
    const { service, lucidService } = makeHarness();
    completeSessionAfterOneAdvance();
    const spentSeed = utxo('d1'.repeat(32), 0);
    const replacementSeed = utxo('d2'.repeat(32), 1);
    let walletQueries = 0;
    lucidService.tryFindUtxosAt.mockImplementation(async (address: string) => {
      if (address === SESSION_ADDRESS) return [];
      walletQueries += 1;
      return walletQueries === 1 ? [spentSeed] : [replacementSeed];
    });
    lucidService.queryLedgerStateUtxosAtAddresses
      .mockResolvedValueOnce([clientUtxo(), spentSeed])
      .mockResolvedValueOnce([clientUtxo(), replacementSeed]);
    lucidService.createUnsignedTendermintSessionTransaction
      .mockImplementationOnce(() => {
        throw new Error('transient build failure');
      })
      .mockImplementationOnce((_seed, _redeemer, encodedDatum: string, tokenUnit: string) =>
        createTxBuilder('replacement-initialize', undefined, [
          derivedSessionOutput(encodedDatum, tokenUnit, 'replacement-derived'),
        ]),
      );

    await expect(
      (service as any).updateClientWithStagedSession(UPDATE_MESSAGE, updateOperator(), 1_000, TEST_VALID_TO_TIME_MS, {
        revisionNumber: 0n,
        revisionHeight: 11n,
      }),
    ).rejects.toThrow('transient build failure');

    await expect(
      (service as any).updateClientWithStagedSession(UPDATE_MESSAGE, updateOperator(), 1_000, TEST_VALID_TO_TIME_MS, {
        revisionNumber: 0n,
        revisionHeight: 11n,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        unsigned_tx: expect.objectContaining({ type_url: TENDERMINT_UPDATE_TX_CHAIN_TYPE_URL }),
      }),
    );

    expect(lucidService.createUnsignedTendermintSessionTransaction.mock.calls[0][0]).toBe(spentSeed);
    expect(lucidService.createUnsignedTendermintSessionTransaction.mock.calls[1][0]).toBe(replacementSeed);
  });

  it('does not retain a reservation when the indexed seed lookup fails transiently', async () => {
    const { service, lucidService } = makeHarness();
    const seed = utxo('e1'.repeat(32), 0);
    lucidService.tryFindUtxosAt.mockResolvedValueOnce([]).mockResolvedValueOnce([seed]);

    await expect(
      (service as any).reserveTendermintSessionSeed(
        'retry-plan',
        '03'.repeat(32),
        UPDATE_MESSAGE.signer,
        [seed],
        3_000,
        1_000,
      ),
    ).rejects.toThrow('temporarily unavailable from the indexer');
    await expect(
      (service as any).reserveTendermintSessionSeed(
        'retry-plan',
        '03'.repeat(32),
        UPDATE_MESSAGE.signer,
        [seed],
        3_000,
        1_000,
      ),
    ).resolves.toBe(seed);

    expect(lucidService.tryFindUtxosAt).toHaveBeenCalledTimes(2);
  });

  it('builds an owner-authorized Cancel plus exact session NFT burn', () => {
    const { service, lucidService } = makeHarness();
    const datum: SessionDatum = {
      sessionToken: { policyId: POLICY_ID, name: 'f1'.repeat(32) },
      owner: OWNER,
      plan: PLAN,
      phase: SessionState.initialTendermintSessionPhase(PLAN),
    };
    const session = sessionUtxo(datum, 'f2'.repeat(32));
    const builder = createTxBuilder('cancel-session');
    lucidService.createUnsignedCancelTendermintSessionTransaction.mockReturnValue(builder);

    expect(service.buildUnsignedCancelTendermintSession(session)).toBe(builder);
    expect(lucidService.createUnsignedCancelTendermintSessionTransaction).toHaveBeenCalledWith(
      session,
      expect.any(String),
      expect.any(String),
      POLICY_ID + datum.sessionToken.name,
      OWNER,
    );

    const [, spendRedeemer, burnRedeemer] = lucidService.createUnsignedCancelTendermintSessionTransaction.mock.calls[0];
    expect(Lucid.Data.from(spendRedeemer)).toEqual(new Lucid.Constr(3, []));
    expect(Lucid.Data.from(burnRedeemer)).toEqual(new Lucid.Constr(1, [datum.sessionToken.name]));
  });

  it('rejects cancellation of a malformed or unauthenticated session output', () => {
    const { service } = makeHarness();
    const datum: SessionDatum = {
      sessionToken: { policyId: POLICY_ID, name: 'f3'.repeat(32) },
      owner: OWNER,
      plan: PLAN,
      phase: SessionState.initialTendermintSessionPhase(PLAN),
    };

    expect(() => service.buildUnsignedCancelTendermintSession({ ...sessionUtxo(datum), datum: '00' })).toThrow(
      'malformed datum',
    );
    expect(() =>
      service.buildUnsignedCancelTendermintSession({
        ...sessionUtxo(datum),
        assets: { lovelace: 3_000_000n },
      }),
    ).toThrow('not authenticated by its declared NFT');
  });
});
