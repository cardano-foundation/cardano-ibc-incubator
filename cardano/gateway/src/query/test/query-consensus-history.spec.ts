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
import {
  consensusStateTokenName,
  encodeConsensusStateDatum,
  type ConsensusStateDatum,
} from '../../shared/types/consensus-state-datum';
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
const HISTORY_ADDRESS = 'addr_test1_consensus_history';
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
  const historyRows = archives.map((archive, index) => ({
    txHash: `${index + 1}`.padStart(64, '0'),
    txId: index + 1,
    outputIndex: 0,
    address: HISTORY_ADDRESS,
    assetsPolicy: archive.clientToken.policyId,
    assetsName: consensusStateTokenName(archive.clientToken, archive.height, Lucid),
    datum: encodeConsensusStateDatum(archive, Lucid),
    blockNo: 100,
    blockId: 100,
    index: 0,
  }));
  const historyService = {
    findUtxoByUnitAtOrBeforeBlockNo: jest.fn(async () => ({ datum: 'client-datum' })),
    findUtxosByAddressAndPolicyIdAtOrBeforeBlockNo: jest.fn(async () => historyRows),
    findHostStateUtxoAtOrBeforeBlockNo: jest.fn(async () => ({
      txHash: 'aa'.repeat(32),
      outputIndex: 0,
      datum: 'host-datum',
    })),
  };
  const lucidService = {
    LucidImporter: Lucid,
    getClientAuthTokenUnit: jest.fn(() => CLIENT_UNIT),
    getConsensusStateAddress: jest.fn(() => HISTORY_ADDRESS),
    decodeDatum: jest.fn(async (_datum: string, type: string) => {
      if (type === 'host_state') return { state: { ibc_state_root: 'ab'.repeat(32) } };
      throw new Error(`unexpected ${type} datum`);
    }),
  };
  const configService = {
    get: jest.fn((key: string) => key === 'deployment'
      ? {
          validators: {
            spendConsensusState: { address: HISTORY_ADDRESS },
          },
        }
      : undefined),
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
  return { service, tree, historyService, historyRows, committedValues };
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
    const { service, tree, historyService } = await makeFixture([archive]);

    const response = await service.queryConsensusState({
      client_id: '07-tendermint-0',
      revision_number: 0n,
      revision_height: ARCHIVED_HEIGHT.revisionHeight,
      latest_height: false,
    });

    expect(historyService.findUtxosByAddressAndPolicyIdAtOrBeforeBlockNo).toHaveBeenCalledWith(
      HISTORY_ADDRESS,
      POLICY_ID,
      PROOF_HEIGHT,
      consensusStateTokenName(CLIENT_TOKEN, ARCHIVED_HEIGHT, Lucid),
    );
    expect(tree.generateProof).toHaveBeenCalledWith('clients/07-tendermint-0/consensusStates/7');
    expect(response.proof_height.revision_height).toBe(PROOF_HEIGHT);
  });

  it('lists the latest inline state and every unpruned archived height', async () => {
    const { service } = await makeFixture([archiveDatum()]);

    const states = await service.queryConsensusStates({ client_id: '07-tendermint-0' });
    const heights = await service.queryConsensusStateHeights({ client_id: '07-tendermint-0' });

    expect(states.consensus_states.map((entry) => entry.height?.revision_height)).toEqual([7n, 9n]);
    expect(heights.consensus_state_heights.map((height) => height.revision_height)).toEqual([7n, 9n]);
  });

  it('does not expose an archive whose commitment leaf was already pruned', async () => {
    const fixture = await makeFixture([archiveDatum()]);
    fixture.committedValues.clear();

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

  it('fails closed for a duplicate archive NFT', async () => {
    const archive = archiveDatum();
    const { service } = await makeFixture([archive, archive]);

    await expect(service.queryConsensusStateHeights({ client_id: '07-tendermint-0' }))
      .rejects.toThrow(/Duplicate consensus-state history NFT/);
  });

  it('ignores a valid archive for another client while listing this client', async () => {
    const foreign = archiveDatum(
      { revisionNumber: 0n, revisionHeight: 6n },
      { policyId: POLICY_ID, name: '55'.repeat(24) + '31' },
    );
    const { service } = await makeFixture([foreign, archiveDatum()]);

    const heights = await service.queryConsensusStateHeights({ client_id: '07-tendermint-0' });

    expect(heights.consensus_state_heights.map((height) => height.revision_height)).toEqual([7n, 9n]);
  });
});
