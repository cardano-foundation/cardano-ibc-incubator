import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Lucid from '@lucid-evolution/lucid';
import { ConsensusState as ConsensusStateTendermint } from '@cardano-ibc/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import { QueryService } from '../services/query.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { MiniProtocalsService } from '../../shared/modules/mini-protocals/mini-protocals.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { DenomTraceService } from '../services/denom-trace.service';
import { HistoryService } from '../services/history.service';
import { decodeClientDatum } from '../../shared/types/client-datum';
import { normalizeConsensusStateFromDatum } from '../../shared/helpers/consensus-state';
import { type ConsensusStateDatum } from '../../shared/types/consensus-state-datum';
import { encodeConsensusStateValue, IbcTreeStateStore } from '../../shared/helpers/ibc-state-root';

jest.mock('../../shared/types/client-datum', () => ({ decodeClientDatum: jest.fn() }));
jest.mock('../../shared/helpers/consensus-state', () => ({
  normalizeConsensusStateFromDatum: jest.fn(),
}));
jest.mock('../../shared/helpers/ics23-proof-serialization', () => ({
  serializeExistenceProof: jest.fn(() => Buffer.from('proof')),
}));

const PROOF_HEIGHT = 123n;
const POLICY_ID = '11'.repeat(28);
const CLIENT_TOKEN = { policyId: POLICY_ID, name: '22'.repeat(24) + '30' };
const CLIENT_UNIT = CLIENT_TOKEN.policyId + CLIENT_TOKEN.name;
const LATEST_HEIGHT = { revisionNumber: 0n, revisionHeight: 9n };
const ARCHIVED_HEIGHT = { revisionNumber: 0n, revisionHeight: 7n };

function consensusState(marker: string) {
  return {
    timestamp: 1_000n,
    next_validators_hash: marker.repeat(32),
    root: { hash: marker.repeat(32) },
  };
}

function clientDatum() {
  const latest = consensusState('33');
  return {
    token: CLIENT_TOKEN,
    history_root: 'ab'.repeat(32),
    state: {
      clientState: { latestHeight: LATEST_HEIGHT },
      consensusStates: new Map([[LATEST_HEIGHT, latest]]),
      processedTimes: new Map([[LATEST_HEIGHT, 3_000n]]),
      processedHeights: new Map([[LATEST_HEIGHT, 30n]]),
    },
  };
}

function archiveDatum(
  height = ARCHIVED_HEIGHT,
  clientToken = CLIENT_TOKEN,
): ConsensusStateDatum {
  return {
    clientToken,
    height,
    consensusState: consensusState('44'),
    processedTime: 2_000n,
    processedHeight: 20n,
  };
}

async function makeFixture(archives: ConsensusStateDatum[]) {
  const committedValues = new Map<string, Buffer>();
  const latest: ConsensusStateDatum = {
    clientToken: CLIENT_TOKEN, height: LATEST_HEIGHT,
    consensusState: consensusState('33'), processedTime: 3000n, processedHeight: 30n,
  };
  committedValues.set(
    `clients/07-tendermint-0/consensusStates/${LATEST_HEIGHT.revisionHeight}`,
    Buffer.from(await encodeConsensusStateValue(latest.consensusState, Lucid), 'hex'),
  );
  for (const archive of archives) {
    if (archive.clientToken.name === CLIENT_TOKEN.name) {
      committedValues.set(
        `clients/07-tendermint-0/consensusStates/${archive.height.revisionHeight}`,
        Buffer.from(await encodeConsensusStateValue(archive.consensusState, Lucid), 'hex'),
      );
    }
  }
  const tree = {
    get: jest.fn((path: string) => committedValues.get(path)),
    generateProof: jest.fn((path: string) => ({ path })),
  };
  const historyRecords = await Promise.all([...archives, latest].map(async (datum) => ({
    datum, consensusValue: await encodeConsensusStateValue(datum.consensusState, Lucid), archived: datum !== latest,
  })));
  const liveClient = { txHash: 'cc'.repeat(32), outputIndex: 0, address: 'client', datum: 'live-client', assets: { [CLIENT_UNIT]: 1n } };
  const historyService = {
    findUtxoByUnitAtOrBeforeBlockNo: jest.fn(async () => ({ datum: 'client-datum' })),
    findHostStateUtxoAtOrBeforeBlockNo: jest.fn(async () => ({
      txHash: 'aa'.repeat(32),
      outputIndex: 0,
      datum: 'host-datum',
    })),
  };
  const lucidService = {
    LucidImporter: Lucid,
    getClientAuthTokenUnit: jest.fn(() => CLIENT_UNIT),
    findUtxoByUnit: jest.fn(async () => liveClient),
    consensusHistoryRecords: jest.fn(async () => historyRecords),
    decodeDatum: jest.fn(async (_datum: string, type: string) => {
      if (type === 'host_state') return { state: { ibc_state_root: 'ab'.repeat(32) } };
      throw new Error(`unexpected ${type} datum`);
    }),
  };
  const configService = {
    get: jest.fn(),
  };
  const service = new QueryService(
    { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as Logger,
    configService as unknown as ConfigService,
    lucidService as unknown as LucidService,
    {} as KupoService,
    historyService as unknown as HistoryService,
    {} as MiniProtocalsService,
    {} as MithrilService,
    {} as DenomTraceService,
    {} as never,
    {} as IbcTreeStateStore,
  );
  jest.spyOn(service as never, 'getProofContext' as never).mockResolvedValue({
    proofHeight: PROOF_HEIGHT,
    root: 'ab'.repeat(32),
    hostState: { txHash: 'aa'.repeat(32), outputIndex: 0 },
    tree,
  } as never);
  return { service, tree, historyService, historyRecords, committedValues, lucidService, liveClient };
}

describe('QueryService consensus-state history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (decodeClientDatum as jest.Mock).mockResolvedValue(clientDatum());
    (normalizeConsensusStateFromDatum as jest.Mock).mockReturnValue(
      ConsensusStateTendermint.fromPartial({
        timestamp: { seconds: 1n, nanos: 0 },
        root: { hash: new Uint8Array([1]) },
        next_validators_hash: new Uint8Array([2]),
      }),
    );
  });

  it('returns and proves an archived consensus state at the selected Cardano height', async () => {
    const archive = archiveDatum();
    const { service, tree, historyService, lucidService, liveClient } = await makeFixture([archive]);

    const response = await service.queryConsensusState({
      client_id: '07-tendermint-0',
      revision_number: 0n,
      revision_height: ARCHIVED_HEIGHT.revisionHeight,
      latest_height: false,
    });

    expect(historyService.findUtxoByUnitAtOrBeforeBlockNo).toHaveBeenCalledWith(CLIENT_UNIT, PROOF_HEIGHT);
    expect(lucidService.findUtxoByUnit).toHaveBeenCalledWith(CLIENT_UNIT);
    expect(lucidService.consensusHistoryRecords).toHaveBeenCalledWith(liveClient);
    expect(tree.generateProof).toHaveBeenCalledWith('clients/07-tendermint-0/consensusStates/7');
    expect(response.proof_height.revision_height).toBe(PROOF_HEIGHT);
  });

  it('lists the latest state and authenticated historical heights at the proof anchor', async () => {
    const { service } = await makeFixture([archiveDatum()]);

    const states = await service.queryConsensusStates({ client_id: '07-tendermint-0' });
    const heights = await service.queryConsensusStateHeights({ client_id: '07-tendermint-0' });

    expect(states.consensus_states.map((entry) => entry.height?.revision_height)).toEqual([7n, 9n]);
    expect(heights.consensus_state_heights.map((height) => height.revision_height)).toEqual([7n, 9n]);
  });

  it('does not expose an archive whose commitment leaf was already pruned', async () => {
    const fixture = await makeFixture([archiveDatum()]);
    fixture.committedValues.delete('clients/07-tendermint-0/consensusStates/7');

    const heights = await fixture.service.queryConsensusStateHeights({ client_id: '07-tendermint-0' });

    expect(heights.consensus_state_heights.map((height) => height.revision_height)).toEqual([9n]);
  });

  it('rejects an archive that does not match the selected snapshot commitment', async () => {
    const fixture = await makeFixture([archiveDatum()]);
    fixture.committedValues.set(
      'clients/07-tendermint-0/consensusStates/7',
      Buffer.from('ff', 'hex'),
    );

    await expect(fixture.service.queryConsensusStateHeights({ client_id: '07-tendermint-0' }))
      .rejects.toThrow(/does not match the committed IBC state root/);
  });

  it('fails closed for duplicate records in the per-client index', async () => {
    const archive = archiveDatum();
    const { service } = await makeFixture([archive, archive]);

    await expect(service.queryConsensusStateHeights({ client_id: '07-tendermint-0' }))
      .rejects.toThrow(/Duplicate consensus-state history record/);
  });

  it('rejects a record for another client from a per-client index', async () => {
    const foreign = archiveDatum(
      { revisionNumber: 0n, revisionHeight: 6n },
      { policyId: POLICY_ID, name: '55'.repeat(24) + '31' },
    );
    const { service } = await makeFixture([foreign, archiveDatum()]);

    await expect(service.queryConsensusStateHeights({ client_id: '07-tendermint-0' }))
      .rejects.toThrow(/failed authentication/);
  });

  it('never mixes records newer than the historical client tip into the proof snapshot', async () => {
    const later = archiveDatum({ revisionNumber: 0n, revisionHeight: 12n });
    const { service, tree } = await makeFixture([archiveDatum(), later]);
    const heights = await service.queryConsensusStateHeights({ client_id: '07-tendermint-0' });
    expect(heights.consensus_state_heights.map((height) => height.revision_height)).toEqual([7n, 9n]);
    expect(tree.get).not.toHaveBeenCalledWith('clients/07-tendermint-0/consensusStates/12');
  });

  it('requires the latest returned state to match the pinned public leaf too', async () => {
    const fixture = await makeFixture([archiveDatum()]);
    fixture.committedValues.set('clients/07-tendermint-0/consensusStates/9', Buffer.from('ff', 'hex'));
    await expect(fixture.service.queryConsensusState({ client_id: '07-tendermint-0', revision_number: 0n, revision_height: 0n, latest_height: true }))
      .rejects.toThrow(/does not match the committed IBC state root/);
  });

  it('rechecks the historical HostState after loading records for a height list', async () => {
    const fixture = await makeFixture([archiveDatum()]);
    fixture.historyService.findHostStateUtxoAtOrBeforeBlockNo.mockResolvedValueOnce({ txHash: 'dd'.repeat(32), outputIndex: 0, datum: 'host-datum' });
    await expect(fixture.service.queryConsensusStateHeights({ client_id: '07-tendermint-0' })).rejects.toThrow();
  });
});
